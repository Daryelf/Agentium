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
US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "NYSE MKT"}
COMMON_STOCK_TYPE = "Common Stock"
SYMBOL_PATTERN = re.compile(r"^[A-Z]{1,5}$")


@dataclass(frozen=True)
class DynamicUniverse:
    symbols: list[str]
    source_catalog_count: int
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
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(symbols),
                "symbols": symbols,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    return symbols


def load_us_stocks_catalog(path: Path = CATALOG_PATH, *, refresh_if_stale: bool = True, max_age_hours: int = REFRESH_HOURS) -> list[str]:
    if refresh_if_stale and is_stale(path, max_age_hours=max_age_hours):
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


def save_rotation_state(cursor: int, path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "cursor": cursor,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


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
        return DynamicUniverse(chosen, 0, max(0, len(chosen) - len(seeds)), len(seeds), 0, 0)

    seed_set = set(seeds)
    dynamic_pool = [symbol for symbol in catalog if symbol not in seed_set]
    if max_symbols <= len(seeds):
        return DynamicUniverse(seeds[:max_symbols], len(catalog), 0, len(seeds), 0, 0)

    usable_dynamic = min(max_symbols - len(seeds), rotate_count, len(dynamic_pool))
    cursor = load_rotation_state(state_path)
    start = cursor % len(dynamic_pool) if dynamic_pool else 0
    selected: list[str] = []
    for index in range(usable_dynamic):
        selected.append(dynamic_pool[(start + index) % len(dynamic_pool)])
    save_rotation_state(start + usable_dynamic, state_path)

    combined = normalize_tickers([*seeds, *selected])[:max_symbols]
    return DynamicUniverse(
        symbols=combined,
        source_catalog_count=len(catalog),
        selected_dynamic_count=len(selected),
        seed_count=len(seeds),
        cursor_start=start,
        cursor_end=start + usable_dynamic,
    )
