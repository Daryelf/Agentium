from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .lifecycle import OrderPlan


@dataclass(frozen=True)
class SimulatedTrade:
    symbol: str
    entry_price: float
    exit_price: float
    shares: float
    entry_reason: str
    exit_reason: str

    @property
    def pnl(self) -> float:
        return round((self.exit_price - self.entry_price) * self.shares, 4)


@dataclass(frozen=True)
class BacktestMetrics:
    trades: int
    wins: int
    losses: int
    win_rate: float
    average_win: float
    average_loss: float
    expectancy: float
    max_drawdown: float


def metrics_for_trades(trades: Iterable[SimulatedTrade]) -> BacktestMetrics:
    items = list(trades)
    wins = [trade.pnl for trade in items if trade.pnl > 0]
    losses = [trade.pnl for trade in items if trade.pnl <= 0]
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for trade in items:
        equity += trade.pnl
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity - peak)

    trade_count = len(items)
    win_rate = len(wins) / trade_count if trade_count else 0.0
    average_win = sum(wins) / len(wins) if wins else 0.0
    average_loss = sum(losses) / len(losses) if losses else 0.0
    expectancy = (win_rate * average_win) + ((1 - win_rate) * average_loss) if trade_count else 0.0
    return BacktestMetrics(
        trades=trade_count,
        wins=len(wins),
        losses=len(losses),
        win_rate=round(win_rate, 4),
        average_win=round(average_win, 4),
        average_loss=round(average_loss, 4),
        expectancy=round(expectancy, 4),
        max_drawdown=round(abs(max_drawdown), 4),
    )


def plan_fill_price(plan: OrderPlan) -> float:
    raw = plan.placement_raw or {}
    for key in ["average_price", "price", "filled_average_price"]:
        value = raw.get(key) if isinstance(raw, dict) else None
        try:
            if value is not None and value != "":
                return float(value)
        except (TypeError, ValueError):
            pass
    if plan.broker_review and plan.broker_review.quote_last:
        return float(plan.broker_review.quote_last)
    if plan.limit_price:
        return float(plan.limit_price)
    return 0.0


def plan_fill_shares(plan: OrderPlan) -> float:
    raw = plan.placement_raw or {}
    for key in ["filled_quantity", "quantity", "cumulative_quantity"]:
        value = raw.get(key) if isinstance(raw, dict) else None
        try:
            if value is not None and value != "":
                return float(value)
        except (TypeError, ValueError):
            pass
    return float(plan.quantity or 0.0)


def realized_trades_from_order_plans(plans: Iterable[OrderPlan]) -> list[SimulatedTrade]:
    open_lots: dict[str, list[tuple[float, float, str]]] = {}
    trades: list[SimulatedTrade] = []
    ordered = sorted(plans, key=lambda plan: plan.placed_at or "")
    for plan in ordered:
        if plan.placement_state not in {"filled", "partially_filled"}:
            continue
        symbol = plan.symbol.upper()
        price = plan_fill_price(plan)
        shares = plan_fill_shares(plan)
        if price <= 0 or shares <= 0:
            continue
        if plan.side == "buy":
            open_lots.setdefault(symbol, []).append((shares, price, plan.status))
            continue
        if plan.side != "sell":
            continue
        remaining = shares
        lots = open_lots.setdefault(symbol, [])
        while remaining > 0 and lots:
            lot_shares, entry_price, entry_reason = lots[0]
            closed = min(lot_shares, remaining)
            trades.append(
                SimulatedTrade(
                    symbol=symbol,
                    entry_price=entry_price,
                    exit_price=price,
                    shares=round(closed, 6),
                    entry_reason=entry_reason,
                    exit_reason=plan.status,
                )
            )
            remaining = round(remaining - closed, 6)
            lot_shares = round(lot_shares - closed, 6)
            if lot_shares <= 0:
                lots.pop(0)
            else:
                lots[0] = (lot_shares, entry_price, entry_reason)
    return trades
