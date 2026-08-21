from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math

import pandas as pd

from stock_guru.data import MarketData
from stock_guru.market_context import build_market_regime
from stock_guru.quant.context import build_symbol_context
from stock_guru.quant.engine import build_quant_snapshot
from stock_guru.quant.scoring import normalized_signal, score_symbol, weighted_available
from stock_guru.research import EquityResearch


def scoring_market(*, reverse_last_ten: bool = False, final_volume: float = 3_000_000, final_down: bool = False) -> MarketData:
    symbols = ["AAPL", "SPY", "QQQ", "XLK", "^VIX"]
    dates = pd.date_range(end="2026-08-20", periods=260, freq="B", tz="UTC")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], symbols], names=["Price", "Ticker"])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for symbol in symbols:
        if symbol == "^VIX":
            close = pd.Series([16.0] * len(dates), index=dates)
        else:
            slope = 0.42 if symbol == "AAPL" else 0.2
            close = pd.Series([100 + slope * index + math.sin(index / 9) * 0.4 for index in range(len(dates))], index=dates)
        if symbol == "AAPL" and reverse_last_ten:
            start = close.iloc[-11]
            for offset in range(1, 11):
                close.iloc[-11 + offset] = start - offset * 2.2
        if symbol == "AAPL" and final_down:
            close.iloc[-1] = close.iloc[-2] * 0.97
        frame[("Open", symbol)] = close.shift(1).fillna(close.iloc[0])
        frame[("High", symbol)] = close + 1.0
        frame[("Low", symbol)] = close - 1.0
        frame[("Close", symbol)] = close
        frame[("Volume", symbol)] = 1_000_000.0
    frame.loc[dates[-1], ("Volume", "AAPL")] = final_volume
    return MarketData(symbols, frame)


def research(now: datetime, earnings_days: int = 60) -> EquityResearch:
    return EquityResearch(
        ticker="AAPL",
        market_cap=3_000_000_000_000,
        trailing_pe=30,
        forward_pe=26,
        revenue_growth=0.16,
        earnings_growth=0.2,
        eps_growth=0.19,
        profit_margins=0.25,
        operating_margins=0.28,
        free_cash_flow=80_000_000_000,
        total_debt=90_000_000_000,
        debt_to_equity=100,
        peg_ratio=1.8,
        price_to_sales=7.0,
        enterprise_to_revenue=7.2,
        next_earnings_at=now + timedelta(days=earnings_days),
        earnings_source="FMP+YFINANCE",
    )


def build_card(data: MarketData, *, now: datetime, earnings_days: int = 60):
    snapshot = build_quant_snapshot(data, "AAPL", sector_etf="XLK", generated_at=now)
    context = build_symbol_context(snapshot, research=research(now, earnings_days), spread_pct=0.0005, generated_at=now)
    regime = build_market_regime(data, data.tickers, generated_at=now, sectors_by_symbol={"AAPL": "XLK"})
    return score_symbol(snapshot, context, regime, generated_at=now)


def test_continuous_normalization_and_missing_weight_redistribution() -> None:
    assert normalized_signal(0.0, 1.0) == 50.0
    assert normalized_signal(1.0, 1.0) > 50.0
    assert normalized_signal(-1.0, 1.0) < 50.0
    assert normalized_signal(None, 1.0) is None
    assert weighted_available({"a": 80.0, "b": None}, {"a": 0.5, "b": 0.5}) == 80.0


def test_score_card_keeps_score_confidence_risk_and_explanations_separate() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    card = build_card(scoring_market(), now=now)

    assert card.quant_score is not None
    assert card.final_score is not None
    assert card.risk_score is not None
    assert 0 <= card.confidence_score <= 100
    assert card.components.fundamentals is not None
    assert card.positive_factors
    assert card.methodology["execution"].startswith("analytical action only")
    assert card.action in {"STRONG_BUY_CANDIDATE", "BUY_CANDIDATE", "WATCH_FOR_ENTRY", "CAUTION", "AVOID"}


def test_high_volume_is_bullish_only_when_price_direction_confirms() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    bullish = build_card(scoring_market(final_volume=4_000_000), now=now)
    bearish = build_card(scoring_market(final_volume=4_000_000, final_down=True), now=now)

    assert bullish.components.volume is not None
    assert bearish.components.volume is not None
    assert bullish.components.volume > bearish.components.volume


def test_timeframe_conflict_reduces_confidence_and_is_explained() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    aligned = build_card(scoring_market(), now=now)
    conflicting = build_card(scoring_market(reverse_last_ten=True), now=now)

    assert conflicting.conflict_penalty > 0
    assert conflicting.confidence_score < aligned.confidence_score
    assert any("conflict" in item.lower() or "while" in item.lower() for item in conflicting.negative_factors)


def test_imminent_earnings_increases_risk_and_blocks_unqualified_buy_labels() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    normal = build_card(scoring_market(), now=now, earnings_days=60)
    imminent = build_card(scoring_market(), now=now, earnings_days=2)

    assert normal.risk_score is not None and imminent.risk_score is not None
    assert imminent.risk_score > normal.risk_score
    assert "EARNINGS_2_DAYS" in imminent.red_flags
    assert imminent.action not in {"STRONG_BUY_CANDIDATE", "BUY_CANDIDATE"}


def test_insufficient_market_history_never_produces_an_actionable_score() -> None:
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    data = scoring_market()
    short = MarketData(data.tickers, data.history.tail(12))
    card = build_card(short, now=now)

    assert card.action == "INSUFFICIENT_DATA"
    assert card.confidence_score < 50
