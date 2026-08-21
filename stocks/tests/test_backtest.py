from __future__ import annotations

from stock_guru.backtest import SimulatedTrade, metrics_for_trades, realized_trades_from_order_plans
from stock_guru.lifecycle import OrderPlan


def test_backtest_metrics_measure_win_rate_expectancy_and_drawdown() -> None:
    metrics = metrics_for_trades(
        [
            SimulatedTrade("AAPL", entry_price=100, exit_price=104, shares=1, entry_reason="breakout", exit_reason="target"),
            SimulatedTrade("MSFT", entry_price=100, exit_price=98, shares=1, entry_reason="vwap", exit_reason="stop"),
            SimulatedTrade("NVDA", entry_price=100, exit_price=103, shares=1, entry_reason="pullback", exit_reason="target"),
        ]
    )

    assert metrics.trades == 3
    assert metrics.wins == 2
    assert metrics.losses == 1
    assert metrics.win_rate == 0.6667
    assert metrics.average_win == 3.5
    assert metrics.average_loss == -2
    assert metrics.expectancy == 1.6667
    assert metrics.max_drawdown == 2


def test_backtest_metrics_handles_no_trades() -> None:
    metrics = metrics_for_trades([])

    assert metrics.trades == 0
    assert metrics.expectancy == 0
    assert metrics.max_drawdown == 0


def filled_plan(side: str, symbol: str, shares: float, price: float, placed_at: str) -> OrderPlan:
    return OrderPlan(
        side=side,
        symbol=symbol,
        order_type="market",
        dollar_amount=0,
        quantity=shares,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        placed_order_id=f"{side}-{symbol}",
        placed_at=placed_at,
        placement_state="filled",
        placement_raw={"filled_quantity": shares, "average_price": price},
    )


def test_realized_trades_from_order_plans_pairs_buy_and_sell_fills() -> None:
    trades = realized_trades_from_order_plans(
        [
            filled_plan("buy", "AAPL", 0.5, 100, "2026-06-08T10:00:00-04:00"),
            filled_plan("sell", "AAPL", 0.5, 104, "2026-06-08T11:00:00-04:00"),
        ]
    )

    assert len(trades) == 1
    assert trades[0].symbol == "AAPL"
    assert trades[0].pnl == 2
