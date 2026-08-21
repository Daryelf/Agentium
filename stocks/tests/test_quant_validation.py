from __future__ import annotations

from datetime import datetime, timezone
import json
import math

import pandas as pd

from stock_guru.data import MarketData
from stock_guru.quant.validation import (
    liquidity_cost_bps,
    run_quant_backtest,
    walk_forward_validate,
    write_quant_backtest_report,
)


def validation_market() -> MarketData:
    symbols = ["AAPL", "MSFT", "SPY", "QQQ", "^VIX"]
    dates = pd.date_range(end="2026-08-20", periods=360, freq="B", tz="UTC")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], symbols], names=["Price", "Ticker"])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for symbol in symbols:
        if symbol == "^VIX":
            close = pd.Series([17.0 + math.sin(index / 30) for index in range(len(dates))], index=dates)
        else:
            slope = {"AAPL": 0.24, "MSFT": 0.18, "SPY": 0.12, "QQQ": 0.15}[symbol]
            close = pd.Series([100 + slope * index + math.sin(index / 12) * 2 for index in range(len(dates))], index=dates)
        frame[("Open", symbol)] = close.shift(1).fillna(close.iloc[0])
        frame[("High", symbol)] = close + 1.0
        frame[("Low", symbol)] = close - 1.0
        frame[("Close", symbol)] = close
        frame[("Volume", symbol)] = 2_000_000.0
    return MarketData(symbols, frame)


def test_quant_backtest_uses_as_of_scores_and_applies_round_trip_costs() -> None:
    report = run_quant_backtest(
        validation_market(),
        ["AAPL", "MSFT"],
        step_sessions=20,
        horizons=(1, 5, 10, 20, 60),
        minimum_history=200,
        minimum_sample=30,
        generated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )

    assert report.observations
    observation = next(item for item in report.observations if item.gross_forward_returns["5d"] is not None)
    expected_cost = 2 * observation.per_side_cost_bps / 10_000
    assert observation.net_forward_returns["5d"] == observation.gross_forward_returns["5d"] - expected_cost
    assert report.score_buckets
    assert all(
        metrics.trusted_sample is False
        for bucket in report.score_buckets.values()
        for metrics in bucket.values()
    )
    assert any("survivorship bias" in limitation for limitation in report.limitations)


def test_future_price_changes_cannot_change_the_historical_score() -> None:
    original = validation_market()
    altered = MarketData(original.tickers, original.history.copy())
    daily_dates = pd.DatetimeIndex(original.history.index)
    cutoff = daily_dates[250]
    future = daily_dates > cutoff
    altered.history.loc[future, ("Close", "AAPL")] *= 1.5
    altered.history.loc[future, ("High", "AAPL")] *= 1.5
    altered.history.loc[future, ("Low", "AAPL")] *= 1.5
    altered.history.loc[future, ("Open", "AAPL")] *= 1.5

    first = run_quant_backtest(original, ["AAPL"], start=cutoff, end=cutoff, step_sessions=1, minimum_history=200)
    second = run_quant_backtest(altered, ["AAPL"], start=cutoff, end=cutoff, step_sessions=1, minimum_history=200)

    assert len(first.observations) == len(second.observations) == 1
    assert first.observations[0].final_score == second.observations[0].final_score
    assert first.observations[0].entry_price == second.observations[0].entry_price
    assert first.observations[0].gross_forward_returns["20d"] != second.observations[0].gross_forward_returns["20d"]


def test_walk_forward_selects_threshold_on_train_only_and_reports_unseen_validation() -> None:
    report = run_quant_backtest(
        validation_market(),
        ["AAPL", "MSFT"],
        step_sessions=10,
        minimum_history=200,
        minimum_sample=5,
    )
    walk = walk_forward_validate(report, train_fraction=0.6, minimum_sample=5)

    assert walk.train_end < walk.validation_start
    assert walk.selected_threshold in {60, 65, 70, 75, 80, 85}
    assert walk.weights_changed is False
    assert walk.validation_metrics.threshold == walk.selected_threshold


def test_backtest_report_serializes_sample_warnings_and_walk_forward(tmp_path) -> None:
    report = run_quant_backtest(validation_market(), ["AAPL", "MSFT"], step_sessions=20, minimum_history=200)
    walk = walk_forward_validate(report, minimum_sample=30)
    path = write_quant_backtest_report(report, walk_forward=walk, path=tmp_path / "quant_backtest.json")
    payload = json.loads(path.read_text())

    assert payload["walk_forward"]["weights_changed"] is False
    assert payload["observations"]
    assert "NaN" not in path.read_text()
    assert payload["provider_costs_bps"] == {"HIGH": 5.0, "LOW": 20.0, "MEDIUM": 10.0, "UNKNOWN": 20.0}


def test_liquidity_cost_buckets_are_deterministic() -> None:
    assert liquidity_cost_bps(200_000_000) == ("HIGH", 5.0)
    assert liquidity_cost_bps(20_000_000) == ("MEDIUM", 10.0)
    assert liquidity_cost_bps(2_000_000) == ("LOW", 20.0)
    assert liquidity_cost_bps(None) == ("UNKNOWN", 20.0)
