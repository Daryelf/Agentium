from __future__ import annotations

from datetime import datetime
from dataclasses import replace
from zoneinfo import ZoneInfo

from stock_guru.config import Settings
from stock_guru.live_autonomy import kill_switch_active, live_auto_enabled, live_auto_reasons, live_session_gate, write_kill_switch


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


def test_live_auto_defaults_to_blocked() -> None:
    reasons = live_auto_reasons(settings(), account_number="")

    assert "live auto trading is disabled" in reasons
    assert "explicit Agentic account number is required" in reasons
    assert not live_auto_enabled(settings(), account_number="")


def test_supervised_planning_arms_with_account_and_argentum_human_gate_policy() -> None:
    armed = replace(
        settings(),
        live_auto_trading_enabled=True,
        live_order_confirmation_policy="argentum_human_gate_per_order",
    )

    assert live_auto_enabled(armed, account_number="A123")


def test_live_auto_blocks_manual_confirmation_policy() -> None:
    manual = replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="manual_per_order")

    reasons = live_auto_reasons(manual, account_number="A123")

    assert "confirmation policy must use Argentum Human Gate approval per order" in reasons


def test_broker_review_alone_cannot_arm_direct_placement() -> None:
    unsafe = replace(
        settings(),
        live_auto_trading_enabled=True,
        live_order_confirmation_policy="broker_review_only",
    )

    reasons = live_auto_reasons(unsafe, account_number="A123")

    assert "broker review alone cannot authorize placement; Argentum Human Gate approval is required per order" in reasons
    assert not live_auto_enabled(unsafe, account_number="A123")


def test_live_session_gate_arms_during_regular_market_hours(tmp_path) -> None:
    armed = replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="argentum_human_gate_per_order")

    gate = live_session_gate(
        armed,
        account_number="A123",
        now=datetime(2026, 6, 8, 10, 0, tzinfo=ZoneInfo("America/New_York")),
        kill_switch_path=tmp_path / "kill.json",
    )

    assert gate.armed
    assert gate.allow_buys
    assert gate.allow_sells


def test_kill_switch_blocks_buys_but_allows_sells(tmp_path) -> None:
    path = write_kill_switch(True, reason="panic", path=tmp_path / "kill.json")
    armed = replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="argentum_human_gate_per_order")

    gate = live_session_gate(
        armed,
        account_number="A123",
        now=datetime(2026, 6, 8, 10, 0, tzinfo=ZoneInfo("America/New_York")),
        kill_switch_path=path,
    )

    assert kill_switch_active(path)
    assert not gate.armed
    assert not gate.allow_buys
    assert gate.allow_sells
