from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Iterable, Mapping
from xml.etree import ElementTree

from .config import CONFIG_DIR, DATA_DIR
from .sec_form4 import SEC_SUBMISSIONS_URL, SEC_USER_AGENT_ENV, SecEdgarClient, sec_acceptance_timestamp


SEC_13F_WATCHLIST_PATH = CONFIG_DIR / "copy_trader_watchlist.json"
SEC_13F_IMPORT_STATUS_PATH = DATA_DIR / "sec_13f_import_status.json"
SEC_13F_IMPORTER_ID = "sec_edgar_13f"
SEC_13F_SUBMISSION_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{accession_dashed}.txt"
SEC_13F_INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{accession_dashed}-index.html"
MAX_IMPORTED_SIGNALS = 1_000
MAX_XML_CHARACTERS = 8 * 1024 * 1024


@dataclass(frozen=True)
class Sec13fWatchEntry:
    cik: str
    label: str
    enabled: bool
    cusip_ticker_map: dict[str, str]


@dataclass(frozen=True)
class Sec13fHolding:
    identity: str
    issuer_name: str
    title_of_class: str
    cusip: str
    shares: float
    share_type: str
    value_as_filed: float
    put_call: str


@dataclass(frozen=True)
class Sec13fRefreshResult:
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
        raise ValueError("SEC 13F watchlist CIK must contain 1 to 10 digits")
    return raw.zfill(10)


def _clean_cusip(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())[:12]


def _clean_ticker(value: Any) -> str:
    ticker = re.sub(r"[^A-Z0-9.-]", "", str(value or "").upper().strip())[:12]
    if not ticker:
        raise ValueError("13F CUSIP ticker mapping contains an empty or invalid ticker")
    return ticker


def load_sec_13f_watchlist(path: Path = SEC_13F_WATCHLIST_PATH) -> tuple[Sec13fWatchEntry, ...]:
    if not path.exists():
        raise ValueError(f"SEC 13F watchlist does not exist: {path}")
    payload = json.loads(path.read_text())
    items = payload.get("sec_13f", []) if isinstance(payload, Mapping) else None
    if not isinstance(items, list):
        raise ValueError("copy trader watchlist must contain a sec_13f array")
    entries: list[Sec13fWatchEntry] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError(f"SEC 13F watchlist entry {index + 1} must be an object")
        cik = _clean_cik(item.get("cik"))
        if cik in seen:
            raise ValueError(f"SEC 13F watchlist CIK {cik} is duplicated")
        label = str(item.get("label") or "").strip()
        if not label or len(label) > 160:
            raise ValueError(f"SEC 13F watchlist entry {index + 1} requires a label of 160 characters or fewer")
        raw_map = item.get("cusip_ticker_map", {})
        if not isinstance(raw_map, Mapping) or len(raw_map) > 500:
            raise ValueError(f"SEC 13F watchlist entry {index + 1} has an invalid CUSIP ticker map")
        ticker_map: dict[str, str] = {}
        for raw_cusip, raw_ticker in raw_map.items():
            cusip = _clean_cusip(raw_cusip)
            if not cusip:
                raise ValueError("13F CUSIP ticker mapping contains an invalid CUSIP")
            ticker_map[cusip] = _clean_ticker(raw_ticker)
        entries.append(
            Sec13fWatchEntry(
                cik=cik,
                label=label,
                enabled=bool(item.get("enabled", False)),
                cusip_ticker_map=ticker_map,
            )
        )
        seen.add(cik)
    return tuple(entries)


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


def _13f_rows(payload: object, max_filings: int) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_report_dates: set[str] = set()
    for row in _recent_rows(payload):
        if str(row.get("form") or "").upper() not in {"13F-HR", "13F-HR/A"}:
            continue
        report_date = str(row.get("reportDate") or "").strip()
        if not report_date or report_date in seen_report_dates:
            continue
        try:
            date.fromisoformat(report_date)
        except ValueError:
            continue
        selected.append(row)
        seen_report_dates.add(report_date)
        if len(selected) >= max(2, min(int(max_filings), 8)):
            break
    return selected


def _accession(value: Any) -> tuple[str, str]:
    dashed = str(value or "").strip()
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", dashed):
        raise ValueError("SEC 13F filing has an invalid accession number")
    return dashed, dashed.replace("-", "")


def _submission_urls(cik: str, accession_number: Any) -> tuple[str, str]:
    dashed, compact = _accession(accession_number)
    values = {"cik": str(int(cik)), "accession": compact, "accession_dashed": dashed}
    return SEC_13F_SUBMISSION_URL.format(**values), SEC_13F_INDEX_URL.format(**values)


def extract_information_table_xml(submission_text: str) -> str:
    if len(submission_text) > MAX_XML_CHARACTERS:
        raise ValueError("13F complete submission exceeds the bounded parser limit")
    for match in re.finditer(r"<DOCUMENT>(.*?)</DOCUMENT>", submission_text, flags=re.IGNORECASE | re.DOTALL):
        block = match.group(1)
        type_match = re.search(r"<TYPE>\s*([^\r\n<]+)", block, flags=re.IGNORECASE)
        if not type_match or type_match.group(1).strip().upper() != "INFORMATION TABLE":
            continue
        payload_match = re.search(r"<XML>(.*?)</XML>", block, flags=re.IGNORECASE | re.DOTALL)
        if not payload_match:
            payload_match = re.search(r"<TEXT>(.*?)</TEXT>", block, flags=re.IGNORECASE | re.DOTALL)
        if not payload_match:
            continue
        payload = payload_match.group(1).strip()
        xml_start = payload.find("<?xml")
        if xml_start < 0:
            candidates = [offset for offset in (payload.find("<informationTable"), payload.find("<ns1:informationTable")) if offset >= 0]
            xml_start = min(candidates) if candidates else -1
        if xml_start >= 0:
            return payload[xml_start:]
    raise ValueError("13F complete submission has no XML INFORMATION TABLE document")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(element: ElementTree.Element, name: str) -> str:
    match = next((child for child in element if _local_name(child.tag) == name), None)
    return str(match.text or "").strip() if match is not None else ""


def _path_text(element: ElementTree.Element, *names: str) -> str:
    current = element
    for name in names:
        match = next((child for child in current if _local_name(child.tag) == name), None)
        if match is None:
            return ""
        current = match
    return str(current.text or "").strip()


def _nonnegative_float(value: Any) -> float:
    try:
        parsed = float(str(value or "0").replace(",", ""))
    except ValueError:
        return 0.0
    return parsed if parsed >= 0 and parsed == parsed and parsed not in {float("inf"), float("-inf")} else 0.0


def parse_13f_information_table(xml_text: str) -> dict[str, Sec13fHolding]:
    lowered = xml_text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise ValueError("13F XML contains a document type or entity declaration")
    if len(xml_text) > MAX_XML_CHARACTERS:
        raise ValueError("13F XML exceeds the bounded parser limit")
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise ValueError("13F information table is not valid XML") from exc
    holdings: dict[str, Sec13fHolding] = {}
    for row in (item for item in root.iter() if _local_name(item.tag) == "infoTable"):
        issuer = _child_text(row, "nameOfIssuer")[:200]
        title = _child_text(row, "titleOfClass")[:120]
        cusip = _clean_cusip(_child_text(row, "cusip"))
        shares = _nonnegative_float(_path_text(row, "shrsOrPrnAmt", "sshPrnamt"))
        share_type = _path_text(row, "shrsOrPrnAmt", "sshPrnamtType").upper()[:12]
        value_as_filed = _nonnegative_float(_child_text(row, "value"))
        put_call = _child_text(row, "putCall").upper()[:12]
        if not cusip or not issuer:
            continue
        identity = f"{cusip}|{title.casefold()}|{share_type}|{put_call}"
        previous = holdings.get(identity)
        holdings[identity] = Sec13fHolding(
            identity=identity,
            issuer_name=issuer,
            title_of_class=title,
            cusip=cusip,
            shares=shares + (previous.shares if previous else 0.0),
            share_type=share_type,
            value_as_filed=value_as_filed + (previous.value_as_filed if previous else 0.0),
            put_call=put_call,
        )
    return holdings


def _report_timestamp(value: Any) -> str:
    try:
        parsed = date.fromisoformat(str(value or ""))
    except ValueError as exc:
        raise ValueError("13F report date is missing or invalid") from exc
    return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def build_13f_change_signals(
    *,
    entry: Sec13fWatchEntry,
    previous: Mapping[str, Sec13fHolding],
    current: Mapping[str, Sec13fHolding],
    previous_report_date: str,
    current_report_date: str,
    disclosed_at: str,
    observed_at: str,
    accession_number: str,
    source_url: str,
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    for identity in sorted(set(previous) | set(current)):
        before = previous.get(identity)
        after = current.get(identity)
        reference = after or before
        if reference is None or reference.put_call or reference.share_type not in {"SH", ""}:
            continue
        before_shares = before.shares if before else 0.0
        after_shares = after.shares if after else 0.0
        delta = after_shares - before_shares
        if abs(delta) < 1e-9:
            continue
        side = "BUY" if delta > 0 else "SELL"
        symbol = entry.cusip_ticker_map.get(reference.cusip) or f"CUSIP:{reference.cusip}"
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
        notes = (
            "Official SEC Form 13F period-end holding comparison; research only. "
            f"{entry.label} reported {reference.issuer_name} {reference.title_of_class}; "
            f"shares changed from {before_shares:g} on {previous_report_date} to {after_shares:g} on {current_report_date}. "
            "Form 13F does not identify the exact trade date or price and may be filed up to 45 days after quarter end. "
            f"CUSIP {reference.cusip}; as-filed current value {reference.value_as_filed:g}."
        )
        signals.append(
            {
                "id": f"sec13f-{accession_number.replace('-', '')}-{digest}",
                "source_id": "sec_13f",
                "importer": SEC_13F_IMPORTER_ID,
                "trader_name": entry.label,
                "asset_type": "equity",
                "symbol": symbol,
                "side": side,
                "transaction_code": "13F_CHANGE",
                "transaction_at": _report_timestamp(current_report_date),
                "disclosed_at": disclosed_at,
                "observed_at": observed_at,
                "current_price_observed_at": observed_at,
                "source_url": source_url,
                "signal_price": None,
                "initial_observed_price": None,
                "current_price": None,
                "current_position_shares": 0,
                "confidence": 0.55,
                "notes": notes[:1000],
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
    retained = [item for item in existing if item.get("importer") != SEC_13F_IMPORTER_ID]
    automatic_by_id: dict[str, dict[str, Any]] = {
        str(item.get("id")): item
        for item in existing
        if item.get("importer") == SEC_13F_IMPORTER_ID and item.get("id")
    }
    for item in imported:
        signal_id = str(item["id"])
        previous = automatic_by_id.get(signal_id)
        if previous:
            item["observed_at"] = previous.get("observed_at") or item.get("observed_at")
            item["current_price_observed_at"] = previous.get("current_price_observed_at") or item.get("current_price_observed_at")
        automatic_by_id[signal_id] = item
    automatic = sorted(
        automatic_by_id.values(),
        key=lambda item: str(item.get("disclosed_at") or ""),
        reverse=True,
    )[:MAX_IMPORTED_SIGNALS]
    return retained + automatic


def refresh_sec_13f_signals(
    *,
    watchlist_path: Path = SEC_13F_WATCHLIST_PATH,
    signals_path: Path,
    status_path: Path = SEC_13F_IMPORT_STATUS_PATH,
    user_agent: str | None = None,
    max_filings_per_entry: int = 3,
    now: datetime | None = None,
    client: SecEdgarClient | Any | None = None,
) -> Sec13fRefreshResult:
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    observed_at = _iso(current_time)
    watchlist = load_sec_13f_watchlist(watchlist_path)
    enabled = [entry for entry in watchlist if entry.enabled]
    if not enabled:
        raise ValueError("SEC 13F watchlist has no enabled entries; choose the managers first")
    edgar = client or SecEdgarClient(user_agent or os.environ.get(SEC_USER_AGENT_ENV, ""))
    warnings = [
        "SEC Form 13F signals are delayed period-end holding comparisons and remain research-only regardless of score."
    ]
    imported: list[dict[str, Any]] = []
    filings_scanned = 0

    for entry in enabled:
        try:
            submissions = edgar.get_json(SEC_SUBMISSIONS_URL.format(cik=entry.cik))
            rows = _13f_rows(submissions, max_filings_per_entry)
        except Exception as exc:
            warnings.append(f"{entry.label}: submissions refresh failed closed ({exc}).")
            continue
        if len(rows) < 2:
            warnings.append(f"{entry.label}: two distinct recent 13F reporting periods were not available.")
            continue
        parsed_periods: list[tuple[dict[str, Any], dict[str, Sec13fHolding], str]] = []
        for row in rows:
            try:
                submission_url, index_url = _submission_urls(entry.cik, row.get("accessionNumber"))
                xml_text = extract_information_table_xml(edgar.get_text(submission_url))
                parsed_periods.append((row, parse_13f_information_table(xml_text), index_url))
                filings_scanned += 1
            except Exception as exc:
                warnings.append(f"{entry.label}: one 13F filing was skipped ({exc}).")
            if len(parsed_periods) == 2:
                break
        if len(parsed_periods) < 2:
            warnings.append(f"{entry.label}: two parseable 13F periods were not available for comparison.")
            continue
        latest_row, latest_holdings, latest_index_url = parsed_periods[0]
        prior_row, prior_holdings, _ = parsed_periods[1]
        try:
            disclosed_at = sec_acceptance_timestamp(latest_row.get("acceptanceDateTime"), latest_row.get("filingDate"))
            imported.extend(
                build_13f_change_signals(
                    entry=entry,
                    previous=prior_holdings,
                    current=latest_holdings,
                    previous_report_date=str(prior_row.get("reportDate") or ""),
                    current_report_date=str(latest_row.get("reportDate") or ""),
                    disclosed_at=disclosed_at,
                    observed_at=observed_at,
                    accession_number=str(latest_row.get("accessionNumber") or ""),
                    source_url=latest_index_url,
                )
            )
        except Exception as exc:
            warnings.append(f"{entry.label}: holding changes were skipped ({exc}).")

    merged = _merge_signals(_read_existing_signals(signals_path), imported)
    signals_path.parent.mkdir(parents=True, exist_ok=True)
    signals_path.write_text(json.dumps({"version": 1, "signals": merged}, indent=2, sort_keys=True) + "\n")
    status_payload = {
        "version": 1,
        "generated_at": observed_at,
        "source": "official SEC EDGAR Form 13F submissions and XML information tables",
        "watchlist_entries": len(watchlist),
        "enabled_entries": len(enabled),
        "filings_scanned": filings_scanned,
        "signals_imported": len(imported),
        "signals_retained": len(merged),
        "research_only": True,
        "live_orders_placed": 0,
        "warnings": warnings,
    }
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(json.dumps(status_payload, indent=2, sort_keys=True) + "\n")
    return Sec13fRefreshResult(
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
