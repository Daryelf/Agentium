from pathlib import Path
from dataclasses import replace

import pytest

from stock_guru.bot import BotPosition, BotState, apply_buy, maybe_buy, maybe_sell, run_bot_once, save_bot_state
from stock_guru.config import Settings
from stock_guru.evaluator import TradeEvaluation
from stock_guru.scoring import Candidate


def settings() -> Settings:
    return Settings(
        default_budget=20,
        max_positions=1,
        max_position_pct=1.0,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.08,
        min_price=5,
        min_dollar_volume=1_000_000,
        market_timezone="America/New_York",
        regular_market_open="09:30",
        regular_market_close="16:00",
    )


def candidate(ticker: str = "AAPL", price: float = 100.0, score: float = 80.0) -> Candidate:
    return Candidate(
        ticker=ticker,
        price=price,
        score=score,
        rating="Strong",
        daily_return=0.01,
        momentum_5d=0.03,
        momentum_20d=0.08,
        momentum_60d=0.12,
        volatility_20d=0.2,
        drawdown_from_high=-0.01,
        dollar_volume=100_000_000,
        suggested_dollars=20,
        suggested_shares=0,
        reasons=("uptrend", "liquid"),
    )


def evaluation(decision: str = "VALID_BUY_SETUP") -> TradeEvaluation:
    return TradeEvaluation(
        ticker="AAPL",
        decision=decision,
        setup_type="Trend Continuation",
        score=82,
        confidence="medium",
        current_price=100,
        entry_zone="99.50-100.50",
        stop_loss=98,
        target_1=104,
        target_2=106,
        risk_reward="1:2.0",
        market_condition="strong bullish trend",
        volume_confirmation=True,
        trend_confirmation=True,
        liquidity_passed=True,
        spread_passed=True,
        data_fresh=True,
        hard_rejection_triggered=False,
        rejection_reason="",
        main_reason_valid="trend aligned",
        main_risk="setup fails below support",
        invalidation_rule="Invalid below 98.",
    )


def test_paper_bot_buys_fractional_shares_with_small_bankroll() -> None:
    state = BotState(starting_cash=20, cash=20, positions={})
    decision = maybe_buy(
        state=state,
        candidates=[candidate(price=200)],
        settings=settings(),
        entry_score=72,
        min_trade_dollars=1,
    )

    assert decision.action == "BUY"
    assert decision.shares == 0.1
    assert decision.notional == 20

    bought = apply_buy(state, decision)
    assert bought.cash == 0
    assert bought.positions["AAPL"].shares == 0.1


def test_paper_bot_can_buy_a_staged_ticket_and_keep_cash() -> None:
    state = BotState(starting_cash=20, cash=20, positions={})
    decision = maybe_buy(
        state=state,
        candidates=[candidate(price=100)],
        settings=replace(settings(), max_positions=4),
        entry_score=72,
        min_trade_dollars=1,
        trade_dollars=5,
    )

    assert decision.action == "BUY"
    assert decision.shares == 0.05
    assert decision.notional == 5

    bought = apply_buy(state, decision)
    assert bought.cash == 15
    assert bought.positions["AAPL"].shares == 0.05


def test_evaluator_backed_bot_reasons_are_user_friendly() -> None:
    state = BotState(starting_cash=20, cash=20, positions={})
    buy = maybe_buy(
        state=state,
        candidates=[candidate(price=100)],
        settings=replace(settings(), max_positions=4),
        entry_score=72,
        min_trade_dollars=1,
        trade_dollars=5,
        evaluations={"AAPL": evaluation()},
    )
    sell = maybe_sell(
        state=BotState(starting_cash=20, cash=0, positions={"AAPL": BotPosition("AAPL", shares=0.05, avg_cost=100)}),
        candidates={"AAPL": candidate(price=100, score=80)},
        prices={"AAPL": 100},
        settings=settings(),
        exit_score=55,
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
        evaluations={"AAPL": evaluation("VALID_SELL_SIGNAL")},
        dry_run=False,
    )

    assert "engine" not in buy.reason
    assert buy.reason.startswith("buy alert")
    assert "engine" not in sell.reason
    assert sell.reason.startswith("sell alert")


def test_paper_bot_buy_persists_evaluator_exit_plan() -> None:
    state = BotState(starting_cash=20, cash=20, positions={})
    decision = maybe_buy(
        state=state,
        candidates=[candidate(price=100)],
        settings=replace(settings(), max_positions=4),
        entry_score=72,
        min_trade_dollars=1,
        trade_dollars=5,
        evaluations={"AAPL": evaluation()},
    )

    bought = apply_buy(state, decision)
    position = bought.positions["AAPL"]

    assert decision.stop_price == 98
    assert decision.take_profit_price == 104
    assert position.stop_price == 98
    assert position.take_profit_price == 104


def test_paper_bot_stop_loss_sells_position() -> None:
    state = BotState(
        starting_cash=20,
        cash=0,
        positions={"AAPL": BotPosition("AAPL", shares=0.2, avg_cost=100)},
    )

    decision = maybe_sell(
        state=state,
        candidates={"AAPL": candidate(price=97, score=80)},
        prices={"AAPL": 97},
        settings=settings(),
        exit_score=55,
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
        dry_run=False,
    )

    assert decision.action == "SELL"
    assert decision.reason == "paper bot stop loss"
    assert decision.notional == pytest.approx(19.4)


def test_paper_bot_stored_stop_sells_before_hard_stop() -> None:
    state = BotState(
        starting_cash=20,
        cash=0,
        positions={"AAPL": BotPosition("AAPL", shares=0.2, avg_cost=100, stop_price=99, take_profit_price=103)},
    )

    decision = maybe_sell(
        state=state,
        candidates={"AAPL": candidate(price=98.8, score=80)},
        prices={"AAPL": 98.8},
        settings=settings(),
        exit_score=55,
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
        dry_run=False,
    )

    assert decision.action == "SELL"
    assert decision.reason == "paper bot planned stop"
    assert decision.notional == pytest.approx(19.76)


def test_paper_bot_trailing_profit_lock_sells_after_pullback() -> None:
    state = BotState(
        starting_cash=20,
        cash=0,
        positions={"AAPL": BotPosition("AAPL", shares=0.2, avg_cost=100, high_price=104)},
    )

    decision = maybe_sell(
        state=state,
        candidates={"AAPL": candidate(price=101.8, score=80)},
        prices={"AAPL": 101.8},
        settings=settings(),
        exit_score=55,
        stop_loss_pct=0.02,
        take_profit_pct=0.03,
        dry_run=False,
    )

    assert decision.action == "SELL"
    assert decision.reason == "paper bot trailing profit lock"
    assert decision.notional == pytest.approx(20.36)


def test_paper_bot_dry_run_does_not_write_state(tmp_path: Path) -> None:
    state_path = tmp_path / "bot_state.json"
    save_bot_state(BotState(starting_cash=20, cash=20, positions={}), state_path)

    snapshot = run_bot_once(
        candidates=[candidate(price=100, score=80)],
        settings=settings(),
        starting_cash=20,
        dry_run=True,
        state_path=state_path,
    )

    assert snapshot.decision.action == "BUY"
    assert snapshot.state.cash == 20
    assert '"cash": 20' in state_path.read_text()
