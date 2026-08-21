from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

import pandas as pd

from stock_guru.data import MarketData
from stock_guru.evaluator import QuoteSnapshot
from stock_guru.market_data_quality import assess_market_data, build_provenance
from stock_guru.multi_timeframe import build_multi_timeframe_context, write_intraday_context_report


def market_data(symbol: str = "AAPL") -> MarketData:
    now = datetime(2026, 8, 14, 15, 30, tzinfo=timezone.utc)
    index = pd.date_range(end=now, periods=61, freq="min", tz="UTC")
    close = pd.Series([100 + index * 0.05 for index in range(len(index))], index=index)
    frame = pd.DataFrame({
        ("Open", symbol): close - 0.02,
        ("High", symbol): close + 0.05,
        ("Low", symbol): close - 0.05,
        ("Close", symbol): close,
        ("Volume", symbol): [10_000 + index * 10 for index in range(len(index))],
    }, index=index)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns, names=["Price", "Ticker"])
    quality = assess_market_data(frame, [symbol], interval="1m", now=now)
    provenance = build_provenance(
        provider="YAHOO_CHART",
        history=frame,
        symbols=[symbol],
        period="5d",
        interval="1m",
        received_at=now,
        latency_ms=25,
        quality=quality,
    )
    return MarketData([symbol], frame, provenance, quality)


def daily_data(symbol: str = "AAPL") -> MarketData:
    index = pd.date_range(end="2026-08-14", periods=30, freq="B", tz="UTC")
    close = pd.Series([95 + index * 0.1 for index in range(len(index))], index=index)
    frame = pd.DataFrame({
        ("Open", symbol): close - 0.1,
        ("High", symbol): close + 0.3,
        ("Low", symbol): close - 0.3,
        ("Close", symbol): close,
        ("Volume", symbol): [1_000_000.0] * len(index),
    }, index=index)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns, names=["Price", "Ticker"])
    return MarketData([symbol], frame)


def test_builds_normalized_multi_timeframe_context() -> None:
    data = market_data()
    context = build_multi_timeframe_context(
        data,
        "AAPL",
        now=datetime(2026, 8, 14, 15, 30, tzinfo=timezone.utc),
        quote=QuoteSnapshot("AAPL", bid=102.99, ask=103.01, last=103.0, data_fresh=True),
        daily_data=daily_data(),
    )

    assert context.source_provider == "YAHOO_CHART"
    assert context.usable is True
    assert context.spread_pct is not None and context.spread_pct < 0.001
    assert context.session_vwap is not None
    assert context.relative_volume is not None
    assert context.dollar_volume is not None
    assert context.session_phase == "REGULAR"
    assert context.regular_high is not None
    assert context.regular_low is not None
    assert context.opening_range_high is None
    assert set(context.timeframes) == {"1m", "5m", "15m", "1h", "1d"}
    assert context.timeframes["1m"].bars == 61
    assert context.timeframes["5m"].bars >= 12
    assert context.alignment == "BULLISH"


def test_premarket_metrics_stay_separate_from_regular_session_volume() -> None:
    symbol = "AAPL"
    now = datetime(2026, 8, 14, 12, 30, tzinfo=timezone.utc)
    index = pd.date_range(start="2026-08-14T08:00:00Z", end=now, freq="min", tz="UTC")
    close = pd.Series([100 + value * 0.01 for value in range(len(index))], index=index)
    frame = pd.DataFrame({
        ("Open", symbol): close - 0.01,
        ("High", symbol): close + 0.03,
        ("Low", symbol): close - 0.03,
        ("Close", symbol): close,
        ("Volume", symbol): [500.0] * len(index),
    }, index=index)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns, names=["Price", "Ticker"])
    context = build_multi_timeframe_context(MarketData([symbol], frame), symbol, now=now, daily_data=daily_data())
    assert context.session_phase == "PREMARKET"
    assert context.premarket_high is not None
    assert context.premarket_volume > 0
    assert context.regular_volume == 0
    assert context.relative_volume is None


def test_stale_intraday_quality_blocks_context_use() -> None:
    base = market_data()
    stale_at = datetime(2026, 8, 14, 17, 0, tzinfo=timezone.utc)
    quality = assess_market_data(base.history, base.tickers, interval="1m", now=stale_at)
    provenance = build_provenance(
        provider="CACHE",
        history=base.history,
        symbols=base.tickers,
        period="5d",
        interval="1m",
        received_at=stale_at,
        latency_ms=0,
        quality=quality,
    )

    context = build_multi_timeframe_context(MarketData(base.tickers, base.history, provenance, quality), "AAPL", now=stale_at)

    assert context.data_health_state == "STALE"
    assert context.usable is False


def test_intraday_context_report_is_persisted_without_fake_symbols(tmp_path) -> None:
    context = build_multi_timeframe_context(
        market_data(),
        "AAPL",
        now=datetime(2026, 8, 14, 15, 30, tzinfo=timezone.utc),
        daily_data=daily_data(),
    )
    path = write_intraday_context_report({"AAPL": context}, tmp_path / "intraday_context.json")
    payload = json.loads(path.read_text())

    assert payload["summary"]["symbols"] == 1
    assert list(payload["symbols"]) == ["AAPL"]
    assert payload["symbols"]["AAPL"]["source_provider"] == "YAHOO_CHART"
