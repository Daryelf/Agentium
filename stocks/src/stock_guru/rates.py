from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Callable, Mapping
import urllib.parse

import pandas as pd

from .config import DATA_DIR
from .data import fetch_json, load_provider_keys
from .provider_budget import reserve_provider_budget


FRED_SERIES_URL = "https://api.stlouisfed.org/fred/series/observations"
MACRO_RATES_PATH = DATA_DIR / "macro_rates.json"
CORE_RATE_SERIES: tuple[str, ...] = ("DGS10", "DGS3MO")
OPTIONAL_RATE_SERIES: tuple[str, ...] = ("BAMLH0A0HYM2",)


@dataclass(frozen=True)
class RateSeriesSnapshot:
    series_id: str
    latest_value: float | None
    latest_date: str | None
    change_20_observations: float | None
    observations: int


@dataclass(frozen=True)
class MacroRateContext:
    version: int
    generated_at: str
    provider: str
    status: str
    yield_curve_slope: float | None
    rate_state: str
    high_yield_spread: float | None
    series: Mapping[str, RateSeriesSnapshot]
    issues: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _parse_observations(series_id: str, payload: object) -> RateSeriesSnapshot:
    if not isinstance(payload, Mapping) or not isinstance(payload.get("observations"), list):
        return RateSeriesSnapshot(series_id, None, None, None, 0)
    values: list[tuple[str, float]] = []
    for item in payload["observations"]:
        if not isinstance(item, Mapping):
            continue
        try:
            value = float(item.get("value"))
            date = pd.Timestamp(item.get("date")).date().isoformat()
        except (TypeError, ValueError):
            continue
        values.append((date, value))
    values.sort(key=lambda item: item[0])
    if not values:
        return RateSeriesSnapshot(series_id, None, None, None, 0)
    change = values[-1][1] - values[-21][1] if len(values) >= 21 else None
    return RateSeriesSnapshot(series_id, values[-1][1], values[-1][0], round(change, 4) if change is not None else None, len(values))


def _read_cached_context(path: Path, *, day: str) -> MacroRateContext | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
        generated = pd.Timestamp(payload["generated_at"])
    except Exception:
        return None
    if generated.date().isoformat() != day or payload.get("status") not in {"DATA_OK", "DATA_PARTIAL"}:
        return None
    raw_series = payload.get("series") if isinstance(payload.get("series"), Mapping) else {}
    series = {
        str(key): RateSeriesSnapshot(**value)
        for key, value in raw_series.items()
        if isinstance(value, Mapping)
    }
    return MacroRateContext(
        version=int(payload.get("version", 1)),
        generated_at=str(payload["generated_at"]),
        provider=str(payload.get("provider") or "FRED"),
        status=str(payload.get("status") or "DATA_PARTIAL"),
        yield_curve_slope=payload.get("yield_curve_slope"),
        rate_state=str(payload.get("rate_state") or "UNKNOWN"),
        high_yield_spread=payload.get("high_yield_spread"),
        series=series,
        issues=tuple(str(item) for item in payload.get("issues", [])),
    )


def _write_context(context: MacroRateContext, path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(context.to_dict(), indent=2, sort_keys=True, allow_nan=False) + "\n")
        os.replace(temporary, path)
    except OSError:
        return


def fetch_macro_rate_context(
    *,
    api_key: str | None = None,
    path: Path = MACRO_RATES_PATH,
    now: datetime | None = None,
    fetcher: Callable[[str], object] = fetch_json,
    include_high_yield: bool = True,
    prefer_daily_cache: bool = True,
    persist: bool = True,
) -> MacroRateContext:
    at = now or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    day = at.astimezone(timezone.utc).date().isoformat()
    if prefer_daily_cache and persist:
        cached = _read_cached_context(path, day=day)
        if cached is not None:
            return cached
    key = str(api_key if api_key is not None else load_provider_keys().fred_api_key).strip()
    requested = [*CORE_RATE_SERIES, *(OPTIONAL_RATE_SERIES if include_high_yield else ())]
    if not key:
        context = MacroRateContext(1, at.astimezone(timezone.utc).isoformat(), "FRED", "DATA_INSUFFICIENT", None, "UNKNOWN", None, {}, ("FRED_API_KEY_MISSING",))
        if persist:
            _write_context(context, path)
        return context
    budget = reserve_provider_budget("FRED", len(requested))
    if not budget.allowed:
        context = MacroRateContext(1, at.astimezone(timezone.utc).isoformat(), "FRED", "DATA_INSUFFICIENT", None, "UNKNOWN", None, {}, ("FRED_DAILY_BUDGET_EXHAUSTED",))
        if persist:
            _write_context(context, path)
        return context

    series: dict[str, RateSeriesSnapshot] = {}
    issues: list[str] = []
    for series_id in requested:
        query = urllib.parse.urlencode({
            "series_id": series_id,
            "api_key": key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 40,
        })
        try:
            snapshot = _parse_observations(series_id, fetcher(f"{FRED_SERIES_URL}?{query}"))
        except Exception:
            snapshot = RateSeriesSnapshot(series_id, None, None, None, 0)
        series[series_id] = snapshot
        if snapshot.latest_value is None:
            issues.append(f"{series_id}_UNAVAILABLE")

    ten_year = series["DGS10"].latest_value
    three_month = series["DGS3MO"].latest_value
    slope = round(ten_year - three_month, 4) if ten_year is not None and three_month is not None else None
    rate_state = "UNKNOWN" if slope is None else "INVERTED" if slope < 0 else "STEEP" if slope >= 1 else "NORMAL"
    core_complete = all(series[item].latest_value is not None for item in CORE_RATE_SERIES)
    latest_core_dates = [pd.Timestamp(series[item].latest_date) for item in CORE_RATE_SERIES if series[item].latest_date]
    stale = not latest_core_dates or max((at.date() - item.date()).days for item in latest_core_dates) > 7
    if not core_complete:
        status = "DATA_INSUFFICIENT"
    elif stale:
        status = "DATA_STALE"
        issues.append("CORE_RATES_STALE")
    elif issues:
        status = "DATA_PARTIAL"
    else:
        status = "DATA_OK"
    context = MacroRateContext(
        version=1,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        provider="FRED",
        status=status,
        yield_curve_slope=slope,
        rate_state=rate_state,
        high_yield_spread=series.get("BAMLH0A0HYM2", RateSeriesSnapshot("BAMLH0A0HYM2", None, None, None, 0)).latest_value,
        series=series,
        issues=tuple(issues),
    )
    if persist:
        _write_context(context, path)
    return context


def market_regime_rate_values(context: MacroRateContext) -> dict[str, float]:
    return {
        series_id: snapshot.latest_value
        for series_id, snapshot in context.series.items()
        if snapshot.latest_value is not None
    }
