from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from stock_guru.market_data_quality import (
    AnalysisDataStatus,
    DataQualityIssue,
    DataHealthState,
    assess_market_data,
    compare_provider_closes,
    ProviderAttempt,
    read_provider_health,
    record_provider_attempt,
)


def frame(symbol: str = "AAPL") -> pd.DataFrame:
    index = pd.date_range("2026-08-14 14:30:00", periods=3, freq="min", tz="UTC")
    result = pd.DataFrame(
        {
            ("Open", symbol): [100.0, 101.0, 102.0],
            ("High", symbol): [101.0, 102.0, 103.0],
            ("Low", symbol): [99.0, 100.0, 101.0],
            ("Close", symbol): [100.5, 101.5, 102.5],
            ("Volume", symbol): [1000.0, 1100.0, 1200.0],
        },
        index=index,
    )
    result.columns = pd.MultiIndex.from_tuples(result.columns, names=["Price", "Ticker"])
    return result


def test_quality_report_accepts_coherent_fresh_ohlcv() -> None:
    report = assess_market_data(
        frame(),
        ["AAPL"],
        interval="1m",
        now=datetime(2026, 8, 14, 14, 33, tzinfo=timezone.utc),
    )

    assert report.state == DataHealthState.HEALTHY
    assert report.analysis_status == AnalysisDataStatus.DATA_OK
    assert report.score == 100
    assert report.is_usable is True
    assert report.available_symbols == ("AAPL",)


def test_quality_report_detects_stale_and_impossible_ohlcv() -> None:
    history = frame()
    history.loc[history.index[-1], ("High", "AAPL")] = 90.0

    report = assess_market_data(
        history,
        ["AAPL"],
        interval="1m",
        now=datetime(2026, 8, 14, 16, 0, tzinfo=timezone.utc),
    )

    codes = {issue.code for issue in report.issues}
    assert "IMPOSSIBLE_OHLC" in codes
    assert "STALE_DATA" in codes
    assert report.state == DataHealthState.STALE
    assert report.is_usable is False


def test_quality_report_detects_missing_symbol_and_duplicate_time() -> None:
    history = pd.concat([frame(), frame().iloc[[-1]]])

    report = assess_market_data(
        history,
        ["AAPL", "MSFT"],
        interval="1m",
        now=datetime(2026, 8, 14, 14, 33, tzinfo=timezone.utc),
    )

    codes = {issue.code for issue in report.issues}
    assert "MISSING_SYMBOLS" in codes
    assert "DUPLICATE_TIMESTAMPS" in codes
    assert report.state == DataHealthState.PARTIAL


def test_daily_missing_session_ignores_holiday_but_detects_real_gap() -> None:
    index = pd.DatetimeIndex(["2026-12-23", "2026-12-24", "2026-12-29"], tz="UTC")
    history = frame().copy()
    history.index = index
    report = assess_market_data(
        history,
        ["AAPL"],
        interval="1d",
        now=datetime(2026, 12, 29, 22, 0, tzinfo=timezone.utc),
    )
    issue = next(item for item in report.issues if item.code == "MISSING_TRADING_SESSIONS")
    assert issue.count == 1  # December 28 is missing; Christmas and the weekend are not.


def test_provider_close_conflict_is_a_hard_analysis_status() -> None:
    primary = frame()
    validation = frame()
    validation.loc[validation.index[-1], ("Close", "AAPL")] = 104.0
    conflicts = compare_provider_closes(primary, validation, ["AAPL"])
    report = assess_market_data(
        primary,
        ["AAPL"],
        interval="1m",
        now=datetime(2026, 8, 14, 14, 33, tzinfo=timezone.utc),
        external_issues=conflicts,
    )
    assert report.analysis_status == AnalysisDataStatus.DATA_CONFLICT
    assert report.is_usable is False


def test_insufficient_history_is_not_replaced_with_a_neutral_value() -> None:
    report = assess_market_data(
        frame(),
        ["AAPL"],
        interval="1m",
        now=datetime(2026, 8, 14, 14, 33, tzinfo=timezone.utc),
        minimum_history_rows=20,
    )
    assert report.analysis_status == AnalysisDataStatus.DATA_INSUFFICIENT
    assert report.is_usable is False


def test_repeated_context_symbol_issue_is_charged_once_at_batch_level() -> None:
    report = assess_market_data(
        frame(),
        ["AAPL"],
        interval="1m",
        now=datetime(2026, 8, 14, 14, 33, tzinfo=timezone.utc),
        external_issues=(
            DataQualityIssue("PROVIDER_VALIDATION_UNAVAILABLE", "warning", "first", symbol="XLK"),
            DataQualityIssue("PROVIDER_VALIDATION_UNAVAILABLE", "warning", "second", symbol="XLY"),
        ),
    )
    assert report.score == 95
    assert report.analysis_status == AnalysisDataStatus.DATA_PARTIAL
    assert report.is_usable is True


def test_successful_provider_attempt_marks_the_feed_that_is_actually_serving_data(tmp_path) -> None:
    path = tmp_path / "provider_health.json"
    record_provider_attempt(path, ProviderAttempt(
        provider="MASSIVE",
        status="success",
        started_at="2026-08-21T14:00:00+00:00",
        completed_at="2026-08-21T14:00:01+00:00",
        latency_ms=1000,
        data_type="LATEST_PRICE_SNAPSHOT",
        interval="snapshot",
        requested_symbols=("AAPL", "MSFT"),
        returned_symbols=("AAPL", "MSFT"),
    ))
    record_provider_attempt(path, ProviderAttempt(
        provider="FMP",
        status="budget_exhausted",
        started_at="2026-08-21T14:00:02+00:00",
        completed_at="2026-08-21T14:00:02+00:00",
        latency_ms=0,
        data_type="OHLCV_HISTORY",
        interval="1d",
        requested_symbols=("AAPL",),
        error="budget exhausted",
    ))

    health = read_provider_health(path)
    assert health["version"] == 2
    assert health["serving_provider"] == "MASSIVE"
    assert health["providers"]["MASSIVE"]["status"] == "HEALTHY"
    assert health["providers"]["FMP"]["status"] == "DEGRADED"
