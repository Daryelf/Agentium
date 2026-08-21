from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math

import pandas as pd

from stock_guru.catalysts import build_catalyst_events
from stock_guru.data import MarketData
from stock_guru.quant.context import build_symbol_context
from stock_guru.quant.engine import build_quant_snapshot
from stock_guru.research import EquityResearch, NewsHeadline


def market_data() -> MarketData:
    symbols = ["AAPL", "SPY", "QQQ", "XLK"]
    dates = pd.date_range(end="2026-08-20", periods=260, freq="B", tz="UTC")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], symbols], names=["Price", "Ticker"])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for symbol in symbols:
        slope = 0.35 if symbol == "AAPL" else 0.18
        close = pd.Series([100 + slope * index + math.sin(index / 10) * 0.3 for index in range(len(dates))], index=dates)
        frame[("Open", symbol)] = close.shift(1).fillna(close.iloc[0])
        frame[("High", symbol)] = close + 0.8
        frame[("Low", symbol)] = close - 0.8
        frame[("Close", symbol)] = close
        frame[("Volume", symbol)] = 2_000_000
    return MarketData(symbols, frame)


def test_symbol_context_keeps_fundamentals_earnings_sentiment_institutions_and_liquidity_separate() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    snapshot = build_quant_snapshot(market_data(), "AAPL", sector_etf="XLK", generated_at=now)
    research = EquityResearch(
        ticker="AAPL",
        market_cap=3_000_000_000_000,
        trailing_pe=34,
        forward_pe=29,
        revenue_growth=0.08,
        earnings_growth=0.12,
        eps_growth=0.11,
        profit_margins=0.24,
        operating_margins=0.28,
        free_cash_flow=90_000_000_000,
        total_debt=100_000_000_000,
        debt_to_equity=150,
        peg_ratio=2.1,
        price_to_sales=8.0,
        enterprise_to_revenue=7.8,
        next_earnings_at=now + timedelta(days=2),
        earnings_source="FMP+YFINANCE",
    )
    events = build_catalyst_events(
        "AAPL",
        [NewsHeadline("Apple raises guidance after earnings beat estimates", "Reuters", now - timedelta(hours=1), "https://example.com/aapl")],
        received_at=now,
    )
    institutional = [{
        "symbol": "AAPL",
        "side": "BUY",
        "previous_shares": 100,
        "current_shares": 120,
        "portfolio_weight": 0.08,
        "report_date": "2026-06-30",
        "disclosed_at": "2026-08-14T20:00:00Z",
    }]

    context = build_symbol_context(
        snapshot,
        research=research,
        catalyst_events=events,
        institutional_changes=institutional,
        spread_pct=0.0005,
        generated_at=now,
    )

    assert context.timeframes.short in {"BULLISH", "NEUTRAL"}
    assert context.fundamentals.status == "DATA_OK"
    assert context.fundamentals.valuation_context == "BALANCED_REVIEW_REQUIRED"
    assert context.earnings.earnings_in_days == 2
    assert context.earnings.earnings_risk == "HIGH"
    assert context.earnings.exposure_policy == "EXPLICIT_EARNINGS_EXPOSURE_DECISION_REQUIRED"
    assert context.sentiment.news_sentiment == "POSITIVE"
    assert context.sentiment.major_positive_event is True
    assert context.institutional.staleness == "DELAYED"
    assert context.institutional.increases == 1
    assert context.liquidity.status == "LIQUID"


def test_missing_context_inputs_remain_explicitly_insufficient() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    snapshot = build_quant_snapshot(market_data(), "AAPL", generated_at=now)
    context = build_symbol_context(snapshot, generated_at=now)

    assert context.fundamentals.status == "INSUFFICIENT_DATA"
    assert context.earnings.earnings_risk == "UNKNOWN"
    assert context.sentiment.status == "INSUFFICIENT_DATA"
    assert context.institutional.status == "INSUFFICIENT_DATA"
