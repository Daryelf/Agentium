from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Mapping, Sequence

import pandas as pd

from ..config import DATA_DIR
from ..data import MarketData, field_for
from .indicators import (
    MOMENTUM_LABELS,
    MOMENTUM_PERIODS,
    acceleration_state,
    annualized_historical_volatility,
    average_daily_range,
    downside_volatility,
    exponential_moving_average,
    finite_number,
    five_day_momentum_segments,
    gap_frequency,
    macd,
    maximum_drawdown,
    momentum_returns,
    period_return,
    relative_performance,
    rolling_standard_deviation,
    safe_ratio,
    simple_moving_average,
    volume_weighted_average_price,
    wilder_atr,
    wilder_rsi,
)
from .models import (
    MomentumMetrics,
    PriceZone,
    QuantFeatureSnapshot,
    RelativeStrengthMetrics,
    TrendMetrics,
    VolatilityMetrics,
    VolumeMetrics,
)


QUANT_REPORT_PATH = DATA_DIR / "quant_features.json"
SMA_PERIODS: tuple[int, ...] = (10, 20, 50, 100, 200)
EMA_PERIODS: tuple[int, ...] = (9, 12, 20, 21, 26, 50, 200)
HARD_DATA_STATUSES = {"DATA_STALE", "DATA_CONFLICT", "DATA_INSUFFICIENT"}


def _series(data: MarketData, symbol: str, field: str) -> pd.Series:
    try:
        return field_for(data.history, symbol, field)
    except Exception:
        return pd.Series(dtype="float64")


def _symbol_frame(data: MarketData, symbol: str) -> pd.DataFrame:
    fields = {name: _series(data, symbol, name) for name in ("Open", "High", "Low", "Close", "Volume")}
    if fields["Close"].empty:
        return pd.DataFrame(columns=tuple(fields))
    frame = pd.concat(fields, axis=1).sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    return frame.dropna(subset=["Close"])


def _iso_timestamp(value: object) -> str | None:
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("UTC")
    else:
        parsed = parsed.tz_convert("UTC")
    return parsed.isoformat()


def _source_status(data: MarketData) -> str:
    quality = data.quality
    if quality is None:
        return "UNKNOWN"
    status = getattr(quality, "analysis_status", None)
    return str(getattr(status, "value", status) or "UNKNOWN")


def _source_provider(data: MarketData) -> str:
    return str(data.provenance.provider if data.provenance else "UNKNOWN")


def _cross_state(close: pd.Series) -> tuple[bool | None, bool | None, bool | None, bool | None]:
    clean = pd.to_numeric(close, errors="coerce").dropna()
    if len(clean) < 200:
        return None, None, None, None
    fast = clean.rolling(50, min_periods=50).mean()
    slow = clean.rolling(200, min_periods=200).mean()
    spread = (fast - slow).dropna()
    if spread.empty:
        return None, None, None, None
    golden_active = bool(spread.iloc[-1] > 0)
    death_active = bool(spread.iloc[-1] < 0)
    changes = pd.DataFrame({"previous": spread.shift(1), "current": spread}).dropna().tail(5)
    recent_golden = bool(((changes["previous"] <= 0) & (changes["current"] > 0)).any())
    recent_death = bool(((changes["previous"] >= 0) & (changes["current"] < 0)).any())
    return golden_active, death_active, recent_golden, recent_death


def _direction(price: float | None, first: float | None, second: float | None, momentum: float | None) -> str:
    if price is None or first is None or second is None or momentum is None:
        return "UNKNOWN"
    if price > first > second and momentum > 0:
        return "BULLISH"
    if price < first < second and momentum < 0:
        return "BEARISH"
    return "NEUTRAL"


def _trend_metrics(close: pd.Series) -> TrendMetrics:
    price = finite_number(close.iloc[-1]) if not close.empty else None
    simple = {f"sma{period}": simple_moving_average(close, period) for period in SMA_PERIODS}
    exponential = {f"ema{period}": exponential_moving_average(close, period) for period in EMA_PERIODS}
    distances: dict[str, float | None] = {}
    for name, value in {**simple, **exponential}.items():
        distances[name] = finite_number(price / value - 1.0) if price is not None and value is not None and value > 0 else None
    short = _direction(price, exponential["ema9"], exponential["ema20"], period_return(close, 5))
    medium = _direction(price, simple["sma20"], simple["sma50"], period_return(close, 20))
    long = _direction(price, simple["sma100"], simple["sma200"], period_return(close, 126))
    if price is None or simple["sma20"] is None or simple["sma50"] is None:
        alignment = "UNKNOWN"
    elif simple["sma200"] is None:
        alignment = "BULLISH_PARTIAL" if price > simple["sma20"] > simple["sma50"] else "BEARISH_PARTIAL" if price < simple["sma20"] < simple["sma50"] else "MIXED"
    elif price > simple["sma20"] > simple["sma50"] > simple["sma200"]:
        alignment = "BULLISH"
    elif price < simple["sma20"] < simple["sma50"] < simple["sma200"]:
        alignment = "BEARISH"
    else:
        alignment = "MIXED"
    golden, death, recent_golden, recent_death = _cross_state(close)
    return TrendMetrics(simple, exponential, distances, short, medium, long, alignment, golden, death, recent_golden, recent_death)


def _momentum_metrics(close: pd.Series) -> MomentumMetrics:
    returns = momentum_returns(close)
    line, signal, histogram = macd(close)
    segments = five_day_momentum_segments(close)
    acceleration, state = acceleration_state(segments)
    return MomentumMetrics(
        rsi14=wilder_rsi(close),
        macd_line=line,
        macd_signal=signal,
        macd_histogram=histogram,
        returns=returns,
        rate_of_change=dict(returns),
        five_day_segments=segments,
        acceleration_5d=acceleration,
        acceleration_state=state,
    )


def _volatility_metrics(frame: pd.DataFrame) -> VolatilityMetrics:
    close = frame["Close"] if "Close" in frame else pd.Series(dtype="float64")
    high = frame["High"] if "High" in frame else pd.Series(dtype="float64")
    low = frame["Low"] if "Low" in frame else pd.Series(dtype="float64")
    open_values = frame["Open"] if "Open" in frame else pd.Series(dtype="float64")
    price = finite_number(close.dropna().iloc[-1]) if not close.dropna().empty else None
    atr14 = wilder_atr(high, low, close)
    adr, adr_pct = average_daily_range(high, low, close)
    return VolatilityMetrics(
        atr14=atr14,
        atr_pct=safe_ratio(atr14, price),
        historical_volatility_20=annualized_historical_volatility(close, 20),
        historical_volatility_60=annualized_historical_volatility(close, 60),
        rolling_std_20=rolling_standard_deviation(close, 20),
        downside_volatility_20=downside_volatility(close, 20),
        maximum_drawdown=maximum_drawdown(close),
        recent_drawdown_63=maximum_drawdown(close, 63),
        gap_frequency_60=gap_frequency(open_values, close, period=60),
        average_daily_range_20=adr,
        average_daily_range_pct_20=adr_pct,
    )


def _volume_metrics(frame: pd.DataFrame) -> VolumeMetrics:
    close = frame.get("Close", pd.Series(dtype="float64"))
    volume = frame.get("Volume", pd.Series(dtype="float64"))
    aligned = pd.concat(
        {
            "close": pd.to_numeric(close, errors="coerce"),
            "volume": pd.to_numeric(volume, errors="coerce"),
        },
        axis=1,
    ).dropna()
    if aligned.empty:
        return VolumeMetrics(None, None, None, None, None, None, None, None, "UNKNOWN", "UNKNOWN", None, "UNKNOWN", None)
    volumes = aligned["volume"]
    current = finite_number(volumes.iloc[-1])
    average20 = finite_number(volumes.tail(20).mean()) if len(volumes) >= 20 else None
    average50 = finite_number(volumes.tail(50).mean()) if len(volumes) >= 50 else None
    relative20 = safe_ratio(current, average20)
    relative50 = safe_ratio(current, average50)
    weighted_price = volume_weighted_average_price(
        frame.get("High", pd.Series(dtype="float64")),
        frame.get("Low", pd.Series(dtype="float64")),
        close,
        volume,
        20,
    )
    trend_ratio = None
    if len(volumes) >= 20:
        trend_ratio = safe_ratio(finite_number(volumes.tail(10).mean()), finite_number(volumes.iloc[-20:-10].mean()))
    acceleration_ratio = None
    if len(volumes) >= 10:
        acceleration_ratio = safe_ratio(finite_number(volumes.tail(5).mean()), finite_number(volumes.iloc[-10:-5].mean()))
    trend = "UNKNOWN" if trend_ratio is None else "RISING" if trend_ratio >= 1.1 else "DECLINING" if trend_ratio <= 0.9 else "STABLE"

    price_change = period_return(aligned["close"], 1)
    if price_change is None or relative20 is None:
        confirmation = "UNKNOWN"
    elif price_change > 0 and relative20 >= 1.0:
        confirmation = "BULLISH_CONFIRMATION"
    elif price_change > 0:
        confirmation = "WEAK_RALLY"
    elif price_change < 0 and relative20 >= 1.0:
        confirmation = "BEARISH_CONFIRMATION"
    elif price_change < 0:
        confirmation = "WEAK_DECLINE"
    else:
        confirmation = "NEUTRAL"

    recent = aligned.tail(20).copy()
    changes = recent["close"].diff()
    up_volume = float(recent.loc[changes > 0, "volume"].sum())
    down_volume = float(recent.loc[changes < 0, "volume"].sum())
    directional_volume = up_volume + down_volume
    balance = finite_number((up_volume - down_volume) / directional_volume) if directional_volume > 0 else None
    accumulation_state = "UNKNOWN" if balance is None else "ACCUMULATION" if balance >= 0.15 else "DISTRIBUTION" if balance <= -0.15 else "BALANCED"
    abnormal = bool(relative20 >= 1.8) if relative20 is not None else None
    return VolumeMetrics(current, average20, average50, relative20, relative50, weighted_price, trend_ratio, acceleration_ratio, trend, confirmation, balance, accumulation_state, abnormal)


def _relative_strength_metrics(data: MarketData, symbol: str, close: pd.Series, sector_etf: str | None) -> RelativeStrengthMetrics:
    returns = momentum_returns(close)

    def versus(benchmark_symbol: str | None) -> dict[str, float | None]:
        benchmark = _series(data, benchmark_symbol, "Close") if benchmark_symbol else pd.Series(dtype="float64")
        return {
            MOMENTUM_LABELS[period]: relative_performance(close, benchmark, period)
            for period in MOMENTUM_PERIODS
        }

    return RelativeStrengthMetrics(
        returns=returns,
        versus_spy=versus("SPY"),
        versus_qqq=versus("QQQ"),
        sector_etf=sector_etf,
        versus_sector=versus(sector_etf),
    )


def _swing_candidates(frame: pd.DataFrame, field: str, mode: str) -> list[tuple[float, str, int]]:
    values = pd.to_numeric(frame[field], errors="coerce").dropna().tail(90)
    candidates: list[tuple[float, str, int]] = []
    if len(values) < 5:
        return candidates
    for index in range(2, len(values) - 2):
        window = values.iloc[index - 2:index + 3]
        value = float(values.iloc[index])
        if mode == "low" and value <= float(window.min()):
            candidates.append((value, "swing_low", 1))
        elif mode == "high" and value >= float(window.max()):
            candidates.append((value, "swing_high", 1))
    return candidates[-6:]


def _cluster_zones(
    candidates: list[tuple[float, str, int]],
    *,
    price: float,
    atr14: float | None,
    side: str,
) -> tuple[PriceZone, ...]:
    if not candidates or price <= 0:
        return ()
    tolerance = max((atr14 or 0.0) * 0.5, price * 0.005)
    half_width = max((atr14 or 0.0) * 0.2, price * 0.0025)
    clusters: list[list[tuple[float, str, int]]] = []
    for candidate in sorted(candidates, key=lambda item: item[0]):
        if not clusters:
            clusters.append([candidate])
            continue
        midpoint = sum(item[0] for item in clusters[-1]) / len(clusters[-1])
        if abs(candidate[0] - midpoint) <= tolerance:
            clusters[-1].append(candidate)
        else:
            clusters.append([candidate])
    zones: list[PriceZone] = []
    for cluster in clusters:
        levels = [item[0] for item in cluster]
        midpoint = sum(levels) / len(levels)
        if side == "support" and midpoint > price:
            continue
        if side == "resistance" and midpoint < price:
            continue
        zones.append(PriceZone(
            lower=round(min(levels) - half_width, 4),
            upper=round(max(levels) + half_width, 4),
            midpoint=round(midpoint, 4),
            sources=tuple(sorted({item[1] for item in cluster})),
            touches=sum(item[2] for item in cluster),
            distance_pct=round(midpoint / price - 1.0, 6),
        ))
    zones.sort(key=lambda zone: abs(zone.distance_pct))
    return tuple(zones[:3])


def _price_zones(frame: pd.DataFrame, trend: TrendMetrics, atr14: float | None) -> tuple[tuple[PriceZone, ...], tuple[PriceZone, ...]]:
    close = pd.to_numeric(frame.get("Close", pd.Series(dtype="float64")), errors="coerce").dropna()
    if close.empty:
        return (), ()
    price = float(close.iloc[-1])
    generic: list[tuple[float, str, int]] = []
    for period in (20, 50):
        if len(frame) >= period:
            lows = pd.to_numeric(frame["Low"], errors="coerce").dropna().tail(period)
            highs = pd.to_numeric(frame["High"], errors="coerce").dropna().tail(period)
            if len(lows) >= period:
                generic.append((float(lows.min()), f"rolling_low_{period}", 1))
            if len(highs) >= period:
                generic.append((float(highs.max()), f"rolling_high_{period}", 1))
    generic.extend(_swing_candidates(frame, "Low", "low"))
    generic.extend(_swing_candidates(frame, "High", "high"))
    for name, value in trend.simple_moving_averages.items():
        if value is not None:
            generic.append((value, name, 1))
    for name in ("ema20", "ema50", "ema200"):
        value = trend.exponential_moving_averages.get(name)
        if value is not None:
            generic.append((value, name, 1))

    recent = frame.tail(60).dropna(subset=["Close", "Volume"])
    if len(recent) >= 20 and float(recent["Volume"].sum()) > 0:
        cutoff = float(recent["Volume"].quantile(0.8))
        high_volume = recent.loc[recent["Volume"] >= cutoff, "Close"]
        if not high_volume.empty:
            generic.append((float(high_volume.median()), "high_volume_close_zone", len(high_volume)))

    support_candidates = [item for item in generic if item[0] <= price]
    resistance_candidates = [item for item in generic if item[0] >= price]
    return (
        _cluster_zones(support_candidates, price=price, atr14=atr14, side="support"),
        _cluster_zones(resistance_candidates, price=price, atr14=atr14, side="resistance"),
    )


def _feature_status(source_status: str, bars: int, benchmark_coverage: bool) -> str:
    if source_status in HARD_DATA_STATUSES:
        return source_status
    if bars < 20:
        return "DATA_INSUFFICIENT"
    if source_status in {"UNKNOWN", "DATA_PARTIAL"} or bars < 253 or not benchmark_coverage:
        return "DATA_PARTIAL"
    return "DATA_OK"


def build_quant_snapshot(
    data: MarketData,
    symbol: str,
    *,
    sector_etf: str | None = None,
    generated_at: datetime | None = None,
) -> QuantFeatureSnapshot:
    normalized_symbol = str(symbol).strip().upper()
    normalized_sector = str(sector_etf).strip().upper() if sector_etf else None
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    frame = _symbol_frame(data, normalized_symbol)
    close = pd.to_numeric(frame.get("Close", pd.Series(dtype="float64")), errors="coerce").dropna()
    bars = len(close)
    price = finite_number(close.iloc[-1]) if not close.empty else None
    source_status = _source_status(data)
    trend = _trend_metrics(close)
    momentum = _momentum_metrics(close)
    volatility = _volatility_metrics(frame)
    volume_metrics = _volume_metrics(frame)
    relative_strength = _relative_strength_metrics(data, normalized_symbol, close, normalized_sector)
    support, resistance = _price_zones(frame, trend, volatility.atr14)

    warnings: list[str] = []
    if bars < 20:
        warnings.append("INSUFFICIENT_HISTORY_20")
    if bars < 50:
        warnings.append("VOLUME_50_AND_MEDIUM_TREND_UNAVAILABLE")
    if bars < 200:
        warnings.append("LONG_TERM_MOVING_AVERAGES_UNAVAILABLE")
    if bars < 253:
        warnings.append("TWELVE_MONTH_MOMENTUM_UNAVAILABLE")
    spy_available = not _series(data, "SPY", "Close").empty
    qqq_available = not _series(data, "QQQ", "Close").empty
    if not spy_available:
        warnings.append("SPY_RELATIVE_STRENGTH_UNAVAILABLE")
    if not qqq_available:
        warnings.append("QQQ_RELATIVE_STRENGTH_UNAVAILABLE")
    if normalized_sector and _series(data, normalized_sector, "Close").empty:
        warnings.append("SECTOR_RELATIVE_STRENGTH_UNAVAILABLE")
    if frame.empty or any(frame.get(name, pd.Series(dtype="float64")).dropna().empty for name in ("Open", "High", "Low", "Volume")):
        warnings.append("OHLCV_FIELDS_INCOMPLETE")
    if data.quality is not None:
        dependencies = {normalized_symbol, "SPY", "QQQ"}
        if normalized_sector:
            dependencies.add(normalized_sector)
        warnings.extend(
            f"SOURCE_{issue.code}"
            for issue in data.quality.issues
            if issue.symbol is None or str(issue.symbol).upper() in dependencies
        )

    return QuantFeatureSnapshot(
        version=2,
        symbol=normalized_symbol,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        as_of=_iso_timestamp(close.index[-1]) if not close.empty else None,
        bars=bars,
        price=price,
        feature_status=_feature_status(source_status, bars, spy_available and qqq_available),
        source_data_status=source_status,
        source_provider=_source_provider(data),
        source_quality_score=data.quality.score if data.quality else None,
        source_updated_at=data.provenance.source_timestamp if data.provenance else None,
        trend=trend,
        momentum=momentum,
        volatility=volatility,
        volume=volume_metrics,
        relative_strength=relative_strength,
        support_zones=support,
        resistance_zones=resistance,
        warnings=tuple(dict.fromkeys(warnings)),
    )


def build_quant_snapshots(
    data: MarketData,
    symbols: Sequence[str],
    *,
    sectors_by_symbol: Mapping[str, str] | None = None,
    generated_at: datetime | None = None,
) -> dict[str, QuantFeatureSnapshot]:
    at = generated_at or datetime.now(timezone.utc)
    sector_map = {str(key).upper(): str(value).upper() for key, value in (sectors_by_symbol or {}).items()}
    return {
        str(symbol).upper(): build_quant_snapshot(data, str(symbol), sector_etf=sector_map.get(str(symbol).upper()), generated_at=at)
        for symbol in dict.fromkeys(str(item).upper() for item in symbols if str(item).strip())
    }


def write_quant_report(snapshots: Mapping[str, QuantFeatureSnapshot], path: Path = QUANT_REPORT_PATH) -> Path:
    payload = {
        "version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "symbols": len(snapshots),
            "by_status": {
                status: sum(1 for snapshot in snapshots.values() if snapshot.feature_status == status)
                for status in sorted({snapshot.feature_status for snapshot in snapshots.values()})
            },
        },
        "symbols": {symbol: asdict(snapshot) for symbol, snapshot in sorted(snapshots.items())},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n")
    return path
