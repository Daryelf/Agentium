from __future__ import annotations

import json

from stock_guru.account_health import build_account_health_report, write_account_health_report
from stock_guru.broker import BrokerAccountState
from stock_guru.broker_client import BrokerOrder, DryRunBrokerClient
from stock_guru.evaluator import QuoteSnapshot
from tests.test_intraday_loop import now, settings


def broker(*, account=None, quotes=None, tradability=None, orders=None) -> DryRunBrokerClient:
    return DryRunBrokerClient(
        account=account or BrokerAccountState("A123", 25, 25, 25),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)} if quotes is None else quotes,
        tradability={"TEST": True} if tradability is None else tradability,
        orders=[] if orders is None else orders,
    )


def test_account_health_passes_clean_account_symbol_quote_and_tradability() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(),
        now=now(),
    )

    assert report.safe_for_entries
    assert report.blockers == []
    assert report.symbols_checked == ["TEST"]


def test_account_health_blocks_broker_warning_or_restriction() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(account=BrokerAccountState("A123", 25, 25, 25, warnings=["PDT warning"])),
        now=now(),
    )

    assert not report.safe_for_entries
    assert any(issue.code == "account_state" for issue in report.blockers)


def test_account_health_blocks_account_identity_mismatch() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(account=BrokerAccountState("OTHER", 25, 25, 25)),
        now=now(),
    )

    assert not report.safe_for_entries
    assert any(issue.code == "account_identity_mismatch" for issue in report.blockers)


def test_account_health_blocks_missing_quote() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(quotes={}),
        now=now(),
    )

    assert not report.safe_for_entries
    assert report.blockers[0].code == "quote_missing"


def test_account_health_blocks_unsafe_spread() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(quotes={"TEST": QuoteSnapshot("TEST", bid=99, ask=101, last=100, data_fresh=True)}),
        now=now(),
    )

    assert not report.safe_for_entries
    assert any(issue.code == "spread_unsafe" for issue in report.blockers)


def test_account_health_blocks_failed_tradability() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(tradability={"TEST": False}),
        now=now(),
    )

    assert not report.safe_for_entries
    assert any(issue.code == "not_tradable" for issue in report.blockers)


def test_account_health_blocks_open_orders() -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(orders=[BrokerOrder("order-1", "TEST", "buy", "confirmed")]),
        now=now(),
    )

    assert not report.safe_for_entries
    assert any(issue.code == "open_orders_present" for issue in report.blockers)


def test_account_health_blocks_malformed_broker_state() -> None:
    bad_broker = broker()
    bad_broker.get_positions = lambda account_number: (_ for _ in ()).throw(RuntimeError("broker position response missing symbol"))

    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=bad_broker,
        now=now(),
    )

    assert not report.safe_for_entries
    assert report.blockers[0].code == "broker_read_failed"
    assert "broker position response missing symbol" in report.blockers[0].detail


def test_account_health_blocks_malformed_quote_state() -> None:
    bad_broker = broker()
    bad_broker.get_quotes = lambda symbols: (_ for _ in ()).throw(RuntimeError("TEST: broker quote response missing valid bid/ask"))

    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=bad_broker,
        now=now(),
    )

    assert not report.safe_for_entries
    assert report.blockers[0].code == "broker_read_failed"
    assert "broker quote response missing valid bid/ask" in report.blockers[0].detail


def test_account_health_writes_report(tmp_path) -> None:
    report = build_account_health_report(
        settings=settings(),
        account_number="A123",
        symbols=["TEST"],
        broker=broker(),
        now=now(),
    )

    path = write_account_health_report(report, tmp_path / "health.json")
    payload = json.loads(path.read_text())

    assert payload["safe_for_entries"] is True
    assert payload["account_number"] == "A123"
