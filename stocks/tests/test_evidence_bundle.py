from __future__ import annotations

import json

from stock_guru.broker import BrokerAccountState
from stock_guru.broker_client import DryRunBrokerClient
from stock_guru.evaluator import QuoteSnapshot
from stock_guru.evidence_bundle import build_local_evidence_bundle
from tests.test_intraday_loop import now, settings


def test_build_local_evidence_bundle_writes_all_artifacts(tmp_path) -> None:
    broker = DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)},
        tradability={"TEST": True},
    )

    report = build_local_evidence_bundle(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker,
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        account_health_path=tmp_path / "health.json",
        reconciliation_path=tmp_path / "reconciliation.json",
        performance_json_path=tmp_path / "performance.json",
        performance_markdown_path=tmp_path / "performance.md",
        capital_policy_path=tmp_path / "capital.json",
        checklist_path=tmp_path / "checklist.json",
        require_broker_tool_status=False,
    )

    assert report.account_health_path.exists()
    assert report.reconciliation_path.exists()
    assert report.performance_json_path.exists()
    assert report.performance_markdown_path.exists()
    assert report.capital_policy_path.exists()
    assert report.checklist_path.exists()

    health = json.loads(report.account_health_path.read_text())
    capital = json.loads(report.capital_policy_path.read_text())
    checklist = json.loads(report.checklist_path.read_text())

    assert health["safe_for_entries"] is True
    assert capital["action"] == "HOLD_CURRENT_BANKROLL"
    assert checklist["ready_for_live_auto"] is False
    assert report.performance.metrics.trades == 0


def test_build_local_evidence_bundle_surfaces_broker_health_failure(tmp_path) -> None:
    broker = DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25, warnings=["restriction warning"]),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)},
        tradability={"TEST": True},
    )

    report = build_local_evidence_bundle(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker,
        now=now(),
        lifecycle_path=tmp_path / "lifecycle.json",
        account_health_path=tmp_path / "health.json",
        reconciliation_path=tmp_path / "reconciliation.json",
        performance_json_path=tmp_path / "performance.json",
        performance_markdown_path=tmp_path / "performance.md",
        capital_policy_path=tmp_path / "capital.json",
        checklist_path=tmp_path / "checklist.json",
        require_broker_tool_status=False,
    )

    health = json.loads(report.account_health_path.read_text())
    health_artifact = next(item for item in report.checklist.artifacts if item.name == "broker_account_health")

    assert health["safe_for_entries"] is False
    assert health_artifact.passed is False
