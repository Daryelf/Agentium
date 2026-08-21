from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from stock_guru.market_context import build_market_regime
from stock_guru.quant.context import build_symbol_context
from stock_guru.quant.engine import build_quant_snapshot
from stock_guru.quant.portfolio import (
    AccountSnapshot,
    CircuitBreakerInput,
    HoldingSnapshot,
    build_portfolio_impact,
    evaluate_circuit_breakers,
    suggest_position_size,
)
from stock_guru.quant.scoring import score_symbol
from tests.test_quant_scoring import research, scoring_market


def qualified_inputs():
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    data = scoring_market()
    snapshot = build_quant_snapshot(data, "AAPL", sector_etf="XLK", generated_at=now)
    context = build_symbol_context(snapshot, research=research(now), spread_pct=0.0005, generated_at=now)
    regime = build_market_regime(data, data.tickers, generated_at=now, sectors_by_symbol={"AAPL": "XLK"})
    score = score_symbol(snapshot, context, regime, generated_at=now)
    return now, data, snapshot, replace(score, action="BUY_CANDIDATE", confidence_score=90.0, risk_score=30.0)


def test_position_sizing_respects_risk_buying_power_concentration_and_fractional_shares() -> None:
    _, data, snapshot, score = qualified_inputs()
    account = AccountSnapshot(
        account_value=100,
        buying_power=50,
        cash=50,
        settled_cash=40,
        unsettled_funds=10,
        total_invested=15,
        day_trades_last_5_sessions=3,
        open_orders=0,
    )
    holdings = [HoldingSnapshot("SPY", 15, "Index", shares=0.02)]

    suggestion = suggest_position_size(
        snapshot,
        score,
        account,
        holdings,
        sector="Technology",
        market_data=data,
        fractional_supported=True,
    )

    assert suggestion.blockers == ()
    assert suggestion.suggested_dollars is not None and suggestion.suggested_dollars <= 10
    assert suggestion.suggested_shares is not None and suggestion.suggested_shares > 0
    assert suggestion.suggested_position_pct is not None and suggestion.suggested_position_pct <= 10
    assert suggestion.portfolio_impact.available_to_allocate == 40
    assert suggestion.portfolio_impact.pdt_warning is True
    assert suggestion.execution_policy.startswith("Suggestion only")


def test_existing_position_and_open_order_block_averaging_down() -> None:
    _, data, snapshot, score = qualified_inputs()
    account = AccountSnapshot(100, 50, 50, settled_cash=50, total_invested=20)
    holdings = [HoldingSnapshot("AAPL", 20, "Technology", shares=0.1)]

    suggestion = suggest_position_size(snapshot, score, account, holdings, sector="Technology", market_data=data, open_order_symbols=["AAPL"])

    assert suggestion.suggested_dollars is None
    assert any("Existing position" in blocker for blocker in suggestion.blockers)
    assert any("open order" in blocker for blocker in suggestion.blockers)


def test_portfolio_impact_detects_sector_limit_and_settlement_state() -> None:
    account = AccountSnapshot(100, 50, 50, settled_cash=5, unsettled_funds=45, total_invested=35)
    holdings = [HoldingSnapshot("NVDA", 28, "Technology")]
    impact = build_portfolio_impact("AAPL", "Technology", account, holdings, proposed_dollars=10)

    assert impact.projected_sector_pct == 0.38
    assert impact.concentration_state == "HIGH"
    assert impact.settlement_state == "SETTLED_ONLY"
    assert impact.available_to_allocate == 5


def test_circuit_breakers_never_auto_enable_live_and_keep_risk_exits_available() -> None:
    unauthorized = evaluate_circuit_breakers(CircuitBreakerInput(requested_mode="LIVE", live_authorized=False))
    conflicted = evaluate_circuit_breakers(CircuitBreakerInput(requested_mode="LIVE", live_authorized=True, provider_conflicts=3))
    healthy_paper = evaluate_circuit_breakers(CircuitBreakerInput(requested_mode="PAPER"))

    assert unauthorized.effective_mode == "OBSERVE"
    assert unauthorized.allow_new_positions is False
    assert unauthorized.allow_risk_reducing_exits is True
    assert conflicted.effective_mode == "OBSERVE"
    assert healthy_paper.effective_mode == "PAPER"
    assert healthy_paper.allow_new_positions is True
