from __future__ import annotations

import json
from dataclasses import replace

from stock_guru.capital_policy import (
    ACTION_HOLD,
    ACTION_REDUCE_LOCKOUT,
    ACTION_SCALE_UP,
    capital_policy_from_payload,
    capital_policy_from_performance_report,
    write_capital_policy_report,
)
from tests.test_intraday_loop import now, settings


def payload(*, trades=25, expectancy=0.5, drawdown=1.0, profit_factor=1.5, ready=True, reasons=None):
    return {
        "capital_scale_ready": ready,
        "profit_factor": profit_factor,
        "reasons": reasons or [],
        "metrics": {
            "trades": trades,
            "expectancy": expectancy,
            "max_drawdown": drawdown,
        },
    }


def tuned_settings():
    return replace(
        settings(),
        live_principal_dollars=25,
        live_max_total_dollars=25,
        live_max_order_dollars=25,
        live_min_strategy_trades=20,
        live_min_strategy_expectancy=0,
        live_max_strategy_drawdown_pct=0.08,
        live_min_profit_factor_to_scale=1.2,
        live_scale_up_multiplier=1.25,
        live_max_scale_step_dollars=25,
    )


def test_capital_policy_holds_when_performance_report_missing() -> None:
    decision = capital_policy_from_payload(settings=tuned_settings(), payload=None, now=now())

    assert decision.action == ACTION_HOLD
    assert decision.recommended_max_total_dollars == 25
    assert "performance audit report missing" in decision.reasons


def test_capital_policy_holds_weak_performance() -> None:
    decision = capital_policy_from_payload(
        settings=tuned_settings(),
        payload=payload(trades=3, expectancy=0, profit_factor=0.8, ready=False),
        now=now(),
    )

    assert decision.action == ACTION_HOLD
    assert any("trade sample too small" in reason for reason in decision.reasons)
    assert any("profit factor too low" in reason for reason in decision.reasons)


def test_capital_policy_reduces_or_locks_out_bad_performance() -> None:
    decision = capital_policy_from_payload(
        settings=tuned_settings(),
        payload=payload(trades=25, expectancy=-0.25, drawdown=5, profit_factor=0.5, ready=False),
        now=now(),
    )

    assert decision.action == ACTION_REDUCE_LOCKOUT


def test_capital_policy_scales_up_only_when_audit_is_strong() -> None:
    decision = capital_policy_from_payload(
        settings=tuned_settings(),
        payload=payload(trades=30, expectancy=0.25, drawdown=0.5, profit_factor=1.6, ready=True),
        now=now(),
    )

    assert decision.action == ACTION_SCALE_UP
    assert decision.recommended_max_total_dollars == 31.25
    assert decision.recommended_principal_dollars == 31.25
    assert decision.reasons == []


def test_capital_policy_reads_and_writes_report(tmp_path) -> None:
    performance_path = tmp_path / "performance.json"
    performance_path.write_text(json.dumps(payload(trades=30, expectancy=0.25, drawdown=0.5, profit_factor=1.6)) + "\n")

    decision = capital_policy_from_performance_report(
        settings=tuned_settings(),
        performance_report_path=performance_path,
        now=now(),
    )
    path = write_capital_policy_report(decision, tmp_path / "capital.json")
    saved = json.loads(path.read_text())

    assert saved["action"] == ACTION_SCALE_UP
    assert saved["recommended_max_total_dollars"] == 31.25
