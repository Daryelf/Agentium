from __future__ import annotations

from datetime import datetime, timezone
import json
import math

import pandas as pd

from stock_guru.data import MarketData
from stock_guru.quant.engine import build_quant_snapshot, build_quant_snapshots, write_quant_report


def quant_market(rows: int = 260) -> MarketData:
    symbols = ["AAPL", "SPY", "QQQ", "XLK"]
    dates = pd.date_range(end="2026-08-19", periods=rows, freq="B", tz="UTC")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], symbols], names=["Price", "Ticker"])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for symbol in symbols:
        slope = {"AAPL": 0.42, "SPY": 0.18, "QQQ": 0.24, "XLK": 0.27}[symbol]
        close = pd.Series(
            [100.0 + slope * index + math.sin(index / 9) * 0.6 for index in range(rows)],
            index=dates,
        )
        volume = pd.Series([1_000_000.0 + index * 1_000 for index in range(rows)], index=dates)
        if symbol == "AAPL":
            volume.iloc[-1] = 3_000_000.0
        frame[("Open", symbol)] = close.shift(1).fillna(close.iloc[0])
        frame[("High", symbol)] = close + 1.0
        frame[("Low", symbol)] = close - 1.0
        frame[("Close", symbol)] = close
        frame[("Volume", symbol)] = volume
    return MarketData(symbols, frame)


def test_quant_snapshot_centralizes_all_phase_two_feature_families() -> None:
    generated_at = datetime(2026, 8, 20, 1, 0, tzinfo=timezone.utc)
    snapshot = build_quant_snapshot(quant_market(), "AAPL", sector_etf="XLK", generated_at=generated_at)

    assert snapshot.version == 2
    assert snapshot.bars == 260
    assert snapshot.feature_status == "DATA_PARTIAL"  # Synthetic fixture has no provider-quality record.
    assert snapshot.trend.simple_moving_averages["sma200"] is not None
    assert snapshot.trend.exponential_moving_averages["ema200"] is not None
    assert snapshot.trend.long_term == "BULLISH"
    assert snapshot.momentum.rsi14 is not None
    assert snapshot.momentum.macd_histogram is not None
    assert snapshot.momentum.returns["12m"] is not None
    assert snapshot.volatility.atr14 is not None
    assert snapshot.volatility.maximum_drawdown is not None
    assert snapshot.volume.relative_volume_20 is not None and snapshot.volume.relative_volume_20 > 1.8
    assert snapshot.volume.price_volume_confirmation == "BULLISH_CONFIRMATION"
    assert snapshot.relative_strength.versus_spy["20d"] is not None
    assert snapshot.relative_strength.versus_spy["20d"] > 0
    assert snapshot.relative_strength.sector_etf == "XLK"
    assert snapshot.support_zones
    assert snapshot.resistance_zones


def test_insufficient_history_remains_none_instead_of_becoming_zero() -> None:
    snapshot = build_quant_snapshot(quant_market(rows=12), "AAPL", generated_at=datetime(2026, 8, 20, tzinfo=timezone.utc))

    assert snapshot.feature_status == "DATA_INSUFFICIENT"
    assert snapshot.trend.simple_moving_averages["sma20"] is None
    assert snapshot.trend.exponential_moving_averages["ema20"] is None
    assert snapshot.momentum.rsi14 is None
    assert snapshot.momentum.macd_line is None
    assert snapshot.volatility.historical_volatility_20 is None
    assert snapshot.volume.average_volume_20 is None
    assert "INSUFFICIENT_HISTORY_20" in snapshot.warnings


def test_snapshot_is_deterministic_for_the_same_data_and_timestamp() -> None:
    data = quant_market()
    generated_at = datetime(2026, 8, 20, 1, 0, tzinfo=timezone.utc)

    first = build_quant_snapshot(data, "AAPL", sector_etf="XLK", generated_at=generated_at)
    second = build_quant_snapshot(data, "AAPL", sector_etf="XLK", generated_at=generated_at)

    assert first.to_dict() == second.to_dict()


def test_quant_report_serializes_without_nan_or_placeholder_symbols(tmp_path) -> None:
    snapshots = build_quant_snapshots(
        quant_market(),
        ["AAPL", "SPY"],
        sectors_by_symbol={"AAPL": "XLK"},
        generated_at=datetime(2026, 8, 20, 1, 0, tzinfo=timezone.utc),
    )
    path = write_quant_report(snapshots, tmp_path / "quant_features.json")
    raw = path.read_text()
    payload = json.loads(raw)

    assert payload["summary"]["symbols"] == 2
    assert set(payload["symbols"]) == {"AAPL", "SPY"}
    assert "NaN" not in raw
    assert payload["symbols"]["AAPL"]["relative_strength"]["sector_etf"] == "XLK"
