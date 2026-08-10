from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from typing import Any, Callable, Iterable, Mapping
import urllib.request
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

from .config import CONFIG_DIR, DATA_DIR


SEC_FORM4_WATCHLIST_PATH = CONFIG_DIR / "copy_trader_watchlist.json"
SEC_FORM4_IMPORT_STATUS_PATH = DATA_DIR / "copy_import_status.json"
SEC_USER_AGENT_ENV = "STOCK_GURU_SEC_USER_AGENT"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
SEC_IMPORTER_ID = "sec_edgar_form4"
SEC_HEADERS = {
    "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.5",
    "Accept-Language": "en-US,en;q=0.8",
}
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_IMPORTED_SIGNALS = 500


@dataclass(frozen=True)
class SecWatchEntry:
    cik: str
    label: str
    enabled: bool


@dataclass(frozen=True)
class SecRefreshResult:
    generated_at: str
    watchlist_entries: int
    enabled_entries: int
    filings_scanned: int
    signals_imported: int
    signals_retained: int
    warnings: tuple[str, ...]
    signals_path: Path
    status_path: Path


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_cik(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw.isdigit() or len(raw) > 10:
        raise ValueError("SEC watchlist CIK must contain 1 to 10 digits")
    return raw.zfill(10)


def _valid_sec_user_agent(value: str) -> str:
    user_agent = str(value or "").strip()
    if len(user_agent) < 8 or len(user_agent) > 240 or "@" not in user_agent:
        raise ValueError(
            f"{SEC_USER_AGENT_ENV} must identify the app or organization and include a contact email"
        )
    if "\n" in user_agent or "\r" in user_agent:
        raise ValueError(f"{SEC_USER_AGENT_ENV} cannot contain line breaks")
    return user_agent


def load_sec_watchlist(path: Path = SEC_FORM4_WATCHLIST_PATH) -> tuple[SecWatchEntry, ...]:
    if not path.exists():
        raise ValueError(f"SEC Form 4 watchlist does not exist: {path}")
    payload = json.loads(path.read_text())
    items = payload.get("sec_form4", []) if isinstance(payload, Mapping) else None
    if not isinstance(items, list):
        raise ValueError("copy trader watchlist must contain a sec_form4 array")
    entries: list[SecWatchEntry] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError(f"SEC watchlist entry {index + 1} must be an object")
        cik = _clean_cik(item.get("cik"))
        if cik in seen:
            raise ValueError(f"SEC watchlist CIK {cik} is duplicated")
        label = str(item.get("label") or "").strip()
        if not label or len(label) > 160:
            raise ValueError(f"SEC watchlist entry {index + 1} requires a label of 160 characters or fewer")
        entries.append(SecWatchEntry(cik=cik, label=label, enabled=bool(item.get("enabled", False))))
        seen.add(cik)
    return tuple(entries)


class SecEdgarClient:
    """Small bounded SEC client that respects the agency's fair-access ceiling."""

    def __init__(
        self,
        user_agent: str,
        *,
        timeout_seconds: float = 20.0,
        minimum_interval_seconds: float = 0.12,
        opener: Callable[..., Any] | None = None,
        pause: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.user_agent = _valid_sec_user_agent(user_agent)
        self.timeout_seconds = max(1.0, min(float(timeout_seconds), 60.0))
        self.minimum_interval_seconds = max(0.11, float(minimum_interval_seconds))
        self.opener = opener or urllib.request.urlopen
        self.pause = pause
        self.clock = clock
        self._last_request_at: float | None = None

    def _read(self, url: str) -> bytes:
        if not url.startswith(("https://data.sec.gov/", "https://www.sec.gov/Archives/")):
            raise ValueError("SEC importer refused a URL outside the official data and filing hosts")
        if self._last_request_at is not None:
            remaining = self.minimum_interval_seconds - (self.clock() - self._last_request_at)
            if remaining > 0:
                self.pause(remaining)
        request = urllib.request.Request(
            url,
            headers={**SEC_HEADERS, "User-Agent": self.user_agent},
            method="GET",
        )
        try:
            response = self.opener(request, timeout=self.timeout_seconds)
            with response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
        finally:
            self._last_request_at = self.clock()
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("SEC response exceeded the importer's 8 MiB safety limit")
        return body

    def get_json(self, url: str) -> object:
        return json.loads(self._read(url).decode("utf-8"))

    def get_text(self, url: str) -> str:
        return self._read(url).decode("utf-8")


def _recent_rows(payload: object) -> list[dict[str, Any]]:
    recent = payload.get("filings", {}).get("recent", {}) if isinstance(payload, Mapping) else {}
    if not isinstance(recent, Mapping):
        return []
    columns = {str(key): value for key, value in recent.items() if isinstance(value, list)}
    row_count = max((len(value) for value in columns.values()), default=0)
    return [
        {key: values[index] if index < len(values) else None for key, values in columns.items()}
        for index in range(row_count)
    ]


def _form4_rows(payload: object, max_filings: int) -> list[dict[str, Any]]:
    rows = [row for row in _recent_rows(payload) if str(row.get("form") or "").upper() in {"4", "4/A"}]
    return rows[: max(1, min(int(max_filings), 50))]


def _archive_url(cik: str, accession_number: Any, primary_document: Any) -> str:
    accession = str(accession_number or "").strip()
    document = str(primary_document or "").strip().lstrip("/")
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
        raise ValueError("SEC filing has an invalid accession number")
    if not document or ".." in document or not re.fullmatch(r"[A-Za-z0-9._/-]+", document):
        raise ValueError("SEC filing has an invalid primary document path")
    return SEC_ARCHIVE_URL.format(cik=str(int(cik)), accession=accession.replace("-", ""), document=document)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in element.iter() if _local_name(child.tag) == name]


def _path_text(element: ElementTree.Element, *names: str) -> str:
    current = element
    for name in names:
        match = next((child for child in current if _local_name(child.tag) == name), None)
        if match is None:
            return ""
        current = match
    return str(current.text or "").strip()


def _positive_float(value: str) -> float | None:
    try:
        parsed = float(value.replace(",", ""))
    except (AttributeError, TypeError, ValueError):
        return None
    return parsed if parsed > 0 and parsed == parsed and parsed not in {float("inf"), float("-inf")} else None


def _transaction_timestamp(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Form 4 transaction date is missing or invalid") from exc
    return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def sec_acceptance_timestamp(value: Any, fallback: Any) -> str:
    raw = str(value or "").strip()
    try:
        if re.fullmatch(r"\d{14}", raw):
            eastern = datetime.strptime(raw, "%Y%m%d%H%M%S").replace(tzinfo=ZoneInfo("America/New_York"))
            return _iso(eastern)
        if raw:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=ZoneInfo("America/New_York"))
            return _iso(parsed)
        filing_date = date.fromisoformat(str(fallback or ""))
        return _iso(datetime(filing_date.year, filing_date.month, filing_date.day, 23, 59, tzinfo=ZoneInfo("America/New_York")))
    except ValueError as exc:
        raise ValueError("Form 4 acceptance timestamp is missing or invalid") from exc


def parse_form4_xml(
    xml_text: str,
    *,
    accession_number: str,
    source_url: str,
    disclosed_at: str,
    observed_at: str,
    watch_label: str,
) -> list[dict[str, Any]]:
    if len(xml_text.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise ValueError("Form 4 XML exceeded the importer's 8 MiB safety limit")
    lowered = xml_text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise ValueError("Form 4 XML contains a document type or entity declaration")
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise ValueError("Form 4 primary document is not valid XML") from exc

    symbol = _path_text(root, "issuer", "issuerTradingSymbol").upper()
    if not symbol or len(symbol) > 80 or not all(character.isalnum() or character in ".-_" for character in symbol):
        raise ValueError("Form 4 issuer ticker is missing or invalid")
    owner_names = [
        _path_text(owner, "reportingOwnerId", "rptOwnerName")
        for owner in _children(root, "reportingOwner")
    ]
    owner_names = [name for name in owner_names if name]
    trader_name = ", ".join(dict.fromkeys(owner_names))[:160] or watch_label[:160]

    signals: list[dict[str, Any]] = []
    for index, transaction in enumerate(_children(root, "nonDerivativeTransaction"), start=1):
        transaction_date = _path_text(transaction, "transactionDate", "value")
        transaction_code = _path_text(transaction, "transactionCoding", "transactionCode").upper()
        acquired_disposed = _path_text(
            transaction,
            "transactionAmounts",
            "transactionAcquiredDisposedCode",
            "value",
        ).upper()
        side = "BUY" if acquired_disposed == "A" else "SELL" if acquired_disposed == "D" else ""
        if not side:
            continue
        shares = _positive_float(_path_text(transaction, "transactionAmounts", "transactionShares", "value"))
        price = _positive_float(_path_text(transaction, "transactionAmounts", "transactionPricePerShare", "value"))
        post_shares = _positive_float(_path_text(transaction, "postTransactionAmounts", "sharesOwnedFollowingTransaction", "value"))
        notes = [
            "Automatically imported from the official SEC EDGAR Form 4 primary document.",
            f"Watchlist label: {watch_label}.",
            f"Reported non-derivative shares: {shares:g}." if shares is not None else "Reported share quantity was unavailable.",
            f"Reporting person's post-transaction holdings: {post_shares:g}." if post_shares is not None else "Reporting person's post-transaction holdings were unavailable.",
            "Transaction code and source document still require operator review.",
        ]
        signals.append(
            {
                "id": f"sec-{accession_number.replace('-', '')}-{index}",
                "source_id": "sec_form4",
                "importer": SEC_IMPORTER_ID,
                "trader_name": trader_name,
                "asset_type": "equity",
                "symbol": symbol,
                "side": side,
                "transaction_code": transaction_code,
                "transaction_at": _transaction_timestamp(transaction_date),
                "disclosed_at": disclosed_at,
                "observed_at": observed_at,
                "source_url": source_url,
                "signal_price": price,
                "current_price": None,
                "current_position_shares": 0,
                "confidence": 1.0,
                "notes": " ".join(notes),
            }
        )
    return signals


def _read_existing_signals(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text())
    items = payload.get("signals", []) if isinstance(payload, Mapping) else payload
    if not isinstance(items, list):
        raise ValueError("existing copy signals JSON must contain a signals array")
    return [dict(item) for item in items if isinstance(item, Mapping)]


def _merge_signals(existing: Iterable[dict[str, Any]], imported: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    manual = [item for item in existing if item.get("importer") != SEC_IMPORTER_ID]
    automatic_by_id: dict[str, dict[str, Any]] = {
        str(item.get("id")): item
        for item in existing
        if item.get("importer") == SEC_IMPORTER_ID and item.get("id")
    }
    for item in imported:
        signal_id = str(item["id"])
        previous = automatic_by_id.get(signal_id)
        if previous:
            item["observed_at"] = previous.get("observed_at") or item.get("observed_at")
            item["initial_observed_price"] = previous.get("initial_observed_price")
            if item["initial_observed_price"] is None:
                item["initial_observed_price"] = previous.get("current_price") or item.get("current_price")
        elif item.get("initial_observed_price") is None:
            item["initial_observed_price"] = item.get("current_price")
        automatic_by_id[signal_id] = item
    automatic = sorted(
        automatic_by_id.values(),
        key=lambda item: str(item.get("disclosed_at") or ""),
        reverse=True,
    )[:MAX_IMPORTED_SIGNALS]
    return manual + automatic


def refresh_sec_form4_signals(
    *,
    watchlist_path: Path = SEC_FORM4_WATCHLIST_PATH,
    signals_path: Path,
    status_path: Path = SEC_FORM4_IMPORT_STATUS_PATH,
    user_agent: str | None = None,
    max_filings_per_entry: int = 10,
    now: datetime | None = None,
    client: SecEdgarClient | Any | None = None,
    price_lookup: Callable[[Iterable[str]], Mapping[str, float]] | None = None,
) -> SecRefreshResult:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    observed_at = _iso(current)
    watchlist = load_sec_watchlist(watchlist_path)
    enabled = [entry for entry in watchlist if entry.enabled]
    if not enabled:
        raise ValueError("SEC Form 4 watchlist has no enabled entries; choose the reporting people or entities first")
    edgar = client or SecEdgarClient(user_agent or os.environ.get(SEC_USER_AGENT_ENV, ""))
    warnings: list[str] = []
    imported: list[dict[str, Any]] = []
    filings_scanned = 0

    for entry in enabled:
        try:
            submissions = edgar.get_json(SEC_SUBMISSIONS_URL.format(cik=entry.cik))
            filing_rows = _form4_rows(submissions, max_filings_per_entry)
        except Exception as exc:
            warnings.append(f"{entry.label}: submissions refresh failed closed ({exc}).")
            continue
        if not filing_rows:
            warnings.append(f"{entry.label}: no recent Form 4 filings were found in the SEC submissions feed.")
        for row in filing_rows:
            filings_scanned += 1
            try:
                source_url = _archive_url(entry.cik, row.get("accessionNumber"), row.get("primaryDocument"))
                disclosed_at = sec_acceptance_timestamp(row.get("acceptanceDateTime"), row.get("filingDate"))
                imported.extend(
                    parse_form4_xml(
                        edgar.get_text(source_url),
                        accession_number=str(row.get("accessionNumber") or ""),
                        source_url=source_url,
                        disclosed_at=disclosed_at,
                        observed_at=observed_at,
                        watch_label=entry.label,
                    )
                )
            except Exception as exc:
                warnings.append(f"{entry.label}: one Form 4 filing was skipped ({exc}).")

    if imported and price_lookup is not None:
        try:
            prices = {str(key).upper(): float(value) for key, value in price_lookup(item["symbol"] for item in imported).items()}
        except Exception as exc:
            prices = {}
            warnings.append(f"Current-price refresh failed closed ({exc}); imported signals remain research-only.")
        for item in imported:
            price = prices.get(str(item["symbol"]).upper())
            item["current_price"] = price if price is not None and price > 0 else None
            item["current_price_observed_at"] = observed_at
            item["price_provider"] = "Yahoo Finance via yfinance"
            item["price_source_url"] = f"https://finance.yahoo.com/quote/{item['symbol']}"
    if imported and not price_lookup:
        warnings.append("No current-price provider was supplied; imported signals remain research-only until priced.")

    merged = _merge_signals(_read_existing_signals(signals_path), imported)
    signals_path.parent.mkdir(parents=True, exist_ok=True)
    signals_path.write_text(json.dumps({"version": 1, "signals": merged}, indent=2, sort_keys=True) + "\n")
    status_payload = {
        "version": 1,
        "generated_at": observed_at,
        "source": "official SEC EDGAR submissions and filing documents",
        "watchlist_entries": len(watchlist),
        "enabled_entries": len(enabled),
        "filings_scanned": filings_scanned,
        "signals_imported": len(imported),
        "signals_retained": len(merged),
        "live_orders_placed": 0,
        "warnings": warnings,
    }
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(json.dumps(status_payload, indent=2, sort_keys=True) + "\n")
    return SecRefreshResult(
        generated_at=observed_at,
        watchlist_entries=len(watchlist),
        enabled_entries=len(enabled),
        filings_scanned=filings_scanned,
        signals_imported=len(imported),
        signals_retained=len(merged),
        warnings=tuple(warnings),
        signals_path=signals_path,
        status_path=status_path,
    )
