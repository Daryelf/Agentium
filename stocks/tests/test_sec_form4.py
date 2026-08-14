from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

import pytest

from stock_guru.sec_form4 import (
    SEC_ARCHIVE_URL,
    SEC_IMPORTER_ID,
    SecEdgarClient,
    load_sec_watchlist,
    parse_form4_xml,
    refresh_sec_form4_signals,
)


FORM4_XML = """<?xml version="1.0" encoding="UTF-8"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000123456</issuerCik>
    <issuerName>Acme Example Corp</issuerName>
    <issuerTradingSymbol>ACME</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>PUBLIC REPORTING PERSON</rptOwnerName></reportingOwnerId>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-08</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>100</value></transactionShares>
        <transactionPricePerShare><value>10.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>500</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-09</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>20</value></transactionShares>
        <transactionPricePerShare><value>10.10</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>480</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
"""


class FakeEdgarClient:
    def get_json(self, url: str) -> object:
        assert url == "https://data.sec.gov/submissions/CIK0000000123.json"
        return {
            "filings": {
                "recent": {
                    "form": ["4", "8-K"],
                    "accessionNumber": ["0000000123-26-000001", "0000000123-26-000002"],
                    "primaryDocument": ["form4.xml", "form8k.htm"],
                    "acceptanceDateTime": ["20260810120000", "20260810130000"],
                    "filingDate": ["2026-08-10", "2026-08-10"],
                }
            }
        }

    def get_text(self, url: str) -> str:
        assert url == SEC_ARCHIVE_URL.format(
            cik="123",
            accession="000000012326000001",
            document="form4.xml",
        )
        return FORM4_XML


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def test_load_watchlist_normalizes_cik_and_rejects_duplicates(tmp_path: Path) -> None:
    path = write_json(
        tmp_path / "watchlist.json",
        {
            "sec_form4": [
                {"cik": "123", "label": "Person one", "enabled": True},
                {"cik": "456", "label": "Person two", "enabled": False},
            ]
        },
    )

    entries = load_sec_watchlist(path)

    assert entries[0].cik == "0000000123"
    assert entries[0].enabled is True
    write_json(path, {"sec_form4": [{"cik": "123", "label": "One"}, {"cik": "0000000123", "label": "Two"}]})
    with pytest.raises(ValueError, match="duplicated"):
        load_sec_watchlist(path)


def test_verified_starter_watchlist_is_opt_in_and_contains_unique_ciks() -> None:
    example_path = Path(__file__).resolve().parents[1] / "config" / "copy_trader_watchlist.example.json"
    entries = load_sec_watchlist(example_path)

    assert len(entries) == 5
    assert all(entry.enabled is False for entry in entries)
    assert len({entry.cik for entry in entries}) == len(entries)
    assert {entry.cik for entry in entries} >= {"0000315090", "0001494730", "0001197649"}


def test_parse_form4_imports_nonderivative_transactions_without_assuming_local_holdings() -> None:
    signals = parse_form4_xml(
        FORM4_XML,
        accession_number="0000000123-26-000001",
        source_url="https://www.sec.gov/Archives/edgar/data/123/filing/form4.xml",
        disclosed_at="2026-08-10T16:00:00Z",
        observed_at="2026-08-10T16:01:00Z",
        watch_label="Watch label",
    )

    assert [item["side"] for item in signals] == ["BUY", "SELL"]
    assert [item["transaction_code"] for item in signals] == ["P", "S"]
    assert all(item["symbol"] == "ACME" for item in signals)
    assert signals[0]["signal_price"] == 10
    assert signals[1]["current_position_shares"] == 0
    assert all(item["importer"] == SEC_IMPORTER_ID for item in signals)


def test_refresh_is_idempotent_preserves_manual_signals_and_never_places_orders(tmp_path: Path) -> None:
    watchlist = write_json(
        tmp_path / "watchlist.json",
        {"sec_form4": [{"cik": "123", "label": "Tracked reporting person", "enabled": True}]},
    )
    signals_path = write_json(
        tmp_path / "signals.json",
        {
            "signals": [
                {
                    "id": "manual-signal",
                    "source_id": "verified_public_signal",
                    "trader_name": "Manual public source",
                }
            ]
        },
    )
    status_path = tmp_path / "status.json"

    first = refresh_sec_form4_signals(
        watchlist_path=watchlist,
        signals_path=signals_path,
        status_path=status_path,
        now=datetime(2026, 8, 10, 16, 1, tzinfo=timezone.utc),
        client=FakeEdgarClient(),
        price_lookup=lambda symbols: {"ACME": 10.20},
    )
    second = refresh_sec_form4_signals(
        watchlist_path=watchlist,
        signals_path=signals_path,
        status_path=status_path,
        now=datetime(2026, 8, 10, 16, 2, tzinfo=timezone.utc),
        client=FakeEdgarClient(),
        price_lookup=lambda symbols: {"ACME": 10.40},
    )

    payload = json.loads(signals_path.read_text())
    status = json.loads(status_path.read_text())
    assert first.signals_imported == 2
    assert second.signals_retained == 3
    assert len(payload["signals"]) == 3
    assert payload["signals"][0]["id"] == "manual-signal"
    assert all(item.get("current_price") == 10.40 for item in payload["signals"][1:])
    assert all(item.get("initial_observed_price") == 10.20 for item in payload["signals"][1:])
    assert all(item.get("observed_at") == "2026-08-10T16:01:00Z" for item in payload["signals"][1:])
    assert all(item.get("current_price_observed_at") == "2026-08-10T16:02:00Z" for item in payload["signals"][1:])
    assert status["live_orders_placed"] == 0


def test_importer_fails_closed_without_enabled_watchlist_or_compliant_identity(tmp_path: Path) -> None:
    watchlist = write_json(tmp_path / "watchlist.json", {"sec_form4": []})
    with pytest.raises(ValueError, match="no enabled entries"):
        refresh_sec_form4_signals(watchlist_path=watchlist, signals_path=tmp_path / "signals.json")

    with pytest.raises(ValueError, match="contact email"):
        SecEdgarClient("anonymous-bot")
    with pytest.raises(ValueError, match="document type"):
        parse_form4_xml(
            "<!DOCTYPE ownershipDocument><ownershipDocument />",
            accession_number="0000000123-26-000001",
            source_url="https://www.sec.gov/example.xml",
            disclosed_at="2026-08-10T16:00:00Z",
            observed_at="2026-08-10T16:01:00Z",
            watch_label="Watch label",
        )
