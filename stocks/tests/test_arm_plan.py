from __future__ import annotations

import json
from dataclasses import replace

from stock_guru.arm_plan import ACTION_NOT_ARMABLE, ACTION_READY_TO_ARM, build_live_auto_arm_plan, required_config_changes, write_arm_plan
from stock_guru.readiness import ReadinessCheck, ReadinessReport
from tests.test_intraday_loop import now, settings


def test_required_config_changes_show_exact_live_auto_fields() -> None:
    changes = required_config_changes(settings(), account_number="A123")

    fields = {change.field for change in changes}
    assert fields == {"live_account_number", "live_auto_trading_enabled"}


def test_arm_plan_default_settings_are_not_armable() -> None:
    plan = build_live_auto_arm_plan(settings=settings(), account_number="A123", now=now())

    assert plan.action == ACTION_NOT_ARMABLE
    assert any(change.field == "live_auto_trading_enabled" for change in plan.config_changes)
    assert plan.blockers


def test_arm_plan_ready_when_config_and_readiness_are_clean(monkeypatch) -> None:
    clean_readiness = ReadinessReport(
        ready_for_live_auto=True,
        checks=[ReadinessCheck("all", True, "blocker", "ok")],
        generated_at=now().isoformat(timespec="seconds"),
    )
    monkeypatch.setattr("stock_guru.arm_plan.build_readiness_report", lambda *args, **kwargs: clean_readiness)
    armed = replace(
        settings(),
        live_account_number="A123",
        live_auto_trading_enabled=True,
        live_order_confirmation_policy="argentum_human_gate_per_order",
    )

    plan = build_live_auto_arm_plan(settings=armed, account_number="A123", now=now())

    assert plan.action == ACTION_READY_TO_ARM
    assert plan.config_changes == []
    assert plan.blockers == []


def test_write_arm_plan(tmp_path) -> None:
    plan = build_live_auto_arm_plan(settings=settings(), account_number="A123", now=now())

    path = write_arm_plan(plan, tmp_path / "arm.json")
    payload = json.loads(path.read_text())

    assert payload["action"] == ACTION_NOT_ARMABLE
    assert payload["config_changes"]
