from __future__ import annotations

import json
from dataclasses import replace

from stock_guru.broker import BrokerAccountState
from stock_guru.broker_client import DryRunBrokerClient
from stock_guru.evaluator import QuoteSnapshot
from stock_guru.preparation import prepare_live_auto
from tests.test_intraday_loop import intraday_frame, now, settings


def test_prepare_live_auto_writes_evidence_artifacts(tmp_path) -> None:
    report = prepare_live_auto(
        symbols=["TEST"],
        settings=replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="argentum_human_gate_per_order"),
        account_number="A123",
        now=now(),
        data=intraday_frame(),
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
    )

    strategy_payload = json.loads((tmp_path / "strategy.json").read_text())
    optimization_payload = json.loads((tmp_path / "optimization.json").read_text())

    assert "metrics" in strategy_payload
    assert optimization_payload["report_type"] == "walk_forward"
    assert report.strategy_health_path == tmp_path / "strategy.json"
    assert report.optimization_report_path == tmp_path / "optimization.json"
    assert report.readiness.generated_at == now().isoformat(timespec="seconds")


def test_prepare_live_auto_can_include_local_evidence_bundle(tmp_path) -> None:
    broker = DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)},
        tradability={"TEST": True},
    )

    report = prepare_live_auto(
        symbols=["TEST"],
        settings=replace(settings(), live_auto_trading_enabled=True, live_order_confirmation_policy="argentum_human_gate_per_order"),
        account_number="A123",
        now=now(),
        data=intraday_frame(),
        broker=broker,
        strategy_health_path=tmp_path / "strategy.json",
        optimization_report_path=tmp_path / "optimization.json",
        require_broker_tool_status=False,
    )

    assert report.evidence_bundle is not None
    assert report.evidence_bundle.account_health_path.exists()
    assert report.evidence_bundle.capital_policy_path.exists()
    assert report.evidence_bundle.checklist_path.exists()
