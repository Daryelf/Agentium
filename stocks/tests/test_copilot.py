from __future__ import annotations

import pytest

from stock_guru.bot import BotDecision, BotPosition, BotSnapshot, BotState
from stock_guru.copilot import build_trade_ticket


def snapshot(decision: BotDecision, state: BotState | None = None) -> BotSnapshot:
    return BotSnapshot(
        state=state or BotState(starting_cash=20, cash=20, positions={}),
        equity=20,
        unrealized_pnl=0,
        decision=decision,
        candidates=[],
    )


def test_buy_ticket_adds_stop_and_take_profit() -> None:
    ticket = build_trade_ticket(
        snapshot(BotDecision("BUY", "AAPL", "entry score", shares=0.025, price=200, notional=5)),
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
    )

    assert ticket.action == "BUY"
    assert ticket.ticker == "AAPL"
    assert ticket.stop_price == pytest.approx(196)
    assert ticket.take_profit_price == pytest.approx(206)
    assert ticket.cash_now == 20
    assert ticket.cash_after_signal == 15
    assert ticket.generated_at is not None
    assert ticket.expires_at is not None
    assert ticket.manual_broker_action_required is True


def test_hold_ticket_shows_position_guardrails() -> None:
    state = BotState(
        starting_cash=20,
        cash=0,
        positions={"AAPL": BotPosition("AAPL", shares=0.1, avg_cost=200)},
    )

    ticket = build_trade_ticket(
        snapshot(BotDecision("HOLD", None, "already holding a position"), state),
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
    )

    assert ticket.action == "HOLD"
    assert ticket.ticker == "AAPL"
    assert ticket.stop_price == pytest.approx(196)
    assert ticket.take_profit_price == pytest.approx(206)
