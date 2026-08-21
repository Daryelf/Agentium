from __future__ import annotations

from datetime import datetime, timezone
import json

import pandas as pd

from stock_guru.data import MarketData
from stock_guru.market_context import build_market_regime, write_market_context_report


def daily_market() -> MarketData:
    symbols = ["AAPL", "MSFT", "SPY", "QQQ", "^VIX", "XLK"]
    dates = pd.date_range(end="2026-08-14", periods=260, freq="B", tz="UTC")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], symbols])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for symbol in symbols:
        if symbol == "^VIX":
            close = pd.Series([18.0] * len(dates), index=dates)
        else:
            slope = 0.45 if symbol == "AAPL" else 0.25
            close = pd.Series([100 + index * slope for index in range(len(dates))], index=dates)
        frame[("Open", symbol)] = close - 0.1
        frame[("High", symbol)] = close + 0.3
        frame[("Low", symbol)] = close - 0.3
        frame[("Close", symbol)] = close
        frame[("Volume", symbol)] = 2_000_000
    return MarketData(symbols, frame)


def test_market_regime_includes_breadth_sector_and_relative_strength() -> None:
    data = daily_market()
    report = build_market_regime(
        data,
        data.tickers,
        generated_at=datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc),
        sectors_by_symbol={"AAPL": "Technology"},
    )

    assert report.trend_regime == "BULLISH"
    assert report.volatility_regime == "NORMAL"
    assert report.breadth_state == "STRONG"
    assert report.risk_state == "RISK_ON"
    assert report.symbols["AAPL"].state == "LEADING"
    assert report.symbols["AAPL"].sector_etf == "XLK"
    assert report.benchmarks["SPY"].above_sma200 is True


def test_market_context_report_persists_real_calculations(tmp_path) -> None:
    data = daily_market()
    report = build_market_regime(data, data.tickers, generated_at=datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc))
    path = write_market_context_report(report, tmp_path / "market_context.json")
    payload = json.loads(path.read_text())

    assert payload["risk_state"] == "RISK_ON"
    assert payload["symbols"]["AAPL"]["score"] is not None
    assert payload["benchmarks"]["SPY"]["last"] is not None


def test_regime_exposes_long_breadth_new_highs_rates_and_high_volatility() -> None:
    data = daily_market()
    bullish = build_market_regime(
        data,
        data.tickers,
        generated_at=datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc),
        rates={"DGS10": 4.0, "DGS3MO": 4.4},
    )

    assert bullish.regime == "STRONG_BULL"
    assert bullish.breadth_above_sma200_pct == 1.0
    assert bullish.breadth_new_highs_20 == 2
    assert bullish.breadth_new_lows_20 == 0
    assert bullish.yield_curve_slope == -0.4
    assert bullish.rate_state == "INVERTED"

    data.history[("Close", "^VIX")] = 35.0
    high_volatility = build_market_regime(data, data.tickers, generated_at=datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc))
    assert high_volatility.regime == "HIGH_VOLATILITY"
    assert high_volatility.risk_state == "RISK_OFF"
