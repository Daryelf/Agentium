from __future__ import annotations

import math

import pandas as pd
import pytest

from stock_guru.quant.indicators import (
    acceleration_state,
    average_daily_range,
    exponential_moving_average,
    gap_frequency,
    macd,
    maximum_drawdown,
    period_return,
    relative_performance,
    simple_moving_average,
    wilder_atr,
    wilder_rsi,
)


def test_moving_averages_have_known_values_and_require_history() -> None:
    values = pd.Series([1.0, 2.0, 3.0, 4.0])

    assert simple_moving_average(values, 3) == pytest.approx(3.0)
    assert exponential_moving_average(values, 3) == pytest.approx(3.125)
    assert simple_moving_average(values, 5) is None
    assert exponential_moving_average(values, 5) is None


def test_wilder_rsi_matches_reference_example() -> None:
    closes = pd.Series([
        44.34, 44.09, 44.15, 43.61, 44.33,
        44.83, 45.10, 45.42, 45.84, 46.08,
        45.89, 46.03, 45.61, 46.28, 46.28,
    ])

    assert wilder_rsi(closes, 14) == pytest.approx(70.4641, abs=0.001)
    assert wilder_rsi(closes.head(14), 14) is None


def test_macd_exposes_line_signal_and_histogram_without_fake_zeros() -> None:
    closes = pd.Series([100.0 + index * 0.4 + math.sin(index / 3) for index in range(60)])
    line, signal, histogram = macd(closes)

    assert line is not None
    assert signal is not None
    assert histogram == pytest.approx(line - signal)
    assert macd(closes.head(20)) == (None, None, None)


def test_atr_drawdown_gap_and_daily_range_have_known_values() -> None:
    close = pd.Series([100.0 + index for index in range(20)])
    high = close + 1.0
    low = close - 1.0
    open_values = close.shift(1).fillna(close.iloc[0])
    open_values.iloc[-1] = close.iloc[-2] * 1.05

    assert wilder_atr(high, low, close, 14) == pytest.approx(2.0)
    average_range, average_range_pct = average_daily_range(high, low, close, 20)
    assert average_range == pytest.approx(2.0)
    assert average_range_pct is not None and average_range_pct > 0
    assert gap_frequency(open_values, close, period=60) == pytest.approx(1 / 19)
    assert maximum_drawdown(pd.Series([100.0, 120.0, 90.0, 110.0])) == pytest.approx(-0.25)


def test_relative_performance_aligns_different_intraday_timestamps_by_market_day() -> None:
    candidate_index = pd.date_range("2026-08-03 13:30", periods=6, freq="D", tz="UTC")
    benchmark_index = pd.date_range("2026-08-03 07:00", periods=6, freq="D", tz="UTC")
    candidate = pd.Series([100, 101, 102, 103, 104, 110], index=candidate_index, dtype=float)
    benchmark = pd.Series([100, 101, 102, 103, 104, 105], index=benchmark_index, dtype=float)

    assert relative_performance(candidate, benchmark, 5) == pytest.approx(0.05)
    assert period_return(candidate.head(5), 5) is None


def test_momentum_acceleration_distinguishes_building_and_fading() -> None:
    accelerating, accelerating_state = acceleration_state((0.02, 0.04, 0.07))
    fading, fading_state = acceleration_state((0.07, 0.04, 0.01))

    assert accelerating == pytest.approx(0.03)
    assert accelerating_state == "ACCELERATING"
    assert fading == pytest.approx(-0.03)
    assert fading_state == "FADING"
