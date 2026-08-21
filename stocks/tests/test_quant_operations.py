from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo

from stock_guru.market_calendar import MarketSession
from stock_guru.quant.operations import (
    CommandResult,
    JobSpec,
    OperatingMode,
    OperationsStore,
    QuantOperationsDaemon,
    app_scheduler_active,
    requested_operating_mode,
    rotate_log,
    scheduled_specs,
    sunday_restart_due,
)
from stock_guru.market_calendar import market_clock


EASTERN = ZoneInfo("America/New_York")


def at(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=EASTERN)


def test_mode_defaults_to_observe_and_live_request_has_no_authority() -> None:
    assert requested_operating_mode({}) == OperatingMode.OBSERVE
    assert requested_operating_mode({"STOCK_GURU_OPERATING_MODE": "paper"}) == OperatingMode.PAPER
    assert requested_operating_mode({"STOCK_GURU_OPERATING_MODE": "LIVE"}) == OperatingMode.OBSERVE


def test_market_state_schedule_uses_bounded_session_specific_jobs() -> None:
    regular = scheduled_specs(market_clock(at("2026-08-20T10:00:00")))
    weekend = scheduled_specs(market_clock(at("2026-08-22T10:00:00")))
    assert any(item.name == "market_scan" and item.cadence_minutes == 3 for item in regular)
    assert not any(item.name == "quant_backtest" for item in regular)
    assert any(item.name == "quant_backtest" for item in weekend)
    assert all(MarketSession.WEEKEND_HOLIDAY in item.sessions for item in weekend)


def test_sqlite_queue_is_idempotent_and_recovers_running_jobs(tmp_path: Path) -> None:
    store = OperationsStore(tmp_path / "operations.sqlite3")
    spec = JobSpec("scan", 5, ("evaluate",), (MarketSession.REGULAR,))
    now = at("2026-08-20T10:01:00")
    assert store.enqueue_due(now, (spec,)) == 1
    assert store.enqueue_due(now, (spec,)) == 0
    job = store.claim_next(now)
    assert job is not None
    assert store.counts() == {"running": 1}
    assert store.recover_interrupted(at("2026-08-20T10:02:00")) == 1
    assert store.counts() == {"queued": 1}


def test_daemon_cycle_persists_heartbeat_health_and_completed_job(tmp_path: Path, monkeypatch) -> None:
    import stock_guru.quant.operations as operations

    monkeypatch.setattr(operations, "OPERATIONS_HEARTBEAT_PATH", tmp_path / "heartbeat.json")
    monkeypatch.setattr(operations, "OPERATIONS_HEALTH_PATH", tmp_path / "health.json")
    monkeypatch.setattr(operations, "OPERATIONS_HEALTH_HISTORY_DIR", tmp_path / "health-history")
    monkeypatch.setattr(operations, "OPERATIONS_LOG_PATH", tmp_path / "operations.jsonl")
    store = OperationsStore(tmp_path / "operations.sqlite3")
    spec = JobSpec("scan", 5, ("evaluate",), (MarketSession.REGULAR,))
    clock = lambda: at("2026-08-20T10:01:00")
    daemon = QuantOperationsDaemon(
        store=store,
        specs=(spec,),
        command_runner=lambda _job: CommandResult(True, 0, 12, "done"),
        now_fn=clock,
    )
    result = daemon.cycle()
    assert result is not None and result.ok is True
    assert store.counts() == {"success": 1}
    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())
    health = json.loads((tmp_path / "health.json").read_text())
    assert heartbeat["mode"] == "OBSERVE"
    assert heartbeat["broker_authority"] is False
    assert health["execution"]["human_gate_required"] is True


def test_sunday_restart_is_once_per_iso_week(tmp_path: Path) -> None:
    store = OperationsStore(tmp_path / "operations.sqlite3")
    restart_at = at("2026-08-23T03:35:00")
    assert sunday_restart_due(restart_at, store) is True
    assert sunday_restart_due(restart_at, store) is False
    assert sunday_restart_due(at("2026-08-23T04:00:00"), store) is False


def test_repeated_daemon_starts_are_counted_for_watchdog_health(tmp_path: Path) -> None:
    store = OperationsStore(tmp_path / "operations.sqlite3")
    assert store.record_daemon_start(at("2026-08-20T10:00:00")) == 1
    assert store.record_daemon_start(at("2026-08-20T10:05:00")) == 2
    assert store.record_daemon_start(at("2026-08-20T10:10:00")) == 3
    assert store.record_daemon_start(at("2026-08-20T11:00:00")) == 1


def test_quant_daemon_defers_to_the_live_app_scheduler(tmp_path: Path, monkeypatch) -> None:
    import stock_guru.quant.operations as operations

    monkeypatch.setattr(operations, "OPERATIONS_HEARTBEAT_PATH", tmp_path / "heartbeat.json")
    monkeypatch.setattr(operations, "OPERATIONS_HEALTH_PATH", tmp_path / "health.json")
    monkeypatch.setattr(operations, "OPERATIONS_HEALTH_HISTORY_DIR", tmp_path / "health-history")
    status = tmp_path / "stock-intelligence-scheduler.json"
    status.write_text(json.dumps({"running": False, "nextRunAt": "2026-08-20T14:10:00Z"}))
    observed_at = datetime.fromisoformat("2026-08-20T14:00:00+00:00")
    assert app_scheduler_active(observed_at, status) is True

    store = OperationsStore(tmp_path / "operations.sqlite3")
    spec = JobSpec("scan", 5, ("evaluate",), (MarketSession.REGULAR,))
    daemon = QuantOperationsDaemon(
        store=store,
        specs=(spec,),
        command_runner=lambda _job: CommandResult(True, 0, 1, "unexpected"),
        now_fn=lambda: observed_at,
        app_scheduler_status_path=status,
    )
    assert daemon.cycle() is None
    assert store.counts() == {}


def test_log_rotation_keeps_bounded_files(tmp_path: Path) -> None:
    path = tmp_path / "quant.jsonl"
    path.write_text("x" * 20)
    rotate_log(path, maximum_bytes=10, keep=3)
    assert not path.exists()
    assert (tmp_path / "quant.jsonl.1").exists()
