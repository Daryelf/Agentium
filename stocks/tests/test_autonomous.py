from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from stock_guru.autonomous import AutonomousCycleReport, run_autonomous_cycle, run_autonomous_session
from stock_guru.live_autonomy import LiveSessionGate
from stock_guru.backtest import BacktestMetrics
from stock_guru.broker_client import BrokerPosition, DryRunBrokerClient
from stock_guru.live_autonomy import write_kill_switch
from stock_guru.lifecycle import save_lifecycle_state
from stock_guru.strategy_health import write_strategy_health
from tests.test_intraday_loop import account, intraday_frame, lifecycle_with_position, now, quote, settings


def armed_settings():
    return replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="broker_review_only")


def optimization_path(tmp_path, eligible_symbols=None):
    path = tmp_path / "optimization.json"
    path.write_text(
        json.dumps(
            {
                "generated_at": now().isoformat(timespec="seconds"),
                "report_type": "walk_forward",
                "symbols": ["TEST"],
                "best": {
                    "reasons": [],
                    "validation_reasons": [],
                    "eligible_symbols": eligible_symbols if eligible_symbols is not None else ["TEST"],
                    "validation_metrics": {"trades": 25, "expectancy": 0.7, "max_drawdown": 1},
                    "settings": {
                        "intraday_min_entry_score": 85,
                        "intraday_auto_order_score": 90,
                        "intraday_min_relative_volume": 1.2,
                        "intraday_max_spread_pct": 0.005,
                    },
                },
            }
        )
        + "\n"
    )
    return path


def test_autonomous_cycle_places_when_gate_is_armed(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame())
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )
    strategy_path = write_strategy_health(
        BacktestMetrics(25, 15, 10, 0.6, 1.5, -0.5, 0.7, 1),
        path=tmp_path / "strategy.json",
        eligible_symbols=["TEST"],
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=strategy_path,
        optimization_report_path=optimization_path(tmp_path),
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())
    lifecycle = json.loads((tmp_path / "lifecycle.json").read_text())

    assert report.placed_orders == 1
    assert heartbeat["live_auto_armed"] is True
    assert lifecycle["order_plans"][0]["placed_order_id"]


def test_autonomous_kill_switch_blocks_buys(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame())
    kill_path = write_kill_switch(True, reason="test", path=tmp_path / "kill.json")
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )
    strategy_path = write_strategy_health(
        BacktestMetrics(25, 15, 10, 0.6, 1.5, -0.5, 0.7, 1),
        path=tmp_path / "strategy.json",
        eligible_symbols=["TEST"],
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=kill_path,
        strategy_health_path=strategy_path,
        optimization_report_path=optimization_path(tmp_path),
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())
    lifecycle = json.loads((tmp_path / "lifecycle.json").read_text())

    assert report.placed_orders == 0
    assert heartbeat["allow_buys"] is False
    assert heartbeat["allow_sells"] is True
    assert "live auto kill switch is active" in lifecycle["intents"][0]["rejection_reasons"]


def test_autonomous_kill_switch_still_allows_stop_exit(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame(last=97))
    kill_path = write_kill_switch(True, reason="test", path=tmp_path / "kill.json")
    lifecycle_path = save_lifecycle_state(lifecycle_with_position(), tmp_path / "lifecycle.json")
    broker = DryRunBrokerClient(
        account=account(),
        positions=[BrokerPosition("TEST", 0.25, 100)],
        quotes={"TEST": quote("TEST", last=97), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )
    strategy_path = write_strategy_health(
        BacktestMetrics(25, 15, 10, 0.6, 1.5, -0.5, 0.7, 1),
        path=tmp_path / "strategy.json",
        eligible_symbols=["TEST"],
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=lifecycle_path,
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=kill_path,
        strategy_health_path=strategy_path,
        optimization_report_path=optimization_path(tmp_path),
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())

    assert report.placed_orders == 1
    assert heartbeat["allow_buys"] is False
    assert heartbeat["allow_sells"] is True
    assert broker.placed_orders[0].side == "sell"


def test_autonomous_strategy_health_blocks_buys(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame())
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "missing_strategy.json",
        optimization_report_path=optimization_path(tmp_path),
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())
    lifecycle = json.loads((tmp_path / "lifecycle.json").read_text())

    assert report.placed_orders == 0
    assert heartbeat["strategy_health_reasons"] == ["strategy health metrics missing"]
    assert report.next_action == "stand down; entry evidence blocks new entries"
    assert "strategy health metrics missing" in lifecycle["intents"][0]["rejection_reasons"]


def test_autonomous_blocks_buys_when_selected_symbol_is_not_replay_qualified(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame())
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )
    strategy_path = write_strategy_health(
        BacktestMetrics(25, 15, 10, 0.6, 1.5, -0.5, 0.7, 1),
        path=tmp_path / "strategy.json",
        eligible_symbols=["OTHER"],
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=strategy_path,
        optimization_report_path=optimization_path(tmp_path, eligible_symbols=["OTHER"]),
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())

    assert report.placed_orders == 0
    assert "no replay-qualified symbols selected" in heartbeat["strategy_health_reasons"]


def test_autonomous_missing_optimization_blocks_buys(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.autonomous.download_history", lambda *args, **kwargs: intraday_frame())
    broker = DryRunBrokerClient(
        account=account(),
        quotes={"TEST": quote("TEST"), "SPY": quote("SPY"), "QQQ": quote("QQQ")},
    )
    strategy_path = write_strategy_health(
        BacktestMetrics(25, 15, 10, 0.6, 1.5, -0.5, 0.7, 1),
        path=tmp_path / "strategy.json",
        eligible_symbols=["TEST"],
    )

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=broker,
        account_number="A123",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=strategy_path,
        optimization_report_path=tmp_path / "missing_optimization.json",
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())

    assert report.placed_orders == 0
    assert "replay optimization report missing" in heartbeat["strategy_health_reasons"]


def test_autonomous_cycle_stands_down_without_broker_calls_when_gate_fully_blocked(monkeypatch, tmp_path) -> None:
    def fail_download(*args, **kwargs):
        raise AssertionError("download_history should not run when live gate is fully blocked")

    monkeypatch.setattr("stock_guru.autonomous.download_history", fail_download)
    broker = DryRunBrokerClient(account=account())

    def fail_broker_call(*args, **kwargs):
        raise AssertionError("broker should not be queried when live gate is fully blocked")

    broker.get_portfolio = fail_broker_call
    broker.get_positions = fail_broker_call
    broker.get_orders = fail_broker_call
    broker.get_quotes = fail_broker_call
    broker.get_tradability = fail_broker_call
    broker.review_order = fail_broker_call
    broker.place_order = fail_broker_call

    report = run_autonomous_cycle(
        symbols=["TEST"],
        settings=settings(),
        broker=broker,
        account_number="",
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    heartbeat = json.loads((tmp_path / "heartbeat.json").read_text())
    lifecycle = json.loads((tmp_path / "lifecycle.json").read_text())

    assert report.placed_orders == 0
    assert report.gate.armed is False
    assert heartbeat["live_auto_armed"] is False
    assert heartbeat["next_action"] == "stand down; live auto gate is blocked"
    assert "live auto trading is disabled" in lifecycle["intents"][0]["rejection_reasons"]
    assert "explicit Agentic account number is required" in lifecycle["intents"][0]["rejection_reasons"]


def cycle_report(*, armed=True, allow_sells=True, placed_orders=0) -> AutonomousCycleReport:
    gate = LiveSessionGate(
        armed=armed,
        allow_buys=armed,
        allow_sells=allow_sells,
        reasons=[] if armed else ["market is closed"],
    )
    return AutonomousCycleReport(
        gate=gate,
        lifecycle_path=Path("unused.json"),
        heartbeat_path=Path("unused.json"),
        placed_orders=placed_orders,
        ready_orders=0,
        rejected_orders=0,
        next_action="wait for a cleaner setup",
    )

def test_autonomous_session_runs_bounded_cycles_and_writes_state(tmp_path) -> None:
    calls = []
    pauses = []

    def fake_cycle(**kwargs):
        calls.append(kwargs)
        return cycle_report(armed=True)

    report = run_autonomous_session(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=DryRunBrokerClient(account=account()),
        account_number="A123",
        interval_seconds=0.25,
        max_cycles=2,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        session_path=tmp_path / "session.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
        now_fn=now,
        sleep_fn=pauses.append,
        cycle_fn=fake_cycle,
    )

    payload = json.loads((tmp_path / "session.json").read_text())

    assert len(calls) == 2
    assert pauses == [0.25]
    assert report.stopped_reason == "max cycles reached"
    assert payload["last_cycle"]["cycle"] == 2


def test_autonomous_session_stops_when_live_gate_is_blocked(tmp_path) -> None:
    pauses = []

    report = run_autonomous_session(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=DryRunBrokerClient(account=account()),
        account_number="A123",
        interval_seconds=0.25,
        max_cycles=5,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        session_path=tmp_path / "session.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
        now_fn=now,
        sleep_fn=pauses.append,
        cycle_fn=lambda **kwargs: cycle_report(armed=False, allow_sells=False),
    )

    assert len(report.cycles) == 1
    assert report.stopped_reason == "live gate blocked"
    assert pauses == []


def test_autonomous_session_enables_kill_switch_after_repeated_errors(tmp_path) -> None:
    attempts = []

    def failing_cycle(**kwargs):
        attempts.append(kwargs)
        raise RuntimeError("broker transport unavailable")

    report = run_autonomous_session(
        symbols=["TEST"],
        settings=armed_settings(),
        broker=DryRunBrokerClient(account=account()),
        account_number="A123",
        interval_seconds=0,
        max_cycles=5,
        max_consecutive_errors=2,
        lifecycle_path=tmp_path / "lifecycle.json",
        heartbeat_path=tmp_path / "heartbeat.json",
        session_path=tmp_path / "session.json",
        kill_switch_path=tmp_path / "kill.json",
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
        now_fn=now,
        sleep_fn=lambda seconds: None,
        cycle_fn=failing_cycle,
    )

    kill_payload = json.loads((tmp_path / "kill.json").read_text())

    assert len(attempts) == 2
    assert report.stopped_reason == "consecutive error limit reached; kill switch enabled"
    assert kill_payload["enabled"] is True
    assert "broker transport unavailable" in kill_payload["reason"]
