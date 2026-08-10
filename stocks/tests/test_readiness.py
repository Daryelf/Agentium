from __future__ import annotations

import json
from dataclasses import replace

from stock_guru.backtest import BacktestMetrics
from stock_guru.broker_client import BrokerToolStatus
from stock_guru.lifecycle import DailyRiskState, IntradayLifecycleState, LivePositionPlan, OrderPlan, save_lifecycle_state
from stock_guru.readiness import build_readiness_report, write_strategy_health, write_strategy_health_from_lifecycle
from tests.test_intraday_loop import now, settings


def armed_settings():
    return replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="argentum_human_gate_per_order")


def test_readiness_blocks_when_live_gate_is_not_armed(tmp_path) -> None:
    report = build_readiness_report(
        settings(),
        account_number="",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    assert not report.ready_for_live_auto
    assert report.blockers[0].name == "live_session_gate"


def test_readiness_blocks_unhealthy_strategy_metrics(tmp_path) -> None:
    strategy_path = write_strategy_health(
        BacktestMetrics(
            trades=3,
            wins=1,
            losses=2,
            win_rate=0.3333,
            average_win=1,
            average_loss=-2,
            expectancy=-1,
            max_drawdown=5,
        ),
        path=tmp_path / "strategy.json",
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=strategy_path,
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "strategy_health" for check in report.blockers)


def test_readiness_passes_with_armed_gate_and_healthy_metrics(tmp_path) -> None:
    strategy_path = write_strategy_health(
        BacktestMetrics(
            trades=25,
            wins=15,
            losses=10,
            win_rate=0.6,
            average_win=1.5,
            average_loss=-0.5,
            expectancy=0.7,
            max_drawdown=1,
        ),
        path=tmp_path / "strategy.json",
    )
    heartbeat_path = tmp_path / "heartbeat.json"
    heartbeat_path.write_text(json.dumps({"updated_at": now().isoformat(timespec="seconds")}) + "\n")
    optimization_path = tmp_path / "opt.json"
    optimization_path.write_text(
        json.dumps(
            {
                "generated_at": now().isoformat(timespec="seconds"),
                "report_type": "walk_forward",
                "symbols": ["TEST"],
                "best": {
                    "reasons": [],
                    "validation_reasons": [],
                    "eligible_symbols": ["TEST"],
                    "validation_metrics": {"trades": 25, "expectancy": 0.7, "max_drawdown": 1},
                },
            }
        )
        + "\n"
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=heartbeat_path,
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=strategy_path,
        optimization_report_path=optimization_path,
    )

    assert report.ready_for_live_auto
    assert not report.blockers
    assert any(check.name == "broker_tool_contract" for check in report.warnings)


def test_readiness_requires_broker_tool_status_when_requested(tmp_path) -> None:
    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        require_broker_tool_status=True,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "broker_tool_contract" for check in report.blockers)


def test_readiness_requires_reconciliation_report_when_requested(tmp_path) -> None:
    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        require_reconciliation_report=True,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        reconciliation_report_path=tmp_path / "missing_reconciliation.json",
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "broker_reconciliation" for check in report.blockers)


def test_readiness_blocks_unsafe_reconciliation_report(tmp_path) -> None:
    reconciliation_path = tmp_path / "reconciliation.json"
    reconciliation_path.write_text(
        json.dumps({"generated_at": now().isoformat(timespec="seconds"), "safe_to_arm": False}) + "\n"
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        reconciliation_report_path=reconciliation_path,
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "broker_reconciliation" for check in report.blockers)


def test_readiness_requires_account_health_report_when_requested(tmp_path) -> None:
    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        require_account_health_report=True,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        account_health_report_path=tmp_path / "missing_account_health.json",
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "broker_account_health" for check in report.blockers)


def test_readiness_blocks_unsafe_account_health_report(tmp_path) -> None:
    account_health_path = tmp_path / "account_health.json"
    account_health_path.write_text(
        json.dumps({"generated_at": now().isoformat(timespec="seconds"), "safe_for_entries": False}) + "\n"
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        account_health_report_path=account_health_path,
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "broker_account_health" for check in report.blockers)


def test_readiness_requires_capital_policy_report_when_requested(tmp_path) -> None:
    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        require_capital_policy_report=True,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        capital_policy_report_path=tmp_path / "missing_capital_policy.json",
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "capital_policy" for check in report.blockers)


def test_readiness_accepts_fresh_hold_capital_policy_as_warning(tmp_path) -> None:
    capital_policy_path = tmp_path / "capital.json"
    capital_policy_path.write_text(
        json.dumps({"generated_at": now().isoformat(timespec="seconds"), "action": "HOLD_CURRENT_BANKROLL"}) + "\n"
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        capital_policy_report_path=capital_policy_path,
    )

    check = next(item for item in report.checks if item.name == "capital_policy")
    assert check.passed
    assert check.detail == "fresh action=HOLD_CURRENT_BANKROLL"


def test_readiness_blocks_reduce_lockout_capital_policy(tmp_path) -> None:
    capital_policy_path = tmp_path / "capital.json"
    capital_policy_path.write_text(
        json.dumps({"generated_at": now().isoformat(timespec="seconds"), "action": "REDUCE_OR_LOCKOUT"}) + "\n"
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        capital_policy_report_path=capital_policy_path,
    )

    assert not report.ready_for_live_auto
    assert any(check.name == "capital_policy" for check in report.blockers)


def test_readiness_accepts_configured_broker_tool_status(tmp_path) -> None:
    report = build_readiness_report(
        settings(),
        account_number="",
        now=now(),
        broker_tool_status=BrokerToolStatus(configured=True, missing_tools=[], placement_enabled=True, cancel_enabled=False),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    check = next(item for item in report.checks if item.name == "broker_tool_contract")
    assert check.passed
    assert check.detail == "live placement tools configured"


def test_readiness_blocks_unreconciled_ready_order(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            order_plans=[
                OrderPlan(
                    side="buy",
                    symbol="TEST",
                    order_type="limit",
                    dollar_amount=25,
                    quantity=None,
                    limit_price=100,
                    stop_price=None,
                    time_in_force="gfd",
                    market_hours="regular_hours",
                    status="READY_TO_PLACE",
                )
            ],
        ),
        lifecycle_path,
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=lifecycle_path,
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    lifecycle_check = next(item for item in report.blockers if item.name == "lifecycle_state")
    assert "unplaced READY_TO_PLACE buy order" in lifecycle_check.detail


def test_readiness_blocks_failed_placement_order(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            order_plans=[
                OrderPlan(
                    side="buy",
                    symbol="TEST",
                    order_type="limit",
                    dollar_amount=25,
                    quantity=None,
                    limit_price=100,
                    stop_price=None,
                    time_in_force="gfd",
                    market_hours="regular_hours",
                    status="PLACEMENT_FAILED",
                    placement_state="Failed",
                    rejection_reasons=["broker placement failed: broker transport unavailable"],
                )
            ],
        ),
        lifecycle_path,
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=lifecycle_path,
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    lifecycle_check = next(item for item in report.blockers if item.name == "lifecycle_state")
    assert "buy order placement failed and requires reconciliation" in lifecycle_check.detail


def test_readiness_blocks_intraday_position_carried_overnight(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            positions={
                "TEST": LivePositionPlan(
                    symbol="TEST",
                    shares=1,
                    average_cost=100,
                    stop_price=98,
                    target_1=103,
                    target_2=106,
                    profit_lock_price=102,
                    thesis="test",
                    opened_at="2026-06-05T10:00:00-04:00",
                    force_exit_after="2026-06-05T15:45:00-04:00",
                )
            },
        ),
        lifecycle_path,
    )

    report = build_readiness_report(
        armed_settings(),
        account_number="A123",
        now=now(),
        lifecycle_path=lifecycle_path,
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
    )

    lifecycle_check = next(item for item in report.blockers if item.name == "lifecycle_state")
    assert "carried overnight" in lifecycle_check.detail


def filled_plan(side: str, price: float, placed_at: str) -> OrderPlan:
    return OrderPlan(
        side=side,
        symbol="TEST",
        order_type="market",
        dollar_amount=0,
        quantity=1,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        placed_order_id=f"{side}-{placed_at}",
        placed_at=placed_at,
        placement_state="filled",
        placement_raw={"filled_quantity": 1, "average_price": price},
    )


def test_write_strategy_health_from_lifecycle(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    strategy_path = tmp_path / "strategy.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date="2026-06-08"),
            order_plans=[
                filled_plan("buy", 100, "2026-06-08T10:00:00-04:00"),
                filled_plan("sell", 103, "2026-06-08T11:00:00-04:00"),
            ],
        ),
        lifecycle_path,
    )

    path, metrics = write_strategy_health_from_lifecycle(
        lifecycle_path=lifecycle_path,
        strategy_health_path=strategy_path,
        now=now(),
    )

    assert path == strategy_path
    assert metrics.trades == 1
    assert metrics.expectancy == 3
