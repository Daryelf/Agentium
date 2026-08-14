from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

import pytest

from stock_guru.sec_13f import (
    SEC_13F_IMPORTER_ID,
    SEC_13F_SUBMISSION_URL,
    Sec13fWatchEntry,
    build_13f_change_signals,
    extract_information_table_xml,
    load_sec_13f_watchlist,
    parse_13f_information_table,
    refresh_sec_13f_signals,
)


def information_table(rows: list[tuple[str, str, str, float, float]]) -> str:
    body = "".join(
        f"""
        <infoTable>
          <nameOfIssuer>{issuer}</nameOfIssuer>
          <titleOfClass>{title}</titleOfClass>
          <cusip>{cusip}</cusip>
          <value>{value}</value>
          <shrsOrPrnAmt><sshPrnamt>{shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
          <investmentDiscretion>SOLE</investmentDiscretion>
          <votingAuthority><Sole>{shares}</Sole><Shared>0</Shared><None>0</None></votingAuthority>
        </infoTable>
        """
        for issuer, title, cusip, shares, value in rows
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><informationTable>{body}</informationTable>'


PRIOR_XML = information_table(
    [
        ("Acme Corp", "COM", "000000001", 100, 1_000),
        ("Old Corp", "COM", "000000002", 50, 500),
    ]
)

LATEST_XML = information_table(
    [
        ("Acme Corp", "COM", "000000001", 150, 1_650),
        ("New Corp", "COM", "000000003", 20, 200),
    ]
)


def complete_submission(xml_text: str) -> str:
    return f"""
<SEC-DOCUMENT>
<DOCUMENT>
<TYPE>13F-HR
<TEXT><XML><edgarSubmission /></XML></TEXT>
</DOCUMENT>
<DOCUMENT>
<TYPE>INFORMATION TABLE
<SEQUENCE>2
<FILENAME>infotable.xml
<TEXT><XML>{xml_text}</XML></TEXT>
</DOCUMENT>
</SEC-DOCUMENT>
"""


class FakeEdgarClient:
    def get_json(self, url: str) -> object:
        assert url == "https://data.sec.gov/submissions/CIK0000000123.json"
        return {
            "filings": {
                "recent": {
                    "form": ["13F-HR", "13F-HR", "8-K"],
                    "accessionNumber": ["0000000123-26-000002", "0000000123-26-000001", "0000000123-26-000003"],
                    "acceptanceDateTime": ["20260515160000", "20260214160000", "20260515170000"],
                    "filingDate": ["2026-05-15", "2026-02-14", "2026-05-15"],
                    "reportDate": ["2026-03-31", "2025-12-31", "2026-03-31"],
                }
            }
        }

    def get_text(self, url: str) -> str:
        if url == SEC_13F_SUBMISSION_URL.format(
            cik="123",
            accession="000000012326000002",
            accession_dashed="0000000123-26-000002",
        ):
            return complete_submission(LATEST_XML)
        if url == SEC_13F_SUBMISSION_URL.format(
            cik="123",
            accession="000000012326000001",
            accession_dashed="0000000123-26-000001",
        ):
            return complete_submission(PRIOR_XML)
        raise AssertionError(f"unexpected SEC URL {url}")


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def test_watchlist_accepts_bounded_optional_cusip_ticker_map(tmp_path: Path) -> None:
    path = write_json(
        tmp_path / "watchlist.json",
        {
            "sec_13f": [
                {
                    "cik": "123",
                    "label": "Example manager",
                    "enabled": True,
                    "cusip_ticker_map": {"000000001": "ACME"},
                }
            ]
        },
    )
    entries = load_sec_13f_watchlist(path)

    assert entries[0].cik == "0000000123"
    assert entries[0].cusip_ticker_map == {"000000001": "ACME"}
    write_json(path, {"sec_13f": [{"cik": "123", "label": "One"}, {"cik": "0000000123", "label": "Two"}]})
    with pytest.raises(ValueError, match="duplicated"):
        load_sec_13f_watchlist(path)


def test_verified_starter_13f_watchlist_is_named_and_opt_in() -> None:
    example_path = Path(__file__).resolve().parents[1] / "config" / "copy_trader_watchlist.example.json"
    entries = load_sec_13f_watchlist(example_path)

    assert len(entries) >= 4
    assert all(entry.enabled is False for entry in entries)
    assert {entry.cik for entry in entries} >= {"0001067983", "0001350694", "0001336528", "0001649339"}


def test_stock_office_13f_watchlist_enables_the_verified_named_managers() -> None:
    configured_path = Path(__file__).resolve().parents[1] / "config" / "copy_trader_watchlist.json"
    entries = load_sec_13f_watchlist(configured_path)

    assert len(entries) == 4
    assert all(entry.enabled for entry in entries)
    assert {entry.cik for entry in entries} == {"0001067983", "0001350694", "0001336528", "0001649339"}


def test_information_table_parser_aggregates_rows_and_rejects_entities() -> None:
    repeated = information_table(
        [
            ("Acme Corp", "COM", "000000001", 100, 1_000),
            ("Acme Corp", "COM", "000000001", 50, 500),
        ]
    )
    holdings = parse_13f_information_table(repeated)

    assert len(holdings) == 1
    assert next(iter(holdings.values())).shares == 150
    assert extract_information_table_xml(complete_submission(repeated)).startswith("<?xml")
    with pytest.raises(ValueError, match="document type"):
        parse_13f_information_table("<!DOCTYPE informationTable><informationTable />")


def test_change_signals_are_explicitly_delayed_research_references() -> None:
    entry = Sec13fWatchEntry("0000000123", "Example manager", True, {"000000001": "ACME"})
    signals = build_13f_change_signals(
        entry=entry,
        previous=parse_13f_information_table(PRIOR_XML),
        current=parse_13f_information_table(LATEST_XML),
        previous_report_date="2025-12-31",
        current_report_date="2026-03-31",
        disclosed_at="2026-05-15T20:00:00Z",
        observed_at="2026-05-15T20:01:00Z",
        accession_number="0000000123-26-000002",
        source_url="https://www.sec.gov/Archives/edgar/data/123/filing-index.html",
    )

    assert {(item["side"], item["symbol"]) for item in signals} == {
        ("BUY", "ACME"),
        ("BUY", "CUSIP:000000003"),
        ("SELL", "CUSIP:000000002"),
    }
    assert sum(item["ticker_resolved"] is True for item in signals) == 1
    assert sum(item["ticker_resolved"] is False for item in signals) == 2
    assert all(item["transaction_code"] == "13F_CHANGE" for item in signals)
    assert all(item["signal_price"] is None and item["current_price"] is None for item in signals)
    assert all("does not identify the exact trade date or price" in item["notes"] for item in signals)


def test_refresh_is_idempotent_preserves_other_importers_and_never_places_orders(tmp_path: Path) -> None:
    watchlist = write_json(
        tmp_path / "watchlist.json",
        {
            "sec_13f": [
                {
                    "cik": "123",
                    "label": "Example manager",
                    "enabled": True,
                    "cusip_ticker_map": {"000000001": "ACME"},
                }
            ]
        },
    )
    signals_path = write_json(
        tmp_path / "signals.json",
        {
            "signals": [
                {"id": "form4-signal", "importer": "sec_edgar_form4", "source_id": "sec_form4"},
                {"id": "manual-signal", "source_id": "verified_public_signal"},
            ]
        },
    )
    status_path = tmp_path / "status.json"

    first = refresh_sec_13f_signals(
        watchlist_path=watchlist,
        signals_path=signals_path,
        status_path=status_path,
        now=datetime(2026, 5, 15, 20, 1, tzinfo=timezone.utc),
        client=FakeEdgarClient(),
    )
    second = refresh_sec_13f_signals(
        watchlist_path=watchlist,
        signals_path=signals_path,
        status_path=status_path,
        now=datetime(2026, 5, 15, 20, 2, tzinfo=timezone.utc),
        client=FakeEdgarClient(),
    )

    payload = json.loads(signals_path.read_text())
    status = json.loads(status_path.read_text())
    imported = [item for item in payload["signals"] if item.get("importer") == SEC_13F_IMPORTER_ID]
    assert first.holding_changes_found == 3
    assert first.unmapped_changes == 2
    assert first.signals_imported == 1
    assert second.signals_retained == 3
    assert {item["id"] for item in payload["signals"]} >= {"form4-signal", "manual-signal"}
    assert len(imported) == 1
    assert all(item["observed_at"] == "2026-05-15T20:01:00Z" for item in imported)
    assert status["research_only"] is True
    assert status["holding_changes_found"] == 3
    assert status["unmapped_changes"] == 2
    assert status["resolved_signals_imported"] == 1
    assert status["live_orders_placed"] == 0


def test_refresh_removes_old_or_unresolved_automatic_13f_rows(tmp_path: Path) -> None:
    watchlist = write_json(
        tmp_path / "watchlist.json",
        {"sec_13f": [{"cik": "123", "label": "Example manager", "enabled": True, "cusip_ticker_map": {"000000001": "ACME"}}]},
    )
    signals_path = write_json(
        tmp_path / "signals.json",
        {"signals": [
            {"id": "old-unresolved", "importer": SEC_13F_IMPORTER_ID, "symbol": "CUSIP:999999999"},
            {"id": "manual-signal", "source_id": "verified_public_signal"},
        ]},
    )

    refresh_sec_13f_signals(
        watchlist_path=watchlist,
        signals_path=signals_path,
        status_path=tmp_path / "status.json",
        now=datetime(2026, 5, 15, 20, 1, tzinfo=timezone.utc),
        client=FakeEdgarClient(),
    )

    rows = json.loads(signals_path.read_text())["signals"]
    assert "old-unresolved" not in {item.get("id") for item in rows}
    assert {item.get("id") for item in rows} >= {"manual-signal"}
    assert all(not str(item.get("symbol") or "").startswith("CUSIP:") for item in rows)


def test_refresh_fails_closed_without_enabled_managers(tmp_path: Path) -> None:
    watchlist = write_json(tmp_path / "watchlist.json", {"sec_13f": []})
    with pytest.raises(ValueError, match="no enabled entries"):
        refresh_sec_13f_signals(watchlist_path=watchlist, signals_path=tmp_path / "signals.json")
