from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import io
import os
from pathlib import Path
import time
from typing import Dict, Iterable, Mapping
import urllib.error
import urllib.parse
import urllib.request
import warnings
from contextlib import redirect_stderr, redirect_stdout

import pandas as pd
from urllib3.exceptions import NotOpenSSLWarning
import yfinance as yf

from .config import DATA_DIR, PROVIDER_KEYS_PATH, normalize_tickers


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
TWELVE_DATA_URL = "https://api.twelvedata.com"
FMP_URL = "https://financialmodelingprep.com/stable"
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"


@dataclass(frozen=True)
class MarketData:
    tickers: list[str]
    history: pd.DataFrame


@dataclass(frozen=True)
class ProviderKeys:
    twelve_data_api_key: str = ""
    fmp_api_key: str = ""
    alpha_vantage_api_key: str = ""

    @property
    def has_any(self) -> bool:
        return bool(self.twelve_data_api_key or self.fmp_api_key or self.alpha_vantage_api_key)


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


def save_history_cache(
    history: pd.DataFrame,
    symbols: list[str],
    *,
    period: str,
    interval: str,
    cache_dir: Path | None = None,
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
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


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
        return pd.DataFrame()
    try:
        meta = json.loads(meta_path.read_text())
        cached_at = datetime.fromisoformat(meta["cached_at"])
        if cached_at.tzinfo is None:
            cached_at = cached_at.replace(tzinfo=timezone.utc)
    except Exception:
        return pd.DataFrame()
    age_seconds = (datetime.now(timezone.utc) - cached_at).total_seconds()
    if max_age_seconds is not None and age_seconds > max_age_seconds:
        return pd.DataFrame()
    try:
        history = pd.read_pickle(cache_path)
    except Exception:
        return pd.DataFrame()
    return history if isinstance(history, pd.DataFrame) else pd.DataFrame()


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
            parsed_rows.append(
                {
                    "Open": float(item.get("open", 0) or 0),
                    "High": float(item.get("high", 0) or 0),
                    "Low": float(item.get("low", 0) or 0),
                    "Close": float(item.get("close", 0) or 0),
                    "Volume": float(item.get("volume", 0) or 0),
                }
            )
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


def download_provider_history(symbols: list[str], *, period: str, interval: str) -> tuple[pd.DataFrame, list[str]]:
    keys = load_provider_keys()
    errors: list[str] = []
    if keys.twelve_data_api_key:
        history = download_twelve_data_history(symbols, period=period, interval=interval, api_key=keys.twelve_data_api_key)
        if not history.empty:
            return history, errors
        errors.append("Twelve Data returned no data")
    if keys.fmp_api_key:
        history = download_fmp_history(symbols, period=period, interval=interval, api_key=keys.fmp_api_key)
        if not history.empty:
            return history, errors
        errors.append("FMP returned no data")
    if keys.alpha_vantage_api_key and len(symbols) <= 5:
        history = download_alpha_vantage_history(symbols, period=period, interval=interval, api_key=keys.alpha_vantage_api_key)
        if not history.empty:
            return history, errors
        errors.append("Alpha Vantage returned no data")
    return pd.DataFrame(), errors


def download_history(
    tickers: Iterable[str],
    period: str = "6mo",
    interval: str = "1d",
    *,
    prefer_cache: bool = False,
    cache_max_age_seconds: int | None = None,
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
            return MarketData(symbols, cached)

    source_errors: list[str] = []
    history = pd.DataFrame()
    provider_errors: list[str] = []
    if supports_provider_history(interval):
        history, provider_errors = download_provider_history(symbols, period=period, interval=interval)
        source_errors.extend(provider_errors)

    if history.empty:
        history = download_yahoo_chart_history(symbols, period=period, interval=interval)
        if history.empty:
            source_errors.append("Yahoo chart returned no data after retries")
    if history.empty:
        history = download_with_yfinance(symbols, period=period, interval=interval)
        if history.empty:
            source_errors.append("yfinance fallback returned no data")
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
    history = retry_missing_symbols(history, symbols, period, interval)
    save_history_cache(history, symbols, period=period, interval=interval)
    return MarketData(symbols, history)


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
    fields = {
        "Open": quote.get("open", []),
        "High": quote.get("high", []),
        "Low": quote.get("low", []),
        "Close": quote.get("close", []),
        "Volume": quote.get("volume", []),
    }
    adjclose = indicators.get("adjclose")
    if isinstance(adjclose, list) and adjclose:
        adjusted = adjclose[0]
        if isinstance(adjusted, Mapping) and adjusted.get("adjclose"):
            fields["Close"] = adjusted["adjclose"]

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
    if keys.twelve_data_api_key and symbols:
        prices = latest_prices_from_twelve_data(symbols, api_key=keys.twelve_data_api_key)
        if prices:
            return prices
    if keys.fmp_api_key and symbols:
        prices = latest_prices_from_fmp(symbols, api_key=keys.fmp_api_key)
        if prices:
            return prices
    data = download_history(tickers, period="1d", interval="1m")
    prices: Dict[str, float] = {}
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
    return MarketData(data.tickers, history)
