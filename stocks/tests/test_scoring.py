from pathlib import Path

import pandas as pd

from stock_guru.config import Settings, normalize_tickers
from stock_guru.data import MarketData
from stock_guru.scoring import position_size, score_candidates


def settings() -> Settings:
    return Settings(
        default_budget=5000,
        max_positions=5,
        max_position_pct=0.2,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.08,
        min_price=5,
        min_dollar_volume=1_000_000,
        market_timezone="America/New_York",
        regular_market_open="09:30",
        regular_market_close="16:00",
    )


def test_normalize_tickers_dedupes_and_ignores_comments() -> None:
    assert normalize_tickers([" aapl ", "AAPL", "# nope", "msft"]) == ["AAPL", "MSFT"]


def test_position_size_obeys_risk_caps() -> None:
    dollars, shares = position_size(price=100, budget=10_000, settings=settings())
    assert dollars == 1200
    assert shares == 12


def test_score_candidates_ranks_uptrend() -> None:
    dates = pd.date_range("2025-01-01", periods=90)
    columns = pd.MultiIndex.from_product([["Close", "Volume"], ["UP", "DOWN"]])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    frame[("Close", "UP")] = range(100, 190)
    frame[("Volume", "UP")] = 1_000_000
    frame[("Close", "DOWN")] = range(190, 100, -1)
    frame[("Volume", "DOWN")] = 1_000_000

    candidates = score_candidates(MarketData(["UP", "DOWN"], frame), settings(), budget=5000)

    assert candidates[0].ticker == "UP"
    assert candidates[0].score > candidates[1].score
