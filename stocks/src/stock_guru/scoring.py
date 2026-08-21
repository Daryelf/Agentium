from __future__ import annotations

from dataclasses import dataclass
from math import floor
from typing import Iterable, List

import numpy as np
import pandas as pd

from .config import Settings
from .data import MarketData, close_map, volume_map


@dataclass(frozen=True)
class Candidate:
    ticker: str
    price: float
    score: float
    rating: str
    daily_return: float
    momentum_5d: float
    momentum_20d: float
    momentum_60d: float
    volatility_20d: float
    drawdown_from_high: float
    dollar_volume: float
    suggested_dollars: float
    suggested_shares: int
    reasons: tuple[str, ...]


def pct_change(series: pd.Series, days: int) -> float:
    if len(series) <= days:
        return 0.0
    return float(series.iloc[-1] / series.iloc[-days - 1] - 1)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def annualized_volatility(close: pd.Series, days: int = 20) -> float:
    returns = close.pct_change().dropna().tail(days)
    if returns.empty:
        return 0.0
    return float(returns.std() * np.sqrt(252))


def rating_for(score: float) -> str:
    if score >= 72:
        return "Strong"
    if score >= 55:
        return "Watch"
    return "Avoid"


def position_size(price: float, budget: float, settings: Settings) -> tuple[float, int]:
    max_position = min(
        budget * settings.max_position_pct,
        budget / max(settings.max_positions, 1),
    )
    risk_position = budget * settings.risk_per_trade_pct / settings.stop_loss_pct
    dollars = max(0.0, min(max_position, risk_position))
    shares = floor(dollars / price) if price > 0 else 0
    return shares * price, shares


def score_candidates(data: MarketData, settings: Settings, budget: float) -> List[Candidate]:
    closes = close_map(data)
    volumes = volume_map(data)
    candidates: list[Candidate] = []

    for ticker, close in closes.items():
        if len(close) < 30:
            continue

        price = float(close.iloc[-1])
        if price < settings.min_price:
            continue

        volume = volumes.get(ticker, pd.Series(dtype="float64"))
        avg_volume = float(volume.tail(20).mean()) if not volume.empty else 0.0
        dollar_volume = price * avg_volume

        daily_return = pct_change(close, 1)
        momentum_5d = pct_change(close, 5)
        momentum_20d = pct_change(close, 20)
        momentum_60d = pct_change(close, 60)
        vol_20d = annualized_volatility(close)
        high_126d = float(close.tail(126).max())
        drawdown = float(price / high_126d - 1) if high_126d else 0.0
        ma20 = float(close.tail(20).mean())
        ma50 = float(close.tail(50).mean()) if len(close) >= 50 else ma20

        score = 50.0
        score += clamp(momentum_20d * 120, -18, 18)
        score += clamp(momentum_60d * 80, -16, 16)
        score += 10 if price > ma20 > ma50 else -8
        score += 8 if momentum_5d > 0 else -5
        score += 8 if dollar_volume >= settings.min_dollar_volume else -15
        score += clamp((0.55 - vol_20d) * 20, -12, 8)
        score += 5 if drawdown > -0.12 else -8
        score = round(clamp(score, 0, 100), 1)

        dollars, shares = position_size(price, budget, settings)
        reasons = build_reasons(
            price=price,
            ma20=ma20,
            ma50=ma50,
            momentum_20d=momentum_20d,
            momentum_60d=momentum_60d,
            vol_20d=vol_20d,
            dollar_volume=dollar_volume,
            settings=settings,
        )

        candidates.append(
            Candidate(
                ticker=ticker,
                price=price,
                score=score,
                rating=rating_for(score),
                daily_return=daily_return,
                momentum_5d=momentum_5d,
                momentum_20d=momentum_20d,
                momentum_60d=momentum_60d,
                volatility_20d=vol_20d,
                drawdown_from_high=drawdown,
                dollar_volume=dollar_volume,
                suggested_dollars=dollars,
                suggested_shares=shares,
                reasons=tuple(reasons),
            )
        )

    return sorted(candidates, key=lambda item: item.score, reverse=True)


def build_reasons(
    *,
    price: float,
    ma20: float,
    ma50: float,
    momentum_20d: float,
    momentum_60d: float,
    vol_20d: float,
    dollar_volume: float,
    settings: Settings,
) -> Iterable[str]:
    if price > ma20 > ma50:
        yield "uptrend"
    if momentum_20d > 0.04:
        yield "20d momentum"
    if momentum_60d > 0.08:
        yield "60d momentum"
    if vol_20d < 0.45:
        yield "controlled vol"
    if dollar_volume >= settings.min_dollar_volume:
        yield "liquid"
