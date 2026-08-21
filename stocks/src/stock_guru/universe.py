from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Iterable, Mapping

from .config import DATA_DIR, normalize_tickers
from .data import TWELVE_DATA_URL, fetch_json, load_provider_keys


CATALOG_PATH = DATA_DIR / "twelve_data_us_stocks_catalog.json"
STATE_PATH = DATA_DIR / "dynamic_universe_state.json"
REFRESH_HOURS = 24
CATALOG_VERSION = 2
US_EXCHANGES = {"NASDAQ", "NYSE"}
COMMON_STOCK_TYPE = "Common Stock"
SYMBOL_PATTERN = re.compile(r"^[A-Z]{1,5}$")


@dataclass(frozen=True)
class DynamicUniverse:
    symbols: list[str]
    source_catalog_count: int
    universe_total: int
    selected_dynamic_count: int
    seed_count: int
    cursor_start: int
    cursor_end: int


def is_stale(path: Path, *, max_age_hours: int) -> bool:
    if not path.exists():
        return True
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return datetime.now(timezone.utc) - modified > timedelta(hours=max_age_hours)


def fetch_twelve_exchange_catalog(exchange: str, *, api_key: str) -> list[dict[str, object]]:
    from urllib.parse import urlencode

    query = urlencode({"exchange": exchange, "apikey": api_key})
    payload = fetch_json(f"{TWELVE_DATA_URL}/stocks?{query}")
    if not isinstance(payload, Mapping):
        return []
    rows = payload.get("data")
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, Mapping)]


def valid_common_stock(row: Mapping[str, object]) -> bool:
    symbol = str(row.get("symbol") or "").strip().upper()
    exchange = str(row.get("exchange") or "").strip().upper()
    security_type = str(row.get("type") or "").strip()
    name = str(row.get("name") or "").strip()
    if not symbol or not name:
        return False
    if security_type != COMMON_STOCK_TYPE:
        return False
    if exchange not in US_EXCHANGES:
        return False
    if not SYMBOL_PATTERN.fullmatch(symbol):
        return False
    if " ACQUISITION " in f" {name.upper()} ":
        return False
    return True


def refresh_us_stocks_catalog(path: Path = CATALOG_PATH) -> list[str]:
    keys = load_provider_keys()
    if not keys.twelve_data_api_key:
        return []

    rows: list[dict[str, object]] = []
    for exchange in sorted(US_EXCHANGES):
        rows.extend(fetch_twelve_exchange_catalog(exchange, api_key=keys.twelve_data_api_key))

    symbols = sorted({str(row["symbol"]).strip().upper() for row in rows if valid_common_stock(row)})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "catalog_version": CATALOG_VERSION,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(symbols),
                "exchanges": sorted(US_EXCHANGES),
                "symbols": symbols,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    return symbols


def load_us_stocks_catalog(path: Path = CATALOG_PATH, *, refresh_if_stale: bool = True, max_age_hours: int = REFRESH_HOURS) -> list[str]:
    catalog_current = False
    if path.exists():
        try:
            existing = json.loads(path.read_text())
            catalog_current = (
                int(existing.get("catalog_version", 0) or 0) >= CATALOG_VERSION
                and set(existing.get("exchanges") or []) == US_EXCHANGES
            )
        except Exception:
            catalog_current = False
    if refresh_if_stale and (is_stale(path, max_age_hours=max_age_hours) or not catalog_current):
        refreshed = refresh_us_stocks_catalog(path)
        if refreshed:
            return refreshed
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return []
    symbols = payload.get("symbols")
    if not isinstance(symbols, list):
        return []
    return normalize_tickers(str(symbol) for symbol in symbols)


def load_rotation_state(path: Path = STATE_PATH) -> int:
    if not path.exists():
        return 0
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return 0
    return int(payload.get("cursor", 0) or 0)


def load_rotation_reservation(path: Path = STATE_PATH) -> dict[str, int]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
        pending = payload.get("pending")
    except Exception:
        return {}
    if not isinstance(pending, Mapping):
        return {}
    try:
        return {
            "start": max(0, int(pending.get("start", 0) or 0)),
            "end": max(0, int(pending.get("end", 0) or 0)),
            "universe_total": max(0, int(pending.get("universe_total", 0) or 0)),
            "batch_size": max(0, int(pending.get("batch_size", 0) or 0)),
        }
    except (TypeError, ValueError):
        return {}


def save_rotation_state(cursor: int, path: Path = STATE_PATH, *, pending: Mapping[str, int] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {
        "cursor": max(0, int(cursor)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if pending:
        payload["pending"] = {key: max(0, int(value)) for key, value in pending.items()}
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True)
        + "\n"
    )


def commit_dynamic_universe(universe: DynamicUniverse, path: Path = STATE_PATH) -> None:
    pending = load_rotation_reservation(path)
    if pending and (
        pending.get("start") != universe.cursor_start
        or pending.get("end") != universe.cursor_end
        or pending.get("universe_total") != universe.universe_total
    ):
        return
    save_rotation_state(universe.cursor_end, path)


def build_dynamic_universe(
    seed_symbols: Iterable[str],
    *,
    max_symbols: int = 120,
    rotate_count: int = 80,
    catalog_path: Path = CATALOG_PATH,
    state_path: Path = STATE_PATH,
) -> DynamicUniverse:
    seeds = normalize_tickers(seed_symbols)
    catalog = load_us_stocks_catalog(catalog_path)
    if not catalog:
        chosen = seeds[:max_symbols]
        return DynamicUniverse(chosen, 0, len(chosen), 0, len(chosen), 0, 0)

    # Reserve only the slots that were not requested for exchange-wide rotation.
    # Argentum passes rotate_count == max_symbols, so every slot advances through
    # the full catalog instead of repeating the same curated names each cycle.
    usable_dynamic = min(max_symbols, max(0, rotate_count), len(catalog))
    seed_slots = max(0, max_symbols - usable_dynamic)
    priority_seeds = seeds[:seed_slots]
    priority_set = set(priority_seeds)
    missing_seeds = [symbol for symbol in seeds if symbol not in catalog and symbol not in priority_set]
    dynamic_pool = normalize_tickers([
        *(symbol for symbol in catalog if symbol not in priority_set),
        *missing_seeds,
    ])
    usable_dynamic = min(usable_dynamic, len(dynamic_pool))
    committed_cursor = max(0, load_rotation_state(state_path))
    reservation = load_rotation_reservation(state_path)
    reservation_matches = (
        reservation.get("start") == committed_cursor
        and reservation.get("universe_total") == len(priority_seeds) + len(dynamic_pool)
        and reservation.get("batch_size") == usable_dynamic
        and reservation.get("end") == committed_cursor + usable_dynamic
    )
    absolute_cursor = reservation["start"] if reservation_matches else committed_cursor
    start = absolute_cursor % len(dynamic_pool) if dynamic_pool else 0
    selected: list[str] = []
    for index in range(usable_dynamic):
        selected.append(dynamic_pool[(start + index) % len(dynamic_pool)])
    cursor_end = absolute_cursor + usable_dynamic
    save_rotation_state(committed_cursor, state_path, pending={
        "start": absolute_cursor,
        "end": cursor_end,
        "universe_total": len(priority_seeds) + len(dynamic_pool),
        "batch_size": usable_dynamic,
    })

    combined = normalize_tickers([*priority_seeds, *selected])[:max_symbols]
    return DynamicUniverse(
        symbols=combined,
        source_catalog_count=len(catalog),
        universe_total=len(priority_seeds) + len(dynamic_pool),
        selected_dynamic_count=len(selected),
        seed_count=len(priority_seeds),
        cursor_start=absolute_cursor,
        cursor_end=cursor_end,
    )
