from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from stock_guru.broker import BrokerAccountState
from stock_guru.broker_client import BrokerOrder, BrokerOrderResult, BrokerPosition, DryRunBrokerClient
from stock_guru.config import Settings
from stock_guru.data import MarketData
from stock_guru.evaluator import QuoteSnapshot
from stock_guru.intraday_loop import merge_order_plan_history, reconcile_positions, run_intraday_control_cycle as run_control_cycle_without_approval
from stock_guru.lifecycle import DailyRiskState, IntradayLifecycleState, LivePositionPlan, OrderPlan


def run_intraday_control_cycle(**kwargs):
    """Test-only exact approval stand-in for placement-path unit tests."""
    kwargs.setdefault("human_gate_authorizer", lambda plan: bool(plan.ref_id))
    return run_control_cycle_without_approval(**kwargs)


def settings() -> Settings:
    return Settings(
        default_budget=25,
        max_positions=5,
        max_position_pct=1.0,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.08,
        min_price=5,
        min_dollar_volume=1_000_000,
        market_timezone="America/New_York",
        regular_market_open="09:30",
        regular_market_close="16:00",
    )


def now(hour: int = 10, minute: int = 30) -> datetime:
    return datetime(2026, 6, 8, hour, minute, tzinfo=ZoneInfo("America/New_York"))


def quote(symbol: str = "TEST", last: float = 111.8, fresh: bool = True) -> QuoteSnapshot:
    return QuoteSnapshot(symbol, bid=round(last - 0.01, 2), ask=round(last + 0.01, 2), last=last, data_fresh=fresh)


def account(**overrides) -> BrokerAccountState:
    values = {"account_number": "A123", "account_value": 25.0, "cash": 25.0, "buying_power": 25.0}
    values.update(overrides)
    return BrokerAccountState(**values)


class FailingPlaceBroker(DryRunBrokerClient):
    def place_order(self, account_number: str, plan: OrderPlan):
        raise RuntimeError("broker transport unavailable")


class MissingOrderIdBroker(DryRunBrokerClient):
    def place_order(self, account_number: str, plan: OrderPlan):
        return BrokerOrderResult(order_id="", state="queued", raw={"order": {"state": "queued"}})


class MissingPlacementStateBroker(DryRunBrokerClient):
    def place_order(self, account_number: str, plan: OrderPlan):
        raise RuntimeError("broker placement response missing state")


class RejectedPlaceBroker(DryRunBrokerClient):
    def place_order(self, account_number: str, plan: OrderPlan):
        return BrokerOrderResult(order_id="bad-order", state="rejected", raw={"order": {"id": "bad-order", "state": "rejected"}})


def intraday_frame(last: float = 111.8, last_volume: float = 5_000_000) -> MarketData:
    tickers = ["TEST", "SPY", "QQQ", "^VIX"]
    # 10:30 America/New_York is 14:30 UTC on this date. Keep the fixture genuinely
    # fresh instead of weakening the production stale-quote guard.
    dates = pd.date_range(end=pd.Timestamp("2026-06-08 14:30", tz="UTC"), periods=80, freq="min")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], tickers])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    base_close = [100 + idx * ((last - 100) / 79) for idx in range(80)]
    for ticker in tickers:
        if ticker == "^VIX":
            close = pd.Series([15.0] * len(dates), index=dates)
        else:
            close = pd.Series(base_close, index=dates)
        volume = pd.Series([1_000_000] * len(dates), index=dates)
        volume.iloc[-1] = last_volume
        frame[("Open", ticker)] = close - 0.05
        frame[("High", ticker)] = close + 1.0
        frame[("Low", ticker)] = close - 1.0
        frame[("Close", ticker)] = close
        frame[("Volume", ticker)] = volume
    return MarketData(tickers, frame)


def two_symbol_intraday_frame() -> MarketData:
    data = intraday_frame()
    frame = data.history.copy()
    for field in ["Open", "High", "Low", "Close", "Volume"]:
        frame[(field, "HELD")] = frame[(field, "TEST")]
    return MarketData(["TEST", "HELD", "SPY", "QQQ", "^VIX"], frame.sort_index(axis=1))


def lifecycle_with_position(price: float = 100, shares: float = 0.25) -> IntradayLifecycleState:
    return IntradayLifecycleState(
        daily_risk=DailyRiskState(date="2026-06-08"),
        positions={
            "TEST": LivePositionPlan(
                symbol="TEST",
                shares=shares,
                average_cost=price,
                stop_price=98,
                target_1=104,
                target_2=108,
                profit_lock_price=102,
                thesis="intraday test",
                opened_at="2026-06-08T10:00:00-04:00",
                force_exit_after="2026-06-08T15:45:00-04:00",
            )
        },
    )


def lifecycle_with_position_and_tracked_sell_order(order_id: str = "sell-fill") -> IntradayLifecycleState:
    state = lifecycle_with_position()
    return IntradayLifecycleState(
        daily_risk=state.daily_risk,
        positions=state.positions,
        order_plans=[
            OrderPlan(
                side="sell",
                symbol="TEST",
                order_type="market",
                dollar_amount=0,
                quantity=0.25,
                limit_price=None,
                stop_price=None,
                time_in_force="gfd",
                market_hours="regular_hours",
                status="READY_TO_PLACE",
                placed_order_id=order_id,
                placement_state="confirmed",
                ref_id="sell-ref",
            )
        ],
    )


def test_no_broker_client_means_no_live_order() -> None:
    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=None,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert result.state.intents[0].symbol == "SYSTEM"
    assert "broker client missing" in result.rejected_reasons


def test_ready_plan_does_not_place_without_human_gate_authorizer() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_control_cycle_without_approval(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert not broker.placed_orders
    assert result.state.order_plans[0].status == "READY_TO_PLACE"


def test_aligned_90_plus_places_buy_after_test_human_gate_approval() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert len(result.placed_orders) == 1
    assert broker.placed_orders[0].side == "buy"
    assert broker.placed_orders[0].order_type == "market"
    assert broker.placed_orders[0].ref_id


def test_account_identity_mismatch_blocks_live_order() -> None:
    broker = DryRunBrokerClient(
        account=account(account_number="OTHER"),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert broker.placed_orders == []
    assert "broker account number does not match requested Agentic account" in result.rejected_reasons
    assert result.state.order_plans[0].status == "REJECTED"
    assert any(
        "broker account number does not match requested Agentic account" in reason
        for reason in result.state.order_plans[0].rejection_reasons
    )


def test_filled_placement_persists_canonical_fill_fields() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert result.placed_orders
    assert plan.status == "FILLED"
    assert plan.placement_raw["filled_quantity"] > 0
    assert plan.placement_raw["average_price"] > 0


def test_buy_placement_failure_is_recorded_fail_closed() -> None:
    broker = FailingPlaceBroker(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert not result.placed_orders
    assert plan.side == "buy"
    assert plan.status == "PLACEMENT_FAILED"
    assert plan.placement_state == "failed"
    assert plan.placement_raw == {"error": "broker transport unavailable", "error_type": "RuntimeError"}
    assert "broker placement failed: broker transport unavailable" in plan.rejection_reasons
    assert "TEST: broker placement failed: broker transport unavailable" in result.rejected_reasons


def test_missing_broker_order_id_is_recorded_fail_closed() -> None:
    broker = MissingOrderIdBroker(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert not result.placed_orders
    assert plan.status == "PLACEMENT_FAILED"
    assert plan.placed_order_id == ""
    assert plan.placement_state == "failed"
    assert "broker placement response missing order id" in plan.rejection_reasons


def test_missing_broker_placement_state_is_recorded_fail_closed() -> None:
    broker = MissingPlacementStateBroker(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert not result.placed_orders
    assert plan.status == "PLACEMENT_FAILED"
    assert plan.placement_state == "failed"
    assert "broker placement failed: broker placement response missing state" in plan.rejection_reasons


def test_rejected_broker_placement_response_is_terminal_rejected() -> None:
    broker = RejectedPlaceBroker(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert not result.placed_orders
    assert plan.status == "REJECTED"
    assert plan.placed_order_id == "bad-order"
    assert plan.placement_state == "rejected"
    assert "broker order rejected" in plan.rejection_reasons


def test_execute_entries_false_reviews_but_does_not_place_buy() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
        execute_entries=False,
        execute_exits=True,
    )

    buy_plan = next(plan for plan in result.state.order_plans if plan.side == "buy")
    assert buy_plan.status == "READY_TO_PLACE"
    assert not broker.placed_orders
    assert not result.placed_orders


def test_execute_exits_true_still_places_sell_when_entries_disabled() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=97),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(),
        execute_entries=False,
        execute_exits=True,
    )

    assert len(result.placed_orders) == 1
    assert broker.placed_orders[0].side == "sell"


def test_tradability_false_rejects_entry() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
        tradability={"TEST": False},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert "symbol is not tradable" in result.state.intents[0].rejection_reasons


def test_open_order_blocks_duplicate_entry() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
        orders=[BrokerOrder("existing", "TEST", "buy", "confirmed")],
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert "open order already exists for symbol" in result.state.intents[0].rejection_reasons


def test_max_positions_blocks_new_entry_without_blocking_existing_position_management() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("HELD", 0.25, 111.8)],
        quotes={"TEST": quote("TEST"), "HELD": quote("HELD"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=two_symbol_intraday_frame(),
        symbols=["TEST"],
        settings=Settings(
            **{
                **settings().__dict__,
                "max_positions": 1,
            }
        ),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    assert not result.placed_orders
    assert "max live positions reached" in result.state.intents[0].rejection_reasons


def test_stop_hit_places_sell_order() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=97),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(),
    )

    assert len(result.placed_orders) == 1
    assert broker.placed_orders[0].side == "sell"
    assert broker.placed_orders[0].quantity == 0.25


def test_open_sell_order_blocks_duplicate_exit_order() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        orders=[BrokerOrder("existing-sell", "TEST", "sell", "confirmed", quantity=0.25)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=97),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(),
    )

    sell_plan = next(plan for plan in result.state.order_plans if plan.side == "sell")
    assert not result.placed_orders
    assert not broker.placed_orders
    assert sell_plan.status == "REJECTED"
    assert "open sell order already exists for symbol" in sell_plan.rejection_reasons
    assert "TEST: open sell order already exists for symbol" in result.rejected_reasons


def test_open_sell_order_blocks_duplicate_exit_with_mixed_case_broker_state() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("test", 0.25, 100)],
        orders=[BrokerOrder("existing-sell", "test", "SELL", "Confirmed", quantity=0.25)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=97),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(),
    )

    sell_plan = next(plan for plan in result.state.order_plans if plan.side == "sell")
    assert not result.placed_orders
    assert sell_plan.status == "REJECTED"
    assert "open sell order already exists for symbol" in sell_plan.rejection_reasons


def test_sell_placement_failure_is_recorded_fail_closed() -> None:
    broker = FailingPlaceBroker(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=97),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(),
    )

    plan = next(item for item in result.state.order_plans if item.side == "sell")
    assert not result.placed_orders
    assert plan.status == "PLACEMENT_FAILED"
    assert plan.placement_state == "failed"
    assert "broker placement failed: broker transport unavailable" in plan.rejection_reasons


def test_end_of_day_blocks_buys_and_places_sell() -> None:
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        quotes={"TEST": quote("TEST", last=101), "SPY": quote("SPY", last=101), "QQQ": quote("QQQ", last=101)},
    )

    result = run_intraday_control_cycle(
        data=intraday_frame(last=101),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle_with_position(),
        now=now(hour=15, minute=46),
    )

    assert broker.placed_orders[0].side == "sell"
    assert not any(order.side == "buy" and order.status == "READY_TO_PLACE" for order in result.state.order_plans)


def test_closed_broker_position_updates_realized_loss_and_removes_lifecycle_position() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position(),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=97)},
        now=now(),
    )

    assert positions == {}
    assert risk.realized_pnl == -0.75
    assert risk.consecutive_losses == 1


def test_unrealized_loss_triggers_daily_loss_lockout() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position(),
        [BrokerPosition("TEST", 0.25, 100)],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=97)},
        now=now(),
    )

    assert positions["TEST"].shares == 0.25
    assert risk.realized_pnl == 0
    assert risk.unrealized_pnl == -0.75
    assert risk.lockout_reason == "daily loss limit reached"


def test_closed_broker_position_prefers_filled_sell_price_over_quote() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position_and_tracked_sell_order("sell-fill"),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=90)},
        now=now(),
        broker_orders=[BrokerOrder("sell-fill", "TEST", "sell", "filled", quantity=0.25, average_price=103)],
    )

    assert positions == {}
    assert risk.realized_pnl == 0.75
    assert risk.consecutive_losses == 0


def test_closed_broker_position_ignores_untracked_filled_sell_history() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position(),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=90)},
        now=now(),
        broker_orders=[BrokerOrder("old-sell-fill", "TEST", "sell", "filled", quantity=0.25, average_price=103)],
    )

    assert positions == {}
    assert risk.realized_pnl == -2.5
    assert risk.consecutive_losses == 1


def test_closed_broker_position_loss_from_filled_sell_updates_loss_streak() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position_and_tracked_sell_order("sell-fill"),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=110)},
        now=now(),
        broker_orders=[BrokerOrder("sell-fill", "TEST", "sell", "FILLED", quantity=0.25, average_price=96)],
    )

    assert positions == {}
    assert risk.realized_pnl == -1.0
    assert risk.consecutive_losses == 1


def test_closed_broker_position_uses_latest_filled_sell_when_multiple_exist() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position_and_tracked_sell_order("latest-sell-fill"),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=90)},
        now=now(),
        broker_orders=[
            BrokerOrder("old-sell-fill", "TEST", "sell", "filled", quantity=0.25, average_price=96),
            BrokerOrder("latest-sell-fill", "TEST", "SELL", "FILLED", quantity=0.25, average_price=104),
        ],
    )

    assert positions == {}
    assert risk.realized_pnl == 1.0
    assert risk.consecutive_losses == 0


def test_closed_broker_position_ignores_zero_quantity_sell_fill() -> None:
    positions, risk = reconcile_positions(
        lifecycle_with_position_and_tracked_sell_order("valid-sell-fill"),
        [],
        settings=settings(),
        quotes={"TEST": quote("TEST", last=90)},
        now=now(),
        broker_orders=[
            BrokerOrder("valid-sell-fill", "test", "sell", "filled", quantity=0.25, average_price=104),
            BrokerOrder("zero-sell-fill", "test", "SELL", "FILLED", quantity=0, average_price=80),
        ],
    )

    assert positions == {}
    assert risk.realized_pnl == 1.0
    assert risk.consecutive_losses == 0


def test_entry_retry_reuses_existing_ref_id() -> None:
    lifecycle = IntradayLifecycleState(
        daily_risk=DailyRiskState(date="2026-06-08"),
        order_plans=[
            OrderPlan(
                side="buy",
                symbol="TEST",
                order_type="limit",
                dollar_amount=25,
                quantity=None,
                limit_price=100.01,
                stop_price=None,
                time_in_force="gfd",
                market_hours="regular_hours",
                status="READY_TO_PLACE",
                ref_id="fixed-ref",
            )
        ],
    )
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle,
        now=now(),
    )

    assert broker.placed_orders[0].ref_id == "fixed-ref"


def test_entry_retry_reuses_placement_failed_ref_id() -> None:
    lifecycle = IntradayLifecycleState(
        daily_risk=DailyRiskState(date="2026-06-08"),
        order_plans=[
            OrderPlan(
                side="buy",
                symbol="TEST",
                order_type="market",
                dollar_amount=25,
                quantity=None,
                limit_price=None,
                stop_price=None,
                time_in_force="gfd",
                market_hours="regular_hours",
                status="PLACEMENT_FAILED",
                ref_id="retry-ref",
                placement_state="failed",
            )
        ],
    )
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle,
        now=now(),
    )

    assert broker.placed_orders[0].ref_id == "retry-ref"


def test_terminal_filled_order_ref_id_is_not_reused_for_new_trade() -> None:
    lifecycle = IntradayLifecycleState(
        daily_risk=DailyRiskState(date="2026-06-08"),
        order_plans=[
            OrderPlan(
                side="buy",
                symbol="TEST",
                order_type="market",
                dollar_amount=25,
                quantity=None,
                limit_price=None,
                stop_price=None,
                time_in_force="gfd",
                market_hours="regular_hours",
                status="FILLED",
                ref_id="old-filled-ref",
                placed_order_id="old-filled-order",
                placement_state="filled",
            )
        ],
    )
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=lifecycle,
        now=now(),
    )

    assert broker.placed_orders[0].ref_id
    assert broker.placed_orders[0].ref_id != "old-filled-ref"


def test_order_plan_history_preserves_prior_unrelated_orders() -> None:
    prior = OrderPlan(
        side="buy",
        symbol="OLD",
        order_type="market",
        dollar_amount=10,
        quantity=None,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="FILLED",
        ref_id="old-ref",
        placed_order_id="old-order",
        placement_state="filled",
    )
    current = OrderPlan(
        side="buy",
        symbol="TEST",
        order_type="market",
        dollar_amount=10,
        quantity=None,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        ref_id="new-ref",
    )

    merged = merge_order_plan_history([prior], [current], [])

    assert [plan.symbol for plan in merged] == ["OLD", "TEST"]


def test_order_plan_history_updates_filled_cancelled_and_rejected_broker_states() -> None:
    filled = OrderPlan(
        side="buy",
        symbol="FILL",
        order_type="market",
        dollar_amount=10,
        quantity=None,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        ref_id="fill-ref",
        placed_order_id="fill-order",
        placement_state="confirmed",
    )
    cancelled = OrderPlan(
        side="buy",
        symbol="CXL",
        order_type="market",
        dollar_amount=10,
        quantity=None,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        ref_id="cancel-ref",
        placed_order_id="cancel-order",
        placement_state="confirmed",
    )
    rejected = OrderPlan(
        side="buy",
        symbol="BAD",
        order_type="market",
        dollar_amount=10,
        quantity=None,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        ref_id="reject-ref",
        placed_order_id="reject-order",
        placement_state="confirmed",
    )

    merged = merge_order_plan_history(
        [filled, cancelled, rejected],
        [],
        [
            BrokerOrder("fill-order", "FILL", "buy", "FILLED", quantity=1, average_price=10),
            BrokerOrder("cancel-order", "CXL", "buy", "Cancelled"),
            BrokerOrder("reject-order", "BAD", "buy", "Rejected"),
        ],
    )
    by_symbol = {plan.symbol: plan for plan in merged}

    assert by_symbol["FILL"].status == "FILLED"
    assert by_symbol["FILL"].placement_state == "filled"
    assert by_symbol["FILL"].placement_raw["average_price"] == 10
    assert by_symbol["CXL"].status == "CANCELLED"
    assert "broker order cancelled" in by_symbol["CXL"].rejection_reasons
    assert by_symbol["BAD"].status == "REJECTED"
    assert "broker order rejected" in by_symbol["BAD"].rejection_reasons


def test_order_plan_with_mixed_case_placement_result_is_normalized() -> None:
    broker = RejectedPlaceBroker(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    def mixed_case_rejection(account_number: str, plan: OrderPlan):
        return BrokerOrderResult(order_id="bad-order", state="Rejected", raw={"order": {"id": "bad-order", "state": "Rejected"}})

    broker.place_order = mixed_case_rejection

    result = run_intraday_control_cycle(
        data=intraday_frame(),
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="A123",
        lifecycle=IntradayLifecycleState(daily_risk=DailyRiskState(date="2026-06-08")),
        now=now(),
    )

    plan = result.state.order_plans[0]
    assert not result.placed_orders
    assert plan.status == "REJECTED"
    assert plan.placement_state == "rejected"
