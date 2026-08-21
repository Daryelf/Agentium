from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

import pandas as pd

from .config import DATA_DIR
from .data import MarketData, field_for
from .evaluator import QuoteSnapshot


INTRADAY_CONTEXT_PATH = DATA_DIR / "intraday_context.json"
TIMEFRAME_RULES = {
    "1m": None,
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
}


@dataclass(frozen=True)
class TimeframeMetrics:
    timeframe: str
    bars: int
    as_of: str | None
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float
    vwap: float | None
    ema9: float | None
    ema20: float | None
    atr14: float | None
    realized_volatility: float | None
    direction: str
    above_vwap: bool | None


@dataclass(frozen=True)
class MultiTimeframeContext:
    symbol: str
    generated_at: str
    source_provider: str
    source_timestamp: str | None
    data_health_state: str
    data_quality_score: int | None
    usable: bool
    last_price: float | None
    bid: float | None
    ask: float | None
    spread_pct: float | None
    session_open: float | None
    session_high: float | None
    session_low: float | None
    session_volume: float
    session_phase: str
    premarket_high: float | None
    premarket_low: float | None
    premarket_volume: float
    regular_high: float | None
    regular_low: float | None
    regular_volume: float
    after_hours_high: float | None
    after_hours_low: float | None
    after_hours_volume: float
    opening_range_high: float | None
    opening_range_low: float | None
    previous_close: float | None
    gap_pct: float | None
    session_vwap: float | None
    vwap_distance_pct: float | None
    expected_volume: float | None
    relative_volume: float | None
    dollar_volume: float | None
    alignment: str
    conflicts: tuple[str, ...]
    timeframes: Mapping[str, TimeframeMetrics]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _symbol_frame(data: MarketData, symbol: str) -> pd.DataFrame:
    fields: dict[str, pd.Series] = {}
    for name in ("Open", "High", "Low", "Close", "Volume"):
        try:
            fields[name] = field_for(data.history, symbol, name)
        except Exception:
            return pd.DataFrame()
    frame = pd.concat(fields, axis=1).dropna(subset=["Close"])
    if not isinstance(frame.index, pd.DatetimeIndex):
        return pd.DataFrame()
    index = frame.index
    if index.tz is None:
        index = index.tz_localize("UTC")
    else:
        index = index.tz_convert("UTC")
    frame.index = index
    return frame.sort_index()


def _session_frame(frame: pd.DataFrame, now: datetime) -> pd.DataFrame:
    if frame.empty:
        return frame
    eastern = ZoneInfo("America/New_York")
    local_index = frame.index.tz_convert(eastern)
    target_day = now.astimezone(eastern).date()
    selected = frame[local_index.date == target_day]
    if selected.empty:
        # Outside a current session, expose the last observed session instead of inventing bars.
        last_day = local_index[-1].date()
        selected = frame[local_index.date == last_day]
    return selected


def _resample(frame: pd.DataFrame, rule: str | None) -> pd.DataFrame:
    if frame.empty or rule is None:
        return frame.copy()
    return frame.resample(rule, label="right", closed="right").agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna(subset=["Close"])


def _safe_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if pd.notna(number) else None


def _vwap(frame: pd.DataFrame) -> float | None:
    if frame.empty:
        return None
    volume = pd.to_numeric(frame["Volume"], errors="coerce").fillna(0.0)
    total = float(volume.sum())
    if total <= 0:
        return None
    typical = (frame["High"] + frame["Low"] + frame["Close"]) / 3
    return _safe_number((typical * volume).sum() / total)


def _atr(frame: pd.DataFrame, period: int = 14) -> float | None:
    if len(frame) < 2:
        return None
    previous = frame["Close"].shift(1)
    ranges = pd.concat([
        frame["High"] - frame["Low"],
        (frame["High"] - previous).abs(),
        (frame["Low"] - previous).abs(),
    ], axis=1).max(axis=1).dropna()
    return _safe_number(ranges.tail(period).mean()) if not ranges.empty else None


def _direction(close: pd.Series) -> str:
    clean = pd.to_numeric(close, errors="coerce").dropna()
    if len(clean) < 3:
        return "UNKNOWN"
    ema9 = clean.ewm(span=9, adjust=False).mean().iloc[-1]
    ema20 = clean.ewm(span=20, adjust=False).mean().iloc[-1]
    latest = clean.iloc[-1]
    if latest > ema9 > ema20:
        return "BULLISH"
    if latest < ema9 < ema20:
        return "BEARISH"
    return "MIXED"


def timeframe_metrics(frame: pd.DataFrame, timeframe: str) -> TimeframeMetrics:
    if frame.empty:
        return TimeframeMetrics(timeframe, 0, None, None, None, None, None, 0.0, None, None, None, None, None, "UNKNOWN", None)
    close = pd.to_numeric(frame["Close"], errors="coerce").dropna()
    returns = close.pct_change().dropna()
    vwap = _vwap(frame)
    latest = _safe_number(close.iloc[-1]) if not close.empty else None
    ema9 = _safe_number(close.ewm(span=9, adjust=False).mean().iloc[-1]) if not close.empty else None
    ema20 = _safe_number(close.ewm(span=20, adjust=False).mean().iloc[-1]) if not close.empty else None
    as_of = frame.index[-1].isoformat() if isinstance(frame.index, pd.DatetimeIndex) else None
    return TimeframeMetrics(
        timeframe=timeframe,
        bars=len(frame),
        as_of=as_of,
        open=_safe_number(frame["Open"].dropna().iloc[0]) if not frame["Open"].dropna().empty else None,
        high=_safe_number(frame["High"].max()),
        low=_safe_number(frame["Low"].min()),
        close=latest,
        volume=float(pd.to_numeric(frame["Volume"], errors="coerce").fillna(0.0).sum()),
        vwap=vwap,
        ema9=ema9,
        ema20=ema20,
        atr14=_atr(frame),
        realized_volatility=_safe_number(returns.tail(30).std()) if len(returns) >= 2 else None,
        direction=_direction(close),
        above_vwap=(latest > vwap) if latest is not None and vwap is not None else None,
    )


def _daily_fields(daily_data: MarketData | None, symbol: str) -> tuple[float | None, float | None]:
    if daily_data is None:
        return None, None
    try:
        closes = field_for(daily_data.history, symbol, "Close")
        volumes = field_for(daily_data.history, symbol, "Volume")
    except Exception:
        return None, None
    previous_close = _safe_number(closes.iloc[-2]) if len(closes) >= 2 else None
    average_volume = _safe_number(volumes.tail(20).mean()) if not volumes.empty else None
    return previous_close, average_volume


def _expected_volume(average_daily_volume: float | None, now: datetime) -> float | None:
    if average_daily_volume is None or average_daily_volume <= 0:
        return None
    local = now.astimezone(ZoneInfo("America/New_York"))
    local_minutes = local.hour * 60 + local.minute
    if local_minutes < 9 * 60 + 30:
        # Premarket liquidity follows a different curve. Do not compare it with a fabricated
        # regular-session fraction when no verified premarket baseline is available.
        return None
    elapsed = local_minutes - (9 * 60 + 30)
    fraction = min(1.0, max(0.05, elapsed / 390))
    return average_daily_volume * fraction


def _market_phase(now: datetime) -> str:
    local = now.astimezone(ZoneInfo("America/New_York"))
    if local.weekday() >= 5:
        return "WEEKEND"
    minutes = local.hour * 60 + local.minute
    if 4 * 60 <= minutes < 9 * 60 + 30:
        return "PREMARKET"
    if 9 * 60 + 30 <= minutes < 16 * 60:
        return "REGULAR"
    if 16 * 60 <= minutes < 20 * 60:
        return "AFTER_HOURS"
    return "CLOSED"


def _window(frame: pd.DataFrame, start_minute: int, end_minute: int) -> pd.DataFrame:
    if frame.empty:
        return frame
    local = frame.index.tz_convert(ZoneInfo("America/New_York"))
    minutes = local.hour * 60 + local.minute
    return frame[(minutes >= start_minute) & (minutes < end_minute)]


def _window_extremes(frame: pd.DataFrame) -> tuple[float | None, float | None, float]:
    if frame.empty:
        return None, None, 0.0
    return (
        _safe_number(pd.to_numeric(frame["High"], errors="coerce").max()),
        _safe_number(pd.to_numeric(frame["Low"], errors="coerce").min()),
        float(pd.to_numeric(frame["Volume"], errors="coerce").fillna(0.0).sum()),
    )


def build_multi_timeframe_context(
    intraday_data: MarketData,
    symbol: str,
    *,
    now: datetime | None = None,
    quote: QuoteSnapshot | None = None,
    daily_data: MarketData | None = None,
) -> MultiTimeframeContext:
    observed_at = now or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    frame = _symbol_frame(intraday_data, symbol)
    session = _session_frame(frame, observed_at)
    metrics = {name: timeframe_metrics(_resample(session, rule), name) for name, rule in TIMEFRAME_RULES.items()}
    if daily_data is not None:
        daily_frame = _symbol_frame(daily_data, symbol)
        metrics["1d"] = timeframe_metrics(daily_frame.tail(260), "1d")

    one_minute = metrics["1m"]
    premarket_high, premarket_low, premarket_volume = _window_extremes(_window(session, 4 * 60, 9 * 60 + 30))
    regular_high, regular_low, regular_volume = _window_extremes(_window(session, 9 * 60 + 30, 16 * 60))
    after_hours_high, after_hours_low, after_hours_volume = _window_extremes(_window(session, 16 * 60, 20 * 60))
    opening_range_high, opening_range_low, _opening_range_volume = _window_extremes(_window(session, 9 * 60 + 30, 9 * 60 + 45))
    last_price = quote.last if quote and quote.last and quote.last > 0 else one_minute.close
    bid = quote.bid if quote and quote.bid and quote.bid > 0 else None
    ask = quote.ask if quote and quote.ask and quote.ask > 0 else None
    spread = ((ask - bid) / last_price) if bid is not None and ask is not None and last_price and ask >= bid else None
    previous_close, average_daily_volume = _daily_fields(daily_data, symbol)
    expected_volume = _expected_volume(average_daily_volume, observed_at)
    relative_volume = (one_minute.volume / expected_volume) if expected_volume and expected_volume > 0 else None
    gap = ((one_minute.open / previous_close) - 1) if one_minute.open and previous_close else None
    vwap_distance = ((last_price / one_minute.vwap) - 1) if last_price and one_minute.vwap else None
    directions = {name: item.direction for name, item in metrics.items() if name in {"1m", "5m", "15m", "1h", "1d"} and item.direction != "UNKNOWN"}
    bullish = [name for name, direction in directions.items() if direction == "BULLISH"]
    bearish = [name for name, direction in directions.items() if direction == "BEARISH"]
    conflicts: list[str] = []
    if bullish and bearish:
        conflicts.append(f"Bullish on {', '.join(bullish)} but bearish on {', '.join(bearish)}.")
    if one_minute.above_vwap is False:
        conflicts.append("Last price is below session VWAP.")
    alignment = "CONFLICT" if bullish and bearish else "BULLISH" if bullish and len(bullish) >= max(2, len(directions) - 1) else "BEARISH" if bearish and len(bearish) >= max(2, len(directions) - 1) else "MIXED"
    quality = intraday_data.quality
    usable = bool(not frame.empty and (quality is None or quality.is_usable))
    if quote is not None and not quote.data_fresh:
        usable = False
        conflicts.append("Broker quote is stale.")
    provenance = intraday_data.provenance
    return MultiTimeframeContext(
        symbol=symbol.upper(),
        generated_at=observed_at.isoformat(),
        source_provider=provenance.provider if provenance else "UNKNOWN",
        source_timestamp=provenance.source_timestamp if provenance else one_minute.as_of,
        data_health_state=quality.state.value if quality else "UNKNOWN",
        data_quality_score=quality.score if quality else None,
        usable=usable,
        last_price=_safe_number(last_price),
        bid=_safe_number(bid),
        ask=_safe_number(ask),
        spread_pct=_safe_number(spread),
        session_open=one_minute.open,
        session_high=one_minute.high,
        session_low=one_minute.low,
        session_volume=one_minute.volume,
        session_phase=_market_phase(observed_at),
        premarket_high=premarket_high,
        premarket_low=premarket_low,
        premarket_volume=premarket_volume,
        regular_high=regular_high,
        regular_low=regular_low,
        regular_volume=regular_volume,
        after_hours_high=after_hours_high,
        after_hours_low=after_hours_low,
        after_hours_volume=after_hours_volume,
        opening_range_high=opening_range_high,
        opening_range_low=opening_range_low,
        previous_close=previous_close,
        gap_pct=_safe_number(gap),
        session_vwap=one_minute.vwap,
        vwap_distance_pct=_safe_number(vwap_distance),
        expected_volume=_safe_number(expected_volume),
        relative_volume=_safe_number(relative_volume),
        dollar_volume=_safe_number(one_minute.volume * last_price) if last_price else None,
        alignment=alignment,
        conflicts=tuple(dict.fromkeys(conflicts)),
        timeframes=metrics,
    )


def build_multi_timeframe_contexts(
    intraday_data: MarketData,
    symbols: Sequence[str],
    *,
    now: datetime | None = None,
    quotes: Mapping[str, QuoteSnapshot] | None = None,
    daily_data: MarketData | None = None,
) -> dict[str, MultiTimeframeContext]:
    return {
        symbol: build_multi_timeframe_context(intraday_data, symbol, now=now, quote=(quotes or {}).get(symbol), daily_data=daily_data)
        for symbol in symbols
    }


def write_intraday_context_report(
    contexts: Mapping[str, MultiTimeframeContext],
    path: Path = INTRADAY_CONTEXT_PATH,
) -> Path:
    generated_at = max((item.generated_at for item in contexts.values()), default=datetime.now(timezone.utc).isoformat())
    payload = {
        "version": 1,
        "generated_at": generated_at,
        "symbols": {symbol: context.to_dict() for symbol, context in sorted(contexts.items())},
        "summary": {
            "symbols": len(contexts),
            "usable": sum(item.usable for item in contexts.values()),
            "bullish": sum(item.alignment == "BULLISH" for item in contexts.values()),
            "conflicts": sum(bool(item.conflicts) for item in contexts.values()),
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path
