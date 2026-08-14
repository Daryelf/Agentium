from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from .broker import BrokerAccountState, BrokerGuardrails, build_auto_order_plan, build_exit_order_plan
from .broker_client import BrokerClient, BrokerOrder, BrokerOrderResult, BrokerPosition, normalized_order_state
from .config import Settings
from .data import MarketData
from .evaluator import PositionSnapshot, build_indicator_snapshot, market_condition
from .intraday import (
    AUTO_ORDER_READY,
    INTRADAY_REJECT,
    LARGE_AUTO_ORDER_READY,
    IntradayMarketContext,
    evaluate_intraday_entry,
    evaluate_intraday_exit,
)
from .lifecycle import DailyRiskState, IntradayLifecycleState, LivePositionPlan, OrderPlan, TradeIntent
from .market import parse_hhmm


@dataclass(frozen=True)
class IntradayCycleResult:
    state: IntradayLifecycleState
    placed_orders: list[BrokerOrderResult]
    rejected_reasons: list[str]


def force_exit_iso(settings: Settings, now: datetime) -> str:
    current = now.astimezone(ZoneInfo(settings.market_timezone))
    cutoff = parse_hhmm(settings.intraday_force_exit_after)
    return current.replace(hour=cutoff.hour, minute=cutoff.minute, second=0, microsecond=0).isoformat()


def reconcile_positions(
    prior: IntradayLifecycleState,
    broker_positions: list[BrokerPosition],
    *,
    settings: Settings,
    quotes,
    now: datetime,
    broker_orders: list[BrokerOrder] | None = None,
) -> tuple[dict[str, LivePositionPlan], DailyRiskState]:
    broker_by_symbol = {position.symbol.upper(): position for position in broker_positions if position.shares > 0}
    tracked_sell_order_ids = {
        plan.placed_order_id: plan.symbol.upper()
        for plan in prior.order_plans
        if plan.side.lower() == "sell" and plan.placed_order_id
    }
    filled_sell_price_by_symbol: dict[str, float] = {}
    for order in reversed(broker_orders or []):
        if order.order_id not in tracked_sell_order_ids:
            continue
        symbol = tracked_sell_order_ids[order.order_id]
        if symbol in filled_sell_price_by_symbol:
            continue
        if (
            order.side.lower() == "sell"
            and normalized_order_state(order.state) == "filled"
            and order.quantity
            and order.quantity > 0
            and order.average_price
            and order.average_price > 0
        ):
            filled_sell_price_by_symbol[symbol] = order.average_price
    positions: dict[str, LivePositionPlan] = {}
    risk = prior.daily_risk
    realized_delta = 0.0
    consecutive_losses = risk.consecutive_losses

    for symbol, broker_position in broker_by_symbol.items():
        existing = prior.positions.get(symbol)
        if existing:
            positions[symbol] = replace(
                existing,
                shares=broker_position.shares,
                average_cost=broker_position.average_cost,
                force_exit_after=force_exit_iso(settings, now),
            )
            continue
        average = broker_position.average_cost
        positions[symbol] = LivePositionPlan(
            symbol=symbol,
            shares=broker_position.shares,
            average_cost=average,
            stop_price=round(average * 0.98, 4),
            target_1=round(average * 1.03, 4),
            target_2=round(average * 1.06, 4),
            profit_lock_price=round(average * 1.02, 4),
            thesis="broker position reconciled; intraday same-day exit required",
            opened_at=now.isoformat(timespec="seconds"),
            force_exit_after=force_exit_iso(settings, now),
        )

    for symbol, old_position in prior.positions.items():
        normalized_symbol = symbol.upper()
        if normalized_symbol in broker_by_symbol:
            continue
        quote = quotes.get(symbol)
        close_price = filled_sell_price_by_symbol.get(normalized_symbol) or (quote.last if quote and quote.last else None)
        if close_price and old_position.shares > 0:
            pnl = (close_price - old_position.average_cost) * old_position.shares
            realized_delta += pnl
            consecutive_losses = consecutive_losses + 1 if pnl < 0 else 0

    unrealized = 0.0
    for symbol, position in positions.items():
        quote = quotes.get(symbol)
        if quote and quote.last:
            unrealized += (quote.last - position.average_cost) * position.shares

    lockout_reason = risk.lockout_reason
    realized = risk.realized_pnl + realized_delta
    total_daily_pnl = realized + unrealized
    if total_daily_pnl <= -(settings.live_principal_dollars * settings.daily_loss_limit_pct):
        lockout_reason = "daily loss limit reached"
    if consecutive_losses >= settings.max_consecutive_losses:
        lockout_reason = "max consecutive losses reached"

    return positions, DailyRiskState(
        date=now.date().isoformat(),
        realized_pnl=round(realized, 4),
        unrealized_pnl=round(unrealized, 4),
        trades_today=risk.trades_today,
        consecutive_losses=consecutive_losses,
        lockout_reason=lockout_reason,
    )


def place_if_ready(
    broker: BrokerClient,
    account_number: str,
    plan: OrderPlan,
    *,
    execute: bool,
    human_gate_authorizer: Callable[[OrderPlan], bool] | None = None,
) -> BrokerOrderResult | None:
    if plan.status != "READY_TO_PLACE" or not execute:
        return None
    if human_gate_authorizer is None or not human_gate_authorizer(plan):
        return None
    return broker.place_order(account_number, plan)


def order_plan_with_result(plan: OrderPlan, result: BrokerOrderResult, now: datetime) -> OrderPlan:
    state = normalized_order_state(result.state)
    raw = dict(result.raw or {})
    if result.filled_quantity is not None:
        raw["filled_quantity"] = result.filled_quantity
    if result.average_price is not None:
        raw["average_price"] = result.average_price
    if not result.order_id:
        return replace(
            plan,
            status="PLACEMENT_FAILED",
            placed_at=now.isoformat(timespec="seconds"),
            placement_state="failed",
            placement_raw=raw or {"state": state, "error": "broker placement response missing order id"},
            rejection_reasons=[*plan.rejection_reasons, "broker placement response missing order id"],
        )
    status = plan.status
    reasons = list(plan.rejection_reasons)
    if state == "filled":
        status = "FILLED"
    elif state == "cancelled":
        status = "CANCELLED"
        reasons.append("broker order cancelled")
    elif state in {"rejected", "failed"}:
        status = "REJECTED"
        reasons.append(f"broker order {state}")
    return replace(
        plan,
        status=status,
        placed_order_id=result.order_id,
        placed_at=now.isoformat(timespec="seconds"),
        placement_state=state,
        placement_raw=raw,
        rejection_reasons=reasons,
    )


def placement_result_counts_as_placed(plan: OrderPlan) -> bool:
    return bool(plan.placed_order_id) and plan.placement_state not in {"failed", "rejected", "cancelled"}


def order_plan_with_placement_failure(plan: OrderPlan, exc: Exception, now: datetime) -> OrderPlan:
    reason = f"broker placement failed: {exc}"
    return replace(
        plan,
        status="PLACEMENT_FAILED",
        placed_at=now.isoformat(timespec="seconds"),
        placement_state="failed",
        placement_raw={"error": str(exc), "error_type": type(exc).__name__},
        rejection_reasons=[*plan.rejection_reasons, reason],
    )


def order_plan_with_broker_order_state(plan: OrderPlan, order: BrokerOrder) -> OrderPlan:
    state = normalized_order_state(order.state)
    raw = {
        "broker_order_id": order.order_id,
        "state": state,
        "quantity": order.quantity,
        "dollar_amount": order.dollar_amount,
        "average_price": order.average_price,
    }
    status = plan.status
    reasons = list(plan.rejection_reasons)
    if state == "filled":
        status = "FILLED"
    elif state == "cancelled":
        status = "CANCELLED"
        reason = "broker order cancelled"
        if reason not in reasons:
            reasons.append(reason)
    elif state in {"rejected", "failed"}:
        status = "REJECTED"
        reason = f"broker order {state}"
        if reason not in reasons:
            reasons.append(reason)

    return replace(
        plan,
        placed_order_id=plan.placed_order_id or order.order_id,
        placement_state=state,
        placement_raw={key: value for key, value in raw.items() if value is not None},
        rejection_reasons=reasons,
        status=status,
    )


def merge_order_plan_history(
    prior_plans: list[OrderPlan],
    cycle_plans: list[OrderPlan],
    broker_orders: list[BrokerOrder],
) -> list[OrderPlan]:
    broker_by_id = {order.order_id: order for order in broker_orders if order.order_id}
    merged: dict[tuple[str, str, str], OrderPlan] = {}

    def key(plan: OrderPlan) -> tuple[str, str, str]:
        return (plan.ref_id or plan.placed_order_id or "", plan.symbol, plan.side)

    for plan in prior_plans:
        updated = order_plan_with_broker_order_state(plan, broker_by_id[plan.placed_order_id]) if plan.placed_order_id in broker_by_id else plan
        merged[key(updated)] = updated
    for plan in cycle_plans:
        updated = order_plan_with_broker_order_state(plan, broker_by_id[plan.placed_order_id]) if plan.placed_order_id in broker_by_id else plan
        merged[key(updated)] = updated
    return list(merged.values())


def run_intraday_control_cycle(
    *,
    data: MarketData,
    symbols: list[str],
    settings: Settings,
    broker: BrokerClient | None,
    account_number: str,
    lifecycle: IntradayLifecycleState,
    now: datetime,
    sector_aligned: bool = True,
    news_verified: bool = True,
    execute: bool = True,
    execute_entries: bool | None = None,
    execute_exits: bool | None = None,
    allow_entries: bool = True,
    entry_block_reasons: list[str] | None = None,
    human_gate_authorizer: Callable[[OrderPlan], bool] | None = None,
) -> IntradayCycleResult:
    execute_entries = execute if execute_entries is None else execute_entries
    execute_exits = execute if execute_exits is None else execute_exits

    if broker is None:
        state = IntradayLifecycleState(
            daily_risk=lifecycle.daily_risk,
            intents=[
                TradeIntent(
                    symbol="SYSTEM",
                    side="buy",
                    setup_type="No Broker",
                    confidence_score=0,
                    entry_price=0,
                    entry_zone="",
                    stop_price=0,
                    target_1=0,
                    target_2=0,
                    risk_reward_ratio=0,
                    risk_dollars=0,
                    status=INTRADAY_REJECT,
                    rejection_reasons=["broker client missing"],
                    created_at=now.isoformat(timespec="seconds"),
                )
            ],
            positions=lifecycle.positions,
            updated_at=now.isoformat(timespec="seconds"),
        )
        return IntradayCycleResult(state=state, placed_orders=[], rejected_reasons=["broker client missing"])

    rejected_reasons: list[str] = []
    account = broker.get_portfolio(account_number)
    if account.account_number.strip() != account_number.strip():
        rejected_reasons.append("broker account number does not match requested Agentic account")
        account = replace(
            account,
            warnings=[
                *account.warnings,
                "broker account number does not match requested Agentic account",
            ],
        )
    broker_positions = broker.get_positions(account_number)
    broker_orders = broker.get_orders(account_number)
    quotes = broker.get_quotes(list(dict.fromkeys(symbols + [position.symbol for position in broker_positions] + ["SPY", "QQQ"])))
    tradability = broker.get_tradability(account_number, symbols)
    positions, daily_risk = reconcile_positions(
        lifecycle,
        broker_positions,
        settings=settings,
        quotes=quotes,
        now=now,
        broker_orders=broker_orders,
    )
    open_order_symbols = {order.symbol.upper() for order in broker_orders if order.is_open}
    open_order_sides = {(order.symbol.upper(), order.side.lower()) for order in broker_orders if order.is_open}

    market = market_condition(data, now=now)
    spy = build_indicator_snapshot(data, "SPY", now=now)
    qqq = build_indicator_snapshot(data, "QQQ", now=now)
    context = IntradayMarketContext(
        now=now,
        market_condition=market,
        spy_aligned=bool(spy and spy.current_price > spy.vwap and spy.trend_direction == "uptrend"),
        qqq_aligned=bool(qqq and qqq.current_price > qqq.vwap and qqq.trend_direction == "uptrend"),
        sector_aligned=sector_aligned,
        news_verified=news_verified,
    )

    intents: list[TradeIntent] = []
    order_plans: list[OrderPlan] = []
    placed: list[BrokerOrderResult] = []

    for symbol, position in positions.items():
        indicators = build_indicator_snapshot(data, symbol, now=now)
        if indicators is None:
            rejected_reasons.append(f"{symbol}: missing intraday indicators for exit")
            continue
        decision = evaluate_intraday_exit(position, indicators, settings, quote=quotes.get(symbol), context=context, daily_risk=daily_risk)
        if decision.action != "INTRADAY_EXIT":
            continue
        if (symbol.upper(), "sell") in open_order_sides:
            rejected_reasons.append(f"{symbol}: open sell order already exists for symbol")
            order_plans.append(
                OrderPlan(
                    side="sell",
                    symbol=symbol,
                    order_type="market",
                    dollar_amount=0.0,
                    quantity=round(position.shares, 6),
                    limit_price=None,
                    stop_price=None,
                    time_in_force="gfd",
                    market_hours="regular_hours",
                    status="REJECTED",
                    rejection_reasons=["open sell order already exists for symbol"],
                    ref_id=reuse_ref_id(lifecycle.order_plans, side="sell", symbol=symbol),
                )
            )
            continue
        seed_plan = OrderPlan(
            side="sell",
            symbol=symbol,
            order_type="market",
            dollar_amount=0.0,
            quantity=round(position.shares, 6),
            limit_price=None,
            stop_price=None,
            time_in_force="gfd",
            market_hours="regular_hours",
            status="PENDING_REVIEW",
        )
        review = broker.review_order(account_number, seed_plan)
        ref_id = reuse_ref_id(lifecycle.order_plans, side="sell", symbol=symbol)
        plan = build_exit_order_plan(decision, account=account, broker_review=review, ref_id=ref_id)
        order_plans.append(plan)
        try:
            result = place_if_ready(
                broker,
                account_number,
                plan,
                execute=execute_exits,
                human_gate_authorizer=human_gate_authorizer,
            )
        except Exception as exc:
            rejected_reasons.append(f"{symbol}: broker placement failed: {exc}")
            order_plans[-1] = order_plan_with_placement_failure(plan, exc, now)
        else:
            if result:
                updated = order_plan_with_result(plan, result, now)
                order_plans[-1] = updated
                if placement_result_counts_as_placed(updated):
                    placed.append(result)

    for symbol in symbols:
        indicators = build_indicator_snapshot(data, symbol, now=now)
        if indicators is None:
            continue
        existing_position = None
        existing_symbol_exposure = 0.0
        if symbol in positions:
            live_position = positions[symbol]
            existing_position = PositionSnapshot(symbol, live_position.shares, live_position.average_cost)
            existing_symbol_exposure = live_position.shares * live_position.average_cost
        intent = evaluate_intraday_entry(
            indicators,
            settings,
            quote=quotes.get(symbol),
            context=context,
            daily_risk=daily_risk,
            account_value=account.account_value,
            existing_position=existing_position,
            open_order_symbols=open_order_symbols,
        )
        if tradability.get(symbol) is False:
            intent = replace(intent, status=INTRADAY_REJECT, rejection_reasons=[*intent.rejection_reasons, "symbol is not tradable"])
        if existing_position is None and len(positions) >= settings.max_positions:
            intent = replace(
                intent,
                status=INTRADAY_REJECT,
                rejection_reasons=[*intent.rejection_reasons, "max live positions reached"],
            )
        if not allow_entries:
            intent = replace(
                intent,
                status=INTRADAY_REJECT,
                rejection_reasons=[*intent.rejection_reasons, *(entry_block_reasons or ["new entries are blocked"])],
            )
        intents.append(intent)
        seed_plan = build_auto_order_plan(
            intent,
            settings=settings,
            guardrails=BrokerGuardrails.from_settings(settings),
            account=account,
            broker_review=None,
            ref_id=reuse_ref_id(lifecycle.order_plans, side="buy", symbol=symbol),
            existing_symbol_exposure=existing_symbol_exposure,
        )
        if intent.status in {AUTO_ORDER_READY, LARGE_AUTO_ORDER_READY}:
            review = broker.review_order(account_number, seed_plan)
            plan = build_auto_order_plan(
                intent,
                settings=settings,
                guardrails=BrokerGuardrails.from_settings(settings),
                account=account,
                broker_review=review,
                ref_id=seed_plan.ref_id,
                existing_symbol_exposure=existing_symbol_exposure,
            )
        else:
            plan = seed_plan
        order_plans.append(plan)
        try:
            result = place_if_ready(
                broker,
                account_number,
                plan,
                execute=execute_entries,
                human_gate_authorizer=human_gate_authorizer,
            )
        except Exception as exc:
            rejected_reasons.append(f"{symbol}: broker placement failed: {exc}")
            order_plans[-1] = order_plan_with_placement_failure(plan, exc, now)
        else:
            if result:
                updated = order_plan_with_result(plan, result, now)
                order_plans[-1] = updated
                if placement_result_counts_as_placed(updated):
                    placed.append(result)

    if placed:
        daily_risk = replace(daily_risk, trades_today=daily_risk.trades_today + len(placed))

    merged_order_plans = merge_order_plan_history(lifecycle.order_plans, order_plans, broker_orders)
    state = IntradayLifecycleState(
        daily_risk=daily_risk,
        intents=sorted(intents, key=lambda item: (-item.confidence_score, item.symbol)),
        order_plans=sorted(merged_order_plans, key=lambda item: (item.status != "READY_TO_PLACE", item.symbol, item.side, item.placed_at)),
        positions=positions,
        updated_at=now.isoformat(timespec="seconds"),
    )
    return IntradayCycleResult(state=state, placed_orders=placed, rejected_reasons=rejected_reasons)


def reuse_ref_id(plans: list[OrderPlan], *, side: str, symbol: str) -> str | None:
    for plan in reversed(plans):
        if plan.side == side and plan.symbol == symbol and plan.ref_id and order_plan_allows_ref_retry(plan):
            return plan.ref_id
    return None


def order_plan_allows_ref_retry(plan: OrderPlan) -> bool:
    if normalized_order_state(plan.placement_state) in {"filled", "cancelled", "rejected"}:
        return False
    if plan.status in {"FILLED", "CANCELLED", "REJECTED"}:
        return False
    return True
