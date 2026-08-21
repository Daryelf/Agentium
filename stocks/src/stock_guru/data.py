from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import io
import os
from pathlib import Path
import time
from typing import Callable, Dict, Iterable, Mapping
import urllib.error
import urllib.parse
import urllib.request
import warnings
from contextlib import redirect_stderr, redirect_stdout

import pandas as pd
from urllib3.exceptions import NotOpenSSLWarning
import yfinance as yf

from .config import DATA_DIR, PROVIDER_HEALTH_PATH, PROVIDER_KEYS_PATH, PROVIDER_VALIDATION_PATH, normalize_tickers
from .market_data_quality import (
    DataProvenance,
    DataQualityIssue,
    DataQualityReport,
    ProviderAttempt,
    assess_market_data,
    build_provenance,
    record_provider_attempt,
    symbols_in_frame,
    compare_provider_closes,
)
from .provider_budget import reserve_provider_budget


warnings.filterwarnings("ignore", category=NotOpenSSLWarning)

YAHOO_CHART_ENDPOINTS = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
)
YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}
MARKET_CACHE_DIR = DATA_DIR / "market_cache"
YAHOO_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
TWELVE_DATA_API_KEY_ENV = "STOCK_GURU_TWELVE_DATA_API_KEY"
FMP_API_KEY_ENV = "STOCK_GURU_FMP_API_KEY"
ALPHA_VANTAGE_API_KEY_ENV = "STOCK_GURU_ALPHA_VANTAGE_API_KEY"
FRED_API_KEY_ENV = "STOCK_GURU_FRED_API_KEY"
TWELVE_DATA_URL = "https://api.twelvedata.com"
FMP_URL = "https://financialmodelingprep.com/stable"
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
STOOQ_URL = "https://stooq.com/q/d/l/"
PRICE_ADJUSTMENT_POLICY = "split_and_dividend_adjusted_ohlc_when_supported"


@dataclass(frozen=True)
class MarketData:
    tickers: list[str]
    history: pd.DataFrame
    provenance: DataProvenance | None = None
    quality: DataQualityReport | None = None


@dataclass(frozen=True)
class ProviderKeys:
    twelve_data_api_key: str = ""
    fmp_api_key: str = ""
    alpha_vantage_api_key: str = ""
    fred_api_key: str = ""

    @property
    def has_any(self) -> bool:
        return bool(self.twelve_data_api_key or self.fmp_api_key or self.alpha_vantage_api_key or self.fred_api_key)


class ProviderErrors(list[str]):
    """Backward-compatible error list carrying the selected provider and attempts."""

    def __init__(self) -> None:
        super().__init__()
        self.selected_provider: str | None = None
        self.attempts: list[ProviderAttempt] = []


def _record_provider_attempt(attempt: ProviderAttempt) -> None:
    try:
        record_provider_attempt(PROVIDER_HEALTH_PATH, attempt)
    except OSError:
        # Provider health is observability. A read-only runtime must not hide valid market data.
        return


def load_provider_keys(path: Path = PROVIDER_KEYS_PATH, *, env: Mapping[str, str] | None = None) -> ProviderKeys:
    values = dict(env or os.environ)
    payload: dict[str, object] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text())
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:
            payload = {}

    def pick(name: str, env_name: str) -> str:
        env_value = str(values.get(env_name, "") or "").strip()
        if env_value:
            return env_value
        return str(payload.get(name, "") or "").strip()

    return ProviderKeys(
        twelve_data_api_key=pick("twelve_data_api_key", TWELVE_DATA_API_KEY_ENV),
        fmp_api_key=pick("fmp_api_key", FMP_API_KEY_ENV),
        alpha_vantage_api_key=pick("alpha_vantage_api_key", ALPHA_VANTAGE_API_KEY_ENV),
        fred_api_key=pick("fred_api_key", FRED_API_KEY_ENV),
    )


def default_cache_ttl_seconds(interval: str) -> int:
    if interval.endswith("m"):
        return 10 * 60
    if interval.endswith("h"):
        return 60 * 60
    return 6 * 60 * 60


def history_cache_key(symbols: list[str], *, period: str, interval: str) -> str:
    joined = "|".join(sorted(symbols))
    payload = f"{joined}::{period}::{interval}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def history_cache_paths(symbols: list[str], *, period: str, interval: str, cache_dir: Path | None = None) -> tuple[Path, Path]:
    root = cache_dir or MARKET_CACHE_DIR
    key = history_cache_key(symbols, period=period, interval=interval)
    return root / f"{key}.pkl", root / f"{key}.json"


def cache_telemetry_path(cache_dir: Path | None = None) -> Path:
    return (cache_dir or MARKET_CACHE_DIR) / "cache_telemetry.json"


def record_cache_event(event: str, *, cache_dir: Path | None = None, now: datetime | None = None) -> None:
    path = cache_telemetry_path(cache_dir)
    at = now or datetime.now(timezone.utc)
    try:
        payload = json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    hits = int(payload.get("hits", 0) or 0)
    misses = int(payload.get("misses", 0) or 0)
    writes = int(payload.get("writes", 0) or 0)
    if event == "hit":
        hits += 1
    elif event == "miss":
        misses += 1
    elif event == "write":
        writes += 1
    reads = hits + misses
    payload.update({
        "version": 1,
        "updated_at": at.isoformat(),
        "hits": hits,
        "misses": misses,
        "writes": writes,
        "hit_rate": round(hits / reads, 4) if reads else 0.0,
        "last_event": event,
    })
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
    except OSError:
        return


def save_history_cache(
    history: pd.DataFrame,
    symbols: list[str],
    *,
    period: str,
    interval: str,
    cache_dir: Path | None = None,
    provenance: DataProvenance | None = None,
    quality: DataQualityReport | None = None,
) -> None:
    if history.empty:
        return
    cache_path, meta_path = history_cache_paths(symbols, period=period, interval=interval, cache_dir=cache_dir)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    history.to_pickle(cache_path)
    meta_path.write_text(
        json.dumps(
            {
                "symbols": symbols,
                "period": period,
                "interval": interval,
                "cached_at": datetime.now(timezone.utc).isoformat(),
                "provenance": provenance.to_dict() if provenance else None,
                "quality": quality.to_dict() if quality else None,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    record_cache_event("write", cache_dir=cache_dir)


def load_history_cache(
    symbols: list[str],
    *,
    period: str,
    interval: str,
    cache_dir: Path | None = None,
    max_age_seconds: int | None = None,
) -> pd.DataFrame:
    cache_path, meta_path = history_cache_paths(symbols, period=period, interval=interval, cache_dir=cache_dir)
    if not cache_path.exists() or not meta_path.exists():
        record_cache_event("miss", cache_dir=cache_dir)
        return pd.DataFrame()
    try:
        meta = json.loads(meta_path.read_text())
        cached_at = datetime.fromisoformat(meta["cached_at"])
        if cached_at.tzinfo is None:
            cached_at = cached_at.replace(tzinfo=timezone.utc)
    except Exception:
        record_cache_event("miss", cache_dir=cache_dir)
        return pd.DataFrame()
    age_seconds = (datetime.now(timezone.utc) - cached_at).total_seconds()
    if max_age_seconds is not None and age_seconds > max_age_seconds:
        record_cache_event("miss", cache_dir=cache_dir)
        return pd.DataFrame()
    try:
        history = pd.read_pickle(cache_path)
    except Exception:
        record_cache_event("miss", cache_dir=cache_dir)
        return pd.DataFrame()
    if isinstance(history, pd.DataFrame):
        record_cache_event("hit", cache_dir=cache_dir)
        return history
    record_cache_event("miss", cache_dir=cache_dir)
    return pd.DataFrame()


def load_history_cache_metadata(
    symbols: list[str],
    *,
    period: str,
    interval: str,
    cache_dir: Path | None = None,
) -> dict[str, object]:
    _, meta_path = history_cache_paths(symbols, period=period, interval=interval, cache_dir=cache_dir)
    if not meta_path.exists():
        return {}
    try:
        payload = json.loads(meta_path.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def supports_provider_history(interval: str) -> bool:
    return interval in {"1d", "1day"}


def outputsize_for_period(period: str) -> int:
    value = period.strip().lower()
    if value.endswith("d") and value[:-1].isdigit():
        return max(2, int(value[:-1]))
    if value.endswith("mo") and value[:-2].isdigit():
        return max(22, int(value[:-2]) * 22)
    if value.endswith("y") and value[:-1].isdigit():
        return max(260, int(value[:-1]) * 260)
    mapping = {
        "5d": 5,
        "1mo": 22,
        "3mo": 66,
        "6mo": 132,
        "1y": 260,
        "2y": 520,
        "5y": 1300,
        "10y": 2600,
        "max": 5000,
    }
    return mapping.get(value, 260)


def frame_from_ohlcv_records(symbol: str, records: list[Mapping[str, object]]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame()

    parsed_rows: list[dict[str, float]] = []
    timestamps: list[pd.Timestamp] = []
    for item in records:
        try:
            when = str(item.get("datetime") or item.get("date") or "").strip()
            if not when:
                continue
            timestamps.append(pd.Timestamp(when, tz="UTC"))
            raw_close = float(item.get("close", 0) or 0)
            adjusted_close = float(
                item.get("adjusted_close")
                or item.get("adjustedClose")
                or item.get("adjClose")
                or item.get("adj_close")
                or raw_close
            )
            adjustment_ratio = adjusted_close / raw_close if raw_close > 0 and adjusted_close > 0 else 1.0
            parsed_rows.append({
                "Open": float(item.get("open", 0) or 0) * adjustment_ratio,
                "High": float(item.get("high", 0) or 0) * adjustment_ratio,
                "Low": float(item.get("low", 0) or 0) * adjustment_ratio,
                "Close": adjusted_close,
                "Volume": float(item.get("volume", 0) or 0),
            })
        except Exception:
            continue

    if not parsed_rows:
        return pd.DataFrame()

    frame = pd.DataFrame(parsed_rows, index=pd.DatetimeIndex(timestamps))
    frame = frame.sort_index()
    frame.columns = pd.MultiIndex.from_product([frame.columns, [symbol]], names=["Price", "Ticker"])
    return frame


def fetch_json(url: str, *, headers: Mapping[str, str] | None = None, timeout: float = 20.0) -> object:
    request = urllib.request.Request(url, headers=dict(headers or YAHOO_HEADERS))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def build_twelve_data_history_url(symbols: list[str], *, period: str, interval: str, api_key: str) -> str:
    query = urllib.parse.urlencode(
        {
            "symbol": ",".join(symbols),
            "interval": "1day" if interval == "1d" else interval,
            "outputsize": outputsize_for_period(period),
            "apikey": api_key,
        }
    )
    return f"{TWELVE_DATA_URL}/time_series?{query}"


def download_twelve_data_history(symbols: list[str], *, period: str, interval: str, api_key: str) -> pd.DataFrame:
    if not api_key or not supports_provider_history(interval):
        return pd.DataFrame()
    try:
        payload = fetch_json(build_twelve_data_history_url(symbols, period=period, interval=interval, api_key=api_key))
    except Exception:
        return pd.DataFrame()

    if not isinstance(payload, Mapping):
        return pd.DataFrame()
    if payload.get("status") == "error":
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    if "values" in payload:
        frame = frame_from_ohlcv_records(symbols[0], payload.get("values", []))
        if not frame.empty:
            frames.append(frame)
    else:
        for symbol in symbols:
            item = payload.get(symbol)
            if not isinstance(item, Mapping) or item.get("status") == "error":
                continue
            frame = frame_from_ohlcv_records(symbol, item.get("values", []))
            if not frame.empty:
                frames.append(frame)
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1).sort_index()
    return combined.loc[:, ~combined.columns.duplicated()]


def download_fmp_history(symbols: list[str], *, period: str, interval: str, api_key: str) -> pd.DataFrame:
    if not api_key or not supports_provider_history(interval):
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    for symbol in symbols:
        query = urllib.parse.urlencode({"symbol": symbol, "apikey": api_key})
        url = f"{FMP_URL}/historical-price-eod/full?{query}"
        try:
            payload = fetch_json(url)
        except Exception:
            continue
        if not isinstance(payload, list):
            continue
        frame = frame_from_ohlcv_records(symbol, payload[: max(outputsize_for_period(period), 2)])
        if not frame.empty:
            frames.append(frame)
        time.sleep(0.05)

    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1).sort_index()
    return combined.loc[:, ~combined.columns.duplicated()]


def download_alpha_vantage_history(symbols: list[str], *, period: str, interval: str, api_key: str) -> pd.DataFrame:
    if not api_key or not supports_provider_history(interval):
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    outputsize = "full" if outputsize_for_period(period) > 100 else "compact"
    for symbol in symbols:
        query = urllib.parse.urlencode(
            {
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": outputsize,
                "apikey": api_key,
            }
        )
        try:
            payload = fetch_json(f"{ALPHA_VANTAGE_URL}?{query}")
        except Exception:
            continue
        if not isinstance(payload, Mapping):
            continue
        time_series = payload.get("Time Series (Daily)")
        if not isinstance(time_series, Mapping):
            continue
        records = [
            {
                "date": day,
                "open": values.get("1. open"),
                "high": values.get("2. high"),
                "low": values.get("3. low"),
                "close": values.get("4. close"),
                "volume": values.get("5. volume"),
            }
            for day, values in time_series.items()
            if isinstance(values, Mapping)
        ]
        frame = frame_from_ohlcv_records(symbol, records[: max(outputsize_for_period(period), 2)])
        if not frame.empty:
            frames.append(frame)
        time.sleep(0.2)

    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1).sort_index()
    return combined.loc[:, ~combined.columns.duplicated()]


def download_stooq_history(symbols: list[str], *, period: str, interval: str) -> pd.DataFrame:
    if not supports_provider_history(interval):
        return pd.DataFrame()
    frames: list[pd.DataFrame] = []
    maximum_rows = outputsize_for_period(period)
    for symbol in symbols:
        if symbol.startswith("^"):
            continue
        stooq_symbol = symbol.lower() if "." in symbol else f"{symbol.lower()}.us"
        query = urllib.parse.urlencode({"s": stooq_symbol, "i": "d"})
        request = urllib.request.Request(f"{STOOQ_URL}?{query}", headers=YAHOO_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8", errors="replace")
            parsed = pd.read_csv(io.StringIO(raw))
        except Exception:
            continue
        required = {"Date", "Open", "High", "Low", "Close", "Volume"}
        if parsed.empty or not required.issubset(parsed.columns):
            continue
        parsed = parsed.tail(maximum_rows).copy()
        parsed.index = pd.to_datetime(parsed.pop("Date"), utc=True, errors="coerce")
        parsed = parsed.loc[parsed.index.notna(), ["Open", "High", "Low", "Close", "Volume"]]
        parsed = parsed.apply(pd.to_numeric, errors="coerce").dropna(subset=["Close"])
        if parsed.empty:
            continue
        parsed.columns = pd.MultiIndex.from_product([parsed.columns, [symbol]], names=["Price", "Ticker"])
        frames.append(parsed)
        time.sleep(0.05)
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1).sort_index()
    return combined.loc[:, ~combined.columns.duplicated()]


def download_provider_history(symbols: list[str], *, period: str, interval: str) -> tuple[pd.DataFrame, list[str]]:
    keys = load_provider_keys()
    errors = ProviderErrors()

    def attempt(provider: str, fetcher) -> pd.DataFrame:
        started = datetime.now(timezone.utc)
        error: str | None = None
        request_units = len(symbols) if provider in {"FMP", "ALPHA_VANTAGE"} else 1
        budget = reserve_provider_budget(provider, request_units)
        if not budget.allowed:
            result = pd.DataFrame()
            error = budget.reason
        else:
            try:
                result = fetcher()
            except Exception as exc:
                result = pd.DataFrame()
                error = f"{type(exc).__name__}: {exc}"
        completed = datetime.now(timezone.utc)
        status = "success" if not result.empty else "budget_exhausted" if not budget.allowed else "no_data"
        attempt_record = ProviderAttempt(
            provider=provider,
            status=status,
            started_at=started.isoformat(),
            completed_at=completed.isoformat(),
            latency_ms=max(0, round((completed - started).total_seconds() * 1000)),
            data_type="OHLCV_HISTORY",
            interval=interval,
            requested_symbols=tuple(symbols),
            returned_symbols=symbols_in_frame(result),
            error=error or (None if status == "success" else f"{provider} returned no data"),
        )
        errors.attempts.append(attempt_record)
        _record_provider_attempt(attempt_record)
        if status == "success":
            errors.selected_provider = provider
        return result

    if keys.twelve_data_api_key:
        history = attempt("TWELVE_DATA", lambda: download_twelve_data_history(symbols, period=period, interval=interval, api_key=keys.twelve_data_api_key))
        if not history.empty:
            return history, errors
        errors.append("Twelve Data returned no data")
    if keys.fmp_api_key:
        history = attempt("FMP", lambda: download_fmp_history(symbols, period=period, interval=interval, api_key=keys.fmp_api_key))
        if not history.empty:
            return history, errors
        errors.append("FMP returned no data")
    if keys.alpha_vantage_api_key and len(symbols) <= 5:
        history = attempt("ALPHA_VANTAGE", lambda: download_alpha_vantage_history(symbols, period=period, interval=interval, api_key=keys.alpha_vantage_api_key))
        if not history.empty:
            return history, errors
        errors.append("Alpha Vantage returned no data")
    return pd.DataFrame(), errors


def _bounded_env_integer(name: str, fallback: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.environ.get(name, "") or "").strip())
    except ValueError:
        value = fallback
    return max(minimum, min(maximum, value))


def _read_provider_validation(path: Path = PROVIDER_VALIDATION_PATH) -> dict[str, object]:
    if not path.exists():
        return {"version": 1, "day": None, "verified_symbols": [], "checks": []}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {"version": 1, "day": None, "verified_symbols": [], "checks": []}
    return payload if isinstance(payload, dict) else {"version": 1, "day": None, "verified_symbols": [], "checks": []}


def _write_provider_validation(payload: Mapping[str, object], path: Path = PROVIDER_VALIDATION_PATH) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(dict(payload), indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
    except OSError:
        return


def spot_verification_symbols(symbols: list[str], day: str, already_verified: Iterable[str], limit: int) -> list[str]:
    prior = {str(symbol).upper() for symbol in already_verified}
    eligible = [symbol for symbol in normalize_tickers(symbols) if symbol not in prior and not symbol.startswith("^")]
    eligible.sort(key=lambda symbol: hashlib.sha256(f"{day}:{symbol}".encode("utf-8")).hexdigest())
    return eligible[: max(0, limit)]


def spot_verify_provider_history(
    history: pd.DataFrame,
    symbols: list[str],
    *,
    selected_provider: str,
    period: str,
    interval: str,
    now: datetime | None = None,
    path: Path = PROVIDER_VALIDATION_PATH,
    fetcher: Callable[[list[str]], pd.DataFrame] | None = None,
) -> tuple[tuple[DataQualityIssue, ...], dict[str, object]]:
    if history.empty or not supports_provider_history(interval):
        return (), {"status": "skipped", "reason": "daily history is required"}
    at = now or datetime.now(timezone.utc)
    day = at.astimezone(timezone.utc).date().isoformat()
    daily_limit = _bounded_env_integer("STOCK_GURU_PROVIDER_VALIDATION_DAILY_SYMBOLS", 12, 1, 100)
    batch_limit = _bounded_env_integer("STOCK_GURU_PROVIDER_VALIDATION_PER_BATCH", 3, 1, 20)
    payload = _read_provider_validation(path)
    if payload.get("day") != day:
        payload = {"version": 1, "day": day, "verified_symbols": [], "checks": []}
    verified = [str(symbol).upper() for symbol in payload.get("verified_symbols", []) if str(symbol).strip()]
    remaining_budget = max(0, daily_limit - len(set(verified)))
    selected = spot_verification_symbols(symbols, day, verified, min(batch_limit, remaining_budget))
    if not selected:
        return (), {"status": "complete", "day": day, "checked_today": len(set(verified)), "daily_limit": daily_limit}

    validator = "STOOQ" if selected_provider in {"YAHOO_CHART", "YFINANCE"} else "YAHOO_CHART"
    budget = reserve_provider_budget(validator, len(selected))
    checked_at = at.isoformat()
    validation = pd.DataFrame()
    if budget.allowed:
        if fetcher is not None:
            validation = fetcher(selected)
        elif validator == "STOOQ":
            validation = download_stooq_history(selected, period=period, interval=interval)
        else:
            validation = download_yahoo_chart_history(selected, period=period, interval=interval)
    issues: list[DataQualityIssue] = []
    if validation.empty:
        code = "PROVIDER_VALIDATION_DEFERRED" if not budget.allowed else "PROVIDER_VALIDATION_UNAVAILABLE"
        issues.append(DataQualityIssue(code, "warning", budget.reason if not budget.allowed else f"{validator} returned no validation data for the rotating sample."))
        status = "deferred" if not budget.allowed else "unavailable"
    else:
        issues.extend(compare_provider_closes(history, validation, selected))
        status = "conflict" if issues else "passed"
    check = {
        "checked_at": checked_at,
        "primary_provider": selected_provider,
        "validation_provider": validator,
        "symbols": selected,
        "status": status,
        "issue_codes": [issue.code for issue in issues],
    }
    payload["verified_symbols"] = sorted(set(verified) | set(selected))
    payload["checks"] = ([item for item in payload.get("checks", []) if isinstance(item, dict)] + [check])[-40:]
    payload["updated_at"] = checked_at
    _write_provider_validation(payload, path)
    return tuple(issues), {**check, "checked_today": len(payload["verified_symbols"]), "daily_limit": daily_limit}


def download_history(
    tickers: Iterable[str],
    period: str = "6mo",
    interval: str = "1d",
    *,
    prefer_cache: bool = False,
    cache_max_age_seconds: int | None = None,
    spot_verify: bool = False,
) -> MarketData:
    symbols = normalize_tickers(tickers)
    if not symbols:
        raise ValueError("No tickers supplied")

    cache_age = default_cache_ttl_seconds(interval) if cache_max_age_seconds is None else cache_max_age_seconds
    if prefer_cache:
        cached = load_history_cache(
            symbols,
            period=period,
            interval=interval,
            max_age_seconds=cache_age,
        )
        if not cached.empty:
            cached = retry_missing_symbols(cached, symbols, period, interval)
            received_at = datetime.now(timezone.utc)
            metadata = load_history_cache_metadata(symbols, period=period, interval=interval)
            original = metadata.get("provenance", {}) if isinstance(metadata.get("provenance"), dict) else {}
            verification_issues: tuple[DataQualityIssue, ...] = ()
            verification: dict[str, object] = {"status": "disabled"}
            if spot_verify:
                verification_issues, verification = spot_verify_provider_history(
                    cached,
                    symbols,
                    selected_provider=str(original.get("provider") or "CACHE"),
                    period=period,
                    interval=interval,
                    now=received_at,
                )
            quality = assess_market_data(cached, symbols, interval=interval, now=received_at, external_issues=verification_issues)
            provenance = build_provenance(
                provider="CACHE",
                history=cached,
                symbols=symbols,
                period=period,
                interval=interval,
                received_at=received_at,
                latency_ms=0,
                fallback_from=(str(original.get("provider")),) if original.get("provider") else (),
                endpoint="local_market_cache",
                quality=quality,
                metadata={
                    "price_adjustment_policy": PRICE_ADJUSTMENT_POLICY,
                    "cached_provenance": original,
                    "spot_verification": verification,
                },
            )
            return MarketData(symbols, cached, provenance, quality)

    source_errors: list[str] = []
    history = pd.DataFrame()
    provider_errors: list[str] = []
    selected_provider: str | None = None
    selected_latency_ms: int | None = None
    fallback_from: list[str] = []
    endpoint: str | None = None
    if supports_provider_history(interval):
        history, provider_errors = download_provider_history(symbols, period=period, interval=interval)
        source_errors.extend(provider_errors)
        selected_provider = getattr(provider_errors, "selected_provider", None)
        attempts = getattr(provider_errors, "attempts", [])
        fallback_from.extend(attempt.provider for attempt in attempts if attempt.status != "success")
        selected_attempt = next((attempt for attempt in reversed(attempts) if attempt.status == "success"), None)
        if selected_attempt:
            selected_latency_ms = selected_attempt.latency_ms
        endpoint = {
            "TWELVE_DATA": "time_series",
            "FMP": "historical-price-eod/full",
            "ALPHA_VANTAGE": "TIME_SERIES_DAILY",
        }.get(selected_provider)

    if history.empty:
        started = datetime.now(timezone.utc)
        yahoo_budget = reserve_provider_budget("YAHOO_CHART", len(symbols))
        history = download_yahoo_chart_history(symbols, period=period, interval=interval) if yahoo_budget.allowed else pd.DataFrame()
        completed = datetime.now(timezone.utc)
        yahoo_attempt = ProviderAttempt(
            provider="YAHOO_CHART",
            status="success" if not history.empty else "budget_exhausted" if not yahoo_budget.allowed else "no_data",
            started_at=started.isoformat(),
            completed_at=completed.isoformat(),
            latency_ms=max(0, round((completed - started).total_seconds() * 1000)),
            data_type="OHLCV_HISTORY",
            interval=interval,
            requested_symbols=tuple(symbols),
            returned_symbols=symbols_in_frame(history),
            error=None if not history.empty else yahoo_budget.reason if not yahoo_budget.allowed else "Yahoo chart returned no data after retries",
        )
        _record_provider_attempt(yahoo_attempt)
        if history.empty:
            source_errors.append("Yahoo chart returned no data after retries")
            fallback_from.append("YAHOO_CHART")
        else:
            selected_provider = "YAHOO_CHART"
            selected_latency_ms = yahoo_attempt.latency_ms
            endpoint = "v8/finance/chart"
    if history.empty:
        started = datetime.now(timezone.utc)
        yfinance_budget = reserve_provider_budget("YFINANCE", 1)
        history = download_with_yfinance(symbols, period=period, interval=interval) if yfinance_budget.allowed else pd.DataFrame()
        completed = datetime.now(timezone.utc)
        yfinance_attempt = ProviderAttempt(
            provider="YFINANCE",
            status="success" if not history.empty else "budget_exhausted" if not yfinance_budget.allowed else "no_data",
            started_at=started.isoformat(),
            completed_at=completed.isoformat(),
            latency_ms=max(0, round((completed - started).total_seconds() * 1000)),
            data_type="OHLCV_HISTORY",
            interval=interval,
            requested_symbols=tuple(symbols),
            returned_symbols=symbols_in_frame(history),
            error=None if not history.empty else yfinance_budget.reason if not yfinance_budget.allowed else "yfinance fallback returned no data",
        )
        _record_provider_attempt(yfinance_attempt)
        if history.empty:
            source_errors.append("yfinance fallback returned no data")
            fallback_from.append("YFINANCE")
        else:
            selected_provider = "YFINANCE"
            selected_latency_ms = yfinance_attempt.latency_ms
            endpoint = "yfinance.download"
    if history.empty and supports_provider_history(interval):
        started = datetime.now(timezone.utc)
        stooq_budget = reserve_provider_budget("STOOQ", len(symbols))
        history = download_stooq_history(symbols, period=period, interval=interval) if stooq_budget.allowed else pd.DataFrame()
        completed = datetime.now(timezone.utc)
        stooq_attempt = ProviderAttempt(
            provider="STOOQ",
            status="success" if not history.empty else "budget_exhausted" if not stooq_budget.allowed else "no_data",
            started_at=started.isoformat(),
            completed_at=completed.isoformat(),
            latency_ms=max(0, round((completed - started).total_seconds() * 1000)),
            data_type="OHLCV_HISTORY",
            interval=interval,
            requested_symbols=tuple(symbols),
            returned_symbols=symbols_in_frame(history),
            error=None if not history.empty else stooq_budget.reason if not stooq_budget.allowed else "Stooq returned no data",
        )
        _record_provider_attempt(stooq_attempt)
        if history.empty:
            source_errors.append("Stooq returned no data")
            fallback_from.append("STOOQ")
        else:
            selected_provider = "STOOQ"
            selected_latency_ms = stooq_attempt.latency_ms
            endpoint = "q/d/l"
    if history.empty:
        history = load_history_cache(
            symbols,
            period=period,
            interval=interval,
            max_age_seconds=cache_age,
        )
        if history.empty:
            detail = "; ".join(source_errors) if source_errors else "all sources returned empty data"
            raise RuntimeError(f"No fresh market data returned. {detail}.")
        selected_provider = "CACHE"
        selected_latency_ms = 0
        endpoint = "local_market_cache"
    history = retry_missing_symbols(history, symbols, period, interval)
    received_at = datetime.now(timezone.utc)
    verification_issues: tuple[DataQualityIssue, ...] = ()
    verification: dict[str, object] = {"status": "disabled"}
    if spot_verify:
        verification_issues, verification = spot_verify_provider_history(
            history,
            symbols,
            selected_provider=selected_provider or "UNKNOWN",
            period=period,
            interval=interval,
            now=received_at,
        )
    quality = assess_market_data(history, symbols, interval=interval, now=received_at, external_issues=verification_issues)
    provenance = build_provenance(
        provider=selected_provider or "UNKNOWN",
        history=history,
        symbols=symbols,
        period=period,
        interval=interval,
        received_at=received_at,
        latency_ms=selected_latency_ms,
        fallback_from=fallback_from,
        errors=source_errors,
        endpoint=endpoint,
        quality=quality,
        metadata={
            "price_adjustment_policy": PRICE_ADJUSTMENT_POLICY,
            "provider_adjustment": "auto_adjusted" if selected_provider in {"YAHOO_CHART", "YFINANCE"}
            else "record_adjusted_when_available" if selected_provider in {"TWELVE_DATA", "FMP", "ALPHA_VANTAGE"}
            else "unverified_provider_adjustment" if selected_provider == "STOOQ"
            else "cached_from_recorded_provenance",
            "spot_verification": verification,
        },
    )
    if selected_provider != "CACHE":
        save_history_cache(history, symbols, period=period, interval=interval, provenance=provenance, quality=quality)
    return MarketData(symbols, history, provenance, quality)


def download_with_yfinance(symbols: list[str], *, period: str, interval: str) -> pd.DataFrame:
    try:
        sink = io.StringIO()
        with redirect_stdout(sink), redirect_stderr(sink):
            return yf.download(
                tickers=" ".join(symbols),
                period=period,
                interval=interval,
                auto_adjust=True,
                group_by="column",
                threads=False,
                progress=False,
            )
    except Exception:
        return pd.DataFrame()


def download_yahoo_chart_history(symbols: list[str], *, period: str, interval: str) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for index, symbol in enumerate(symbols):
        frame = download_yahoo_chart_symbol(symbol, period=period, interval=interval)
        if not frame.empty:
            frames.append(frame)
        if index < len(symbols) - 1:
            time.sleep(0.05)

    if not frames:
        return pd.DataFrame()
    history = pd.concat(frames, axis=1).sort_index()
    return history.loc[:, ~history.columns.duplicated()]


def download_yahoo_chart_symbol(symbol: str, *, period: str, interval: str) -> pd.DataFrame:
    encoded = urllib.parse.quote(symbol, safe="")
    query = urllib.parse.urlencode(
        {
            "range": period,
            "interval": interval,
            "includePrePost": "false",
            "events": "div,splits",
        }
    )
    for endpoint in YAHOO_CHART_ENDPOINTS:
        url = endpoint.format(symbol=encoded) + "?" + query
        for attempt in range(3):
            request = urllib.request.Request(url, headers=YAHOO_HEADERS)
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code in YAHOO_RETRYABLE_STATUS_CODES and attempt < 2:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                break
            except (TimeoutError, urllib.error.URLError, json.JSONDecodeError):
                if attempt < 2:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                break
            frame = frame_from_chart_payload(symbol, payload)
            if not frame.empty:
                return frame
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
    return pd.DataFrame()


def frame_from_chart_payload(symbol: str, payload: Mapping[str, object]) -> pd.DataFrame:
    chart = payload.get("chart")
    if not isinstance(chart, Mapping):
        return pd.DataFrame()
    results = chart.get("result")
    if not isinstance(results, list) or not results:
        return pd.DataFrame()
    result = results[0]
    if not isinstance(result, Mapping):
        return pd.DataFrame()

    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    if not isinstance(timestamps, list) or not isinstance(indicators, Mapping):
        return pd.DataFrame()
    quotes = indicators.get("quote")
    if not isinstance(quotes, list) or not quotes:
        return pd.DataFrame()
    quote = quotes[0]
    if not isinstance(quote, Mapping):
        return pd.DataFrame()

    index = pd.to_datetime(timestamps, unit="s", utc=True)
    fields = {"Open": quote.get("open", []), "High": quote.get("high", []), "Low": quote.get("low", []), "Close": quote.get("close", []), "Volume": quote.get("volume", [])}
    adjclose = indicators.get("adjclose")
    if isinstance(adjclose, list) and adjclose:
        adjusted = adjclose[0]
        if isinstance(adjusted, Mapping) and adjusted.get("adjclose"):
            raw_close = pd.to_numeric(pd.Series(fields["Close"], index=index), errors="coerce")
            adjusted_close = pd.to_numeric(pd.Series(adjusted["adjclose"], index=index), errors="coerce")
            ratio = (adjusted_close / raw_close).replace([float("inf"), float("-inf")], pd.NA).fillna(1.0)
            for field in ("Open", "High", "Low"):
                fields[field] = (pd.to_numeric(pd.Series(fields[field], index=index), errors="coerce") * ratio).tolist()
            fields["Close"] = adjusted_close.tolist()

    series_map: dict[tuple[str, str], pd.Series] = {}
    for field, values in fields.items():
        if not isinstance(values, list) or not values:
            continue
        series = pd.Series(values, index=index)
        if field == "Volume":
            numeric = pd.to_numeric(series, errors="coerce").fillna(0.0)
        else:
            numeric = pd.to_numeric(series, errors="coerce")
        series_map[(field, symbol)] = numeric

    if not series_map:
        return pd.DataFrame()

    frame = pd.DataFrame(series_map)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns, names=["Price", "Ticker"])
    frame = frame.dropna(how="all")
    return frame


def retry_missing_symbols(
    history: pd.DataFrame,
    symbols: list[str],
    period: str,
    interval: str,
) -> pd.DataFrame:
    missing = [symbol for symbol in symbols if close_for_symbol(history, symbol).empty]
    if not missing:
        return history

    pieces = [to_multiindex(history)]
    provider_retry, _ = download_provider_history(missing, period=period, interval=interval)
    if not provider_retry.empty:
        pieces.append(provider_retry)
        recovered = {
            symbol
            for symbol in missing
            if not close_for_symbol(provider_retry, symbol).empty
        }
        missing = [symbol for symbol in missing if symbol not in recovered]

    for symbol in missing:
        retry = download_yahoo_chart_symbol(symbol, period=period, interval=interval)
        if retry.empty:
            retry = download_with_yfinance([symbol], period=period, interval=interval)
            retry = to_multiindex(retry, symbol)
        if retry.empty:
            retry = download_stooq_history([symbol], period=period, interval=interval)
        if not retry.empty:
            pieces.append(retry)

    combined = pd.concat(pieces, axis=1).sort_index()
    return combined.loc[:, ~combined.columns.duplicated()]


def to_multiindex(history: pd.DataFrame, ticker: str | None = None) -> pd.DataFrame:
    if isinstance(history.columns, pd.MultiIndex):
        return history
    if ticker is None or history.empty:
        return history
    converted = history.copy()
    converted.columns = pd.MultiIndex.from_product(
        [converted.columns, [ticker]],
        names=["Price", "Ticker"],
    )
    return converted


def close_for_symbol(history: pd.DataFrame, ticker: str) -> pd.Series:
    try:
        return field_for(history, ticker, "Close")
    except Exception:
        return pd.Series(dtype="float64")


def field_for(history: pd.DataFrame, ticker: str, field: str) -> pd.Series:
    if isinstance(history.columns, pd.MultiIndex):
        if field in history.columns.get_level_values(0):
            series = history[(field, ticker)]
        else:
            series = history[(ticker, field)]
    else:
        series = history[field]
    return pd.to_numeric(series.dropna(), errors="coerce").dropna()


def close_map(data: MarketData) -> Dict[str, pd.Series]:
    closes: Dict[str, pd.Series] = {}
    for ticker in data.tickers:
        try:
            closes[ticker] = field_for(data.history, ticker, "Close")
        except Exception:
            continue
    return closes


def volume_map(data: MarketData) -> Dict[str, pd.Series]:
    volumes: Dict[str, pd.Series] = {}
    for ticker in data.tickers:
        try:
            volumes[ticker] = field_for(data.history, ticker, "Volume")
        except Exception:
            continue
    return volumes


def latest_prices_from_twelve_data(symbols: list[str], *, api_key: str) -> Dict[str, float]:
    query = urllib.parse.urlencode({"symbol": ",".join(symbols), "apikey": api_key})
    try:
        payload = fetch_json(f"{TWELVE_DATA_URL}/quote?{query}")
    except Exception:
        return {}
    if not isinstance(payload, Mapping):
        return {}
    prices: Dict[str, float] = {}
    for symbol in symbols:
        item = payload.get(symbol, payload if len(symbols) == 1 else None)
        if not isinstance(item, Mapping):
            continue
        try:
            prices[symbol] = float(item.get("close") or item.get("price") or item.get("last") or 0)
        except Exception:
            continue
    return {ticker: price for ticker, price in prices.items() if price > 0}


def latest_prices_from_fmp(symbols: list[str], *, api_key: str) -> Dict[str, float]:
    prices: Dict[str, float] = {}
    for symbol in symbols:
        query = urllib.parse.urlencode({"symbol": symbol, "apikey": api_key})
        try:
            payload = fetch_json(f"{FMP_URL}/quote?{query}")
        except Exception:
            continue
        if not isinstance(payload, list) or not payload:
            continue
        item = payload[0]
        if not isinstance(item, Mapping):
            continue
        try:
            prices[symbol] = float(item.get("price") or item.get("close") or 0)
        except Exception:
            continue
        time.sleep(0.05)
    return {ticker: price for ticker, price in prices.items() if price > 0}


def latest_prices(tickers: Iterable[str]) -> Dict[str, float]:
    symbols = normalize_tickers(tickers)
    keys = load_provider_keys()
    prices: Dict[str, float] = {}
    remaining = list(symbols)
    if keys.twelve_data_api_key and remaining and reserve_provider_budget("TWELVE_DATA", 1).allowed:
        prices.update(latest_prices_from_twelve_data(remaining, api_key=keys.twelve_data_api_key))
        remaining = [symbol for symbol in remaining if symbol not in prices]
    if keys.fmp_api_key and remaining and reserve_provider_budget("FMP", len(remaining)).allowed:
        prices.update(latest_prices_from_fmp(remaining, api_key=keys.fmp_api_key))
        remaining = [symbol for symbol in remaining if symbol not in prices]
    if remaining:
        data = download_history(remaining, period="1d", interval="1m")
        for ticker, close in close_map(data).items():
            if not close.empty:
                prices[ticker] = float(close.iloc[-1])
    return prices


def overlay_latest_closes(data: MarketData, prices: Mapping[str, float]) -> MarketData:
    if not prices:
        return data

    history = data.history.copy()
    if history.empty:
        return data

    last_index = history.index[-1]
    for ticker, price in prices.items():
        try:
            if isinstance(history.columns, pd.MultiIndex):
                if ("Close", ticker) in history.columns:
                    history.loc[last_index, ("Close", ticker)] = price
                elif (ticker, "Close") in history.columns:
                    history.loc[last_index, (ticker, "Close")] = price
            elif len(data.tickers) == 1 and ticker == data.tickers[0] and "Close" in history.columns:
                history.loc[last_index, "Close"] = price
        except Exception:
            continue
    return MarketData(data.tickers, history, data.provenance, data.quality)
