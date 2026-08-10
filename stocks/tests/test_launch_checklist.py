from __future__ import annotations

import json

from stock_guru.launch_checklist import build_launch_checklist, write_launch_checklist
from tests.test_intraday_loop import now, settings


def write_json(path, payload):
    path.write_text(json.dumps(payload) + "\n")
    return path


def test_launch_checklist_reports_missing_artifacts_and_next_steps(tmp_path) -> None:
    report = build_launch_checklist(
        settings=settings(),
        account_number="",
        now=now(),
        heartbeat_path=tmp_path / "heartbeat.json",
        reconciliation_report_path=tmp_path / "reconciliation.json",
        account_health_report_path=tmp_path / "health.json",
        performance_report_path=tmp_path / "performance.json",
        capital_policy_report_path=tmp_path / "capital.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    assert not report.ready_for_live_auto
    assert {item.name for item in report.blockers} >= {
        "broker_reconciliation",
        "broker_account_health",
        "performance_audit",
        "capital_policy",
        "strategy_health",
        "replay_optimization",
    }
    assert "run live-auto-health with live broker account, quotes, and tradability" in report.next_steps


def test_launch_checklist_artifacts_pass_when_fresh_and_safe(tmp_path) -> None:
    generated_at = now().isoformat(timespec="seconds")
    heartbeat = write_json(tmp_path / "heartbeat.json", {"updated_at": generated_at})
    reconciliation = write_json(tmp_path / "reconciliation.json", {"generated_at": generated_at, "safe_to_arm": True})
    health = write_json(tmp_path / "health.json", {"generated_at": generated_at, "safe_for_entries": True})
    performance = write_json(tmp_path / "performance.json", {"generated_at": generated_at, "capital_scale_ready": False})
    capital = write_json(tmp_path / "capital.json", {"generated_at": generated_at, "action": "HOLD_CURRENT_BANKROLL"})
    strategy = write_json(tmp_path / "strategy.json", {"metrics": {"trades": 25, "expectancy": 0.7, "max_drawdown": 1}})
    optimization = write_json(
        tmp_path / "optimization.json",
        {
            "generated_at": generated_at,
            "report_type": "walk_forward",
            "best": {"validation_reasons": [], "validation_metrics": {"trades": 25}, "eligible_symbols": ["TEST"]},
        },
    )

    report = build_launch_checklist(
        settings=settings(),
        account_number="A123",
        now=now(),
        require_broker_tool_status=False,
        heartbeat_path=heartbeat,
        reconciliation_report_path=reconciliation,
        account_health_report_path=health,
        performance_report_path=performance,
        capital_policy_report_path=capital,
        strategy_health_path=strategy,
        optimization_report_path=optimization,
    )

    assert not report.blockers
    assert all(item.exists for item in report.artifacts)
    assert next(item for item in report.artifacts if item.name == "capital_policy").passed


def test_launch_checklist_blocks_weak_strategy_health_even_when_file_exists(tmp_path) -> None:
    strategy = write_json(tmp_path / "strategy.json", {"metrics": {"trades": 0, "expectancy": 0, "max_drawdown": 0}})

    report = build_launch_checklist(
        settings=settings(),
        account_number="A123",
        now=now(),
        strategy_health_path=strategy,
        heartbeat_path=tmp_path / "heartbeat.json",
        reconciliation_report_path=tmp_path / "reconciliation.json",
        account_health_report_path=tmp_path / "health.json",
        performance_report_path=tmp_path / "performance.json",
        capital_policy_report_path=tmp_path / "capital.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    strategy_check = next(item for item in report.artifacts if item.name == "strategy_health")
    assert strategy_check.exists
    assert not strategy_check.passed
    assert strategy_check.severity == "blocker"
    assert "strategy trade sample too small" in strategy_check.detail


def test_launch_checklist_blocks_invalid_optimization_even_when_file_exists(tmp_path) -> None:
    optimization = write_json(
        tmp_path / "optimization.json",
        {
            "generated_at": now().isoformat(timespec="seconds"),
            "report_type": "single_pass",
            "best": {"validation_reasons": [], "eligible_symbols": ["TEST"]},
        },
    )

    report = build_launch_checklist(
        settings=settings(),
        account_number="A123",
        now=now(),
        optimization_report_path=optimization,
        heartbeat_path=tmp_path / "heartbeat.json",
        reconciliation_report_path=tmp_path / "reconciliation.json",
        account_health_report_path=tmp_path / "health.json",
        performance_report_path=tmp_path / "performance.json",
        capital_policy_report_path=tmp_path / "capital.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    optimization_check = next(item for item in report.artifacts if item.name == "replay_optimization")
    assert optimization_check.exists
    assert not optimization_check.passed
    assert optimization_check.severity == "blocker"
    assert "walk-forward optimization report required" in optimization_check.detail


def test_launch_checklist_blocks_reduce_lockout_capital_policy(tmp_path) -> None:
    generated_at = now().isoformat(timespec="seconds")
    capital = write_json(tmp_path / "capital.json", {"generated_at": generated_at, "action": "REDUCE_OR_LOCKOUT"})

    report = build_launch_checklist(
        settings=settings(),
        account_number="A123",
        now=now(),
        capital_policy_report_path=capital,
        heartbeat_path=tmp_path / "heartbeat.json",
        reconciliation_report_path=tmp_path / "reconciliation.json",
        account_health_report_path=tmp_path / "health.json",
        performance_report_path=tmp_path / "performance.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    capital_check = next(item for item in report.artifacts if item.name == "capital_policy")
    assert not capital_check.passed
    assert capital_check.severity == "blocker"


def test_launch_checklist_writes_json(tmp_path) -> None:
    report = build_launch_checklist(
        settings=settings(),
        account_number="",
        now=now(),
        heartbeat_path=tmp_path / "heartbeat.json",
        reconciliation_report_path=tmp_path / "reconciliation.json",
        account_health_report_path=tmp_path / "health.json",
        performance_report_path=tmp_path / "performance.json",
        capital_policy_report_path=tmp_path / "capital.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    path = write_launch_checklist(report, tmp_path / "checklist.json")
    payload = json.loads(path.read_text())

    assert payload["ready_for_live_auto"] is False
    assert payload["artifacts"]
