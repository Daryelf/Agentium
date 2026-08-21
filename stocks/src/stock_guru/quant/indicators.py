from __future__ import annotations

import math
from typing import Iterable

import pandas as pd


TRADING_DAYS_PER_YEAR = 252
MOMENTUM_PERIODS: tuple[int, ...] = (1, 5, 10, 20, 63, 126, 252)
MOMENTUM_LABELS = {
    1: "1d",
    5: "5d",
    10: "10d",
    20: "20d",
    63: "3m",
    126: "6m",
    252: "12m",
}


def clean_series(values: pd.Series) -> pd.Series:
    return pd.to_numeric(values, errors="coerce").dropna().astype(float)


def finite_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return finite_number(numerator / denominator)


def simple_moving_average(values: pd.Series, period: int) -> float | None:
    clean = clean_series(values)
    if period <= 0 or len(clean) < period:
        return None
    return finite_number(clean.tail(period).mean())


def exponential_moving_average_series(values: pd.Series, period: int) -> pd.Series:
    clean = clean_series(values)
    if period <= 0 or len(clean) < period:
        return pd.Series(dtype="float64")
    return clean.ewm(span=period, adjust=False, min_periods=period).mean().dropna()


def exponential_moving_average(values: pd.Series, period: int) -> float | None:
    result = exponential_moving_average_series(values, period)
    return finite_number(result.iloc[-1]) if not result.empty else None


def period_return(values: pd.Series, periods: int) -> float | None:
    clean = clean_series(values)
    if periods <= 0 or len(clean) <= periods:
        return None
    start = finite_number(clean.iloc[-periods - 1])
    end = finite_number(clean.iloc[-1])
    if start is None or end is None or start <= 0:
        return None
    return finite_number(end / start - 1.0)


def momentum_returns(values: pd.Series) -> dict[str, float | None]:
    return {MOMENTUM_LABELS[period]: period_return(values, period) for period in MOMENTUM_PERIODS}


def wilder_rsi(values: pd.Series, period: int = 14) -> float | None:
    close = clean_series(values)
    if period <= 0 or len(close) <= period:
        return None
    delta = close.diff().dropna()
    gains = delta.clip(lower=0.0)
    losses = -delta.clip(upper=0.0)
    average_gain = float(gains.iloc[:period].mean())
    average_loss = float(losses.iloc[:period].mean())
    for index in range(period, len(delta)):
        average_gain = ((period - 1) * average_gain + float(gains.iloc[index])) / period
        average_loss = ((period - 1) * average_loss + float(losses.iloc[index])) / period
    if average_gain == 0 and average_loss == 0:
        return 50.0
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return finite_number(100.0 - (100.0 / (1.0 + relative_strength)))


def macd(values: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[float | None, float | None, float | None]:
    close = clean_series(values)
    if min(fast, slow, signal) <= 0 or fast >= slow or len(close) < slow + signal - 1:
        return None, None, None
    fast_line = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    slow_line = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd_line = (fast_line - slow_line).dropna()
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean().dropna()
    if signal_line.empty:
        return None, None, None
    latest_signal = finite_number(signal_line.iloc[-1])
    latest_macd = finite_number(macd_line.loc[signal_line.index[-1]])
    histogram = finite_number(latest_macd - latest_signal) if latest_macd is not None and latest_signal is not None else None
    return latest_macd, latest_signal, histogram


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    frame = pd.concat(
        {
            "high": pd.to_numeric(high, errors="coerce"),
            "low": pd.to_numeric(low, errors="coerce"),
            "close": pd.to_numeric(close, errors="coerce"),
        },
        axis=1,
    ).dropna()
    if frame.empty:
        return pd.Series(dtype="float64")
    previous_close = frame["close"].shift(1)
    ranges = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous_close).abs(),
            (frame["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return clean_series(ranges)


def wilder_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float | None:
    ranges = true_range(high, low, close)
    if period <= 0 or len(ranges) < period:
        return None
    value = float(ranges.iloc[:period].mean())
    for item in ranges.iloc[period:]:
        value = ((period - 1) * value + float(item)) / period
    return finite_number(value)


def annualized_historical_volatility(values: pd.Series, period: int) -> float | None:
    returns = clean_series(values).pct_change().dropna()
    if period <= 1 or len(returns) < period:
        return None
    return finite_number(returns.tail(period).std(ddof=1) * math.sqrt(TRADING_DAYS_PER_YEAR))


def rolling_standard_deviation(values: pd.Series, period: int = 20) -> float | None:
    returns = clean_series(values).pct_change().dropna()
    if period <= 1 or len(returns) < period:
        return None
    return finite_number(returns.tail(period).std(ddof=1))


def downside_volatility(values: pd.Series, period: int = 20) -> float | None:
    returns = clean_series(values).pct_change().dropna()
    if period <= 1 or len(returns) < period:
        return None
    downside = returns.tail(period).clip(upper=0.0)
    return finite_number(math.sqrt(float((downside.pow(2)).mean())) * math.sqrt(TRADING_DAYS_PER_YEAR))


def maximum_drawdown(values: pd.Series, period: int | None = None) -> float | None:
    close = clean_series(values)
    if period is not None:
        close = close.tail(period)
    if len(close) < 2 or bool((close <= 0).any()):
        return None
    running_peak = close.cummax()
    drawdowns = close / running_peak - 1.0
    return finite_number(drawdowns.min())


def gap_frequency(open_values: pd.Series, close_values: pd.Series, *, period: int = 60, threshold_pct: float = 0.02) -> float | None:
    frame = pd.concat(
        {
            "open": pd.to_numeric(open_values, errors="coerce"),
            "close": pd.to_numeric(close_values, errors="coerce"),
        },
        axis=1,
    ).dropna()
    if len(frame) < 2:
        return None
    gaps = (frame["open"] / frame["close"].shift(1) - 1.0).dropna().tail(period)
    if gaps.empty:
        return None
    return finite_number(float((gaps.abs() >= threshold_pct).mean()))


def average_daily_range(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 20) -> tuple[float | None, float | None]:
    frame = pd.concat(
        {
            "high": pd.to_numeric(high, errors="coerce"),
            "low": pd.to_numeric(low, errors="coerce"),
            "close": pd.to_numeric(close, errors="coerce"),
        },
        axis=1,
    ).dropna()
    if len(frame) < period:
        return None, None
    tail = frame.tail(period)
    absolute = finite_number((tail["high"] - tail["low"]).mean())
    percentages = (tail["high"] - tail["low"]) / tail["close"].where(tail["close"] > 0)
    return absolute, finite_number(percentages.mean())


def volume_weighted_average_price(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
    period: int = 20,
) -> float | None:
    frame = pd.concat(
        {
            "high": pd.to_numeric(high, errors="coerce"),
            "low": pd.to_numeric(low, errors="coerce"),
            "close": pd.to_numeric(close, errors="coerce"),
            "volume": pd.to_numeric(volume, errors="coerce"),
        },
        axis=1,
    ).dropna()
    if period <= 0 or len(frame) < period:
        return None
    tail = frame.tail(period)
    total_volume = float(tail["volume"].sum())
    if total_volume <= 0:
        return None
    typical_price = (tail["high"] + tail["low"] + tail["close"]) / 3.0
    return finite_number((typical_price * tail["volume"]).sum() / total_volume)


def five_day_momentum_segments(values: pd.Series) -> tuple[float, ...]:
    close = clean_series(values)
    if len(close) < 16:
        return ()
    segments: list[float] = []
    for start, end in ((-16, -11), (-11, -6), (-6, -1)):
        first = float(close.iloc[start])
        last = float(close.iloc[end])
        if first <= 0:
            return ()
        segments.append(last / first - 1.0)
    return tuple(segments)


def acceleration_state(segments: Iterable[float]) -> tuple[float | None, str]:
    values = tuple(float(value) for value in segments)
    if len(values) != 3:
        return None, "UNKNOWN"
    older, prior, recent = values
    acceleration = finite_number(recent - prior)
    if recent > prior > older:
        state = "ACCELERATING"
    elif recent < prior < older:
        state = "FADING" if recent >= 0 else "DETERIORATING"
    elif recent >= 0 and recent < prior:
        state = "FADING"
    elif recent < 0 and recent < prior:
        state = "DETERIORATING"
    else:
        state = "MIXED"
    return acceleration, state


def normalize_daily_index(values: pd.Series) -> pd.Series:
    clean = clean_series(values)
    if clean.empty or not isinstance(clean.index, pd.DatetimeIndex):
        return clean
    index = clean.index
    if index.tz is None:
        index = index.tz_localize("UTC")
    else:
        index = index.tz_convert("UTC")
    normalized = clean.copy()
    normalized.index = index.normalize()
    return normalized.groupby(level=0).last().sort_index()


def relative_performance(candidate: pd.Series, benchmark: pd.Series, period: int) -> float | None:
    left = normalize_daily_index(candidate).rename("candidate")
    right = normalize_daily_index(benchmark).rename("benchmark")
    aligned = pd.concat([left, right], axis=1, join="inner").dropna()
    if len(aligned) <= period:
        return None
    candidate_return = period_return(aligned["candidate"], period)
    benchmark_return = period_return(aligned["benchmark"], period)
    if candidate_return is None or benchmark_return is None:
        return None
    return finite_number(candidate_return - benchmark_return)
