from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import math
from typing import Iterable, Mapping

from ..market_context import MarketRegimeReport
from .context import SymbolContextSnapshot
from .models import QuantFeatureSnapshot


QUANT_WEIGHTS = {"trend": 0.25, "momentum": 0.25, "volume": 0.20, "relative_strength": 0.20, "volatility": 0.10}
QUALITY_WEIGHTS = {"quant": 0.60, "fundamentals": 0.15, "sentiment": 0.05, "institutional": 0.05, "entry_quality": 0.15}
FINAL_WEIGHTS = {"quality": 0.70, "market_regime": 0.15, "risk_safety": 0.15}
HARD_DATA_STATUSES = {"DATA_STALE", "DATA_CONFLICT", "DATA_INSUFFICIENT"}


@dataclass(frozen=True)
class ComponentScores:
    trend: float | None
    momentum: float | None
    volume: float | None
    relative_strength: float | None
    volatility: float | None
    fundamentals: float | None
    sentiment: float | None
    institutional: float | None
    entry_quality: float | None


@dataclass(frozen=True)
class ArgentumScoreCard:
    version: int
    symbol: str
    generated_at: str
    components: ComponentScores
    quant_score: float | None
    confidence_score: float
    risk_score: float | None
    market_regime_score: float | None
    final_score: float | None
    conflict_penalty: float
    entry_setup: str
    action: str
    positive_factors: tuple[str, ...]
    negative_factors: tuple[str, ...]
    red_flags: tuple[str, ...]
    methodology: Mapping[str, object]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, float(value)))


def _rounded(value: float | None) -> float | None:
    return round(clamp(value), 2) if value is not None and math.isfinite(value) else None


def normalized_signal(value: float | None, scale: float) -> float | None:
    if value is None or not math.isfinite(value) or scale <= 0:
        return None
    return clamp(50.0 + 50.0 * math.tanh(value / scale))


def weighted_available(values: Mapping[str, float | None], weights: Mapping[str, float]) -> float | None:
    available = [(float(values[key]), float(weight)) for key, weight in weights.items() if values.get(key) is not None and math.isfinite(float(values[key]))]
    total_weight = sum(weight for _, weight in available)
    if total_weight <= 0:
        return None
    return sum(value * weight for value, weight in available) / total_weight


def _mean(values: Iterable[float | None]) -> float | None:
    available = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return sum(available) / len(available) if available else None


def _trend_score(snapshot: QuantFeatureSnapshot) -> float | None:
    state_value = {"BULLISH": 100.0, "NEUTRAL": 50.0, "BEARISH": 0.0, "UNKNOWN": None}
    timeframe = _mean(state_value.get(value) for value in (snapshot.trend.short_term, snapshot.trend.medium_term, snapshot.trend.long_term))
    atr_pct = snapshot.volatility.atr_pct or 0.02
    distance_scores = [
        normalized_signal(snapshot.trend.price_distance_pct.get(name), max(0.01, atr_pct * 2.0))
        for name in ("ema20", "sma50", "sma200")
    ]
    return _mean([timeframe, _mean(distance_scores)])


def _return_score(value: float | None, horizon: int, annualized_volatility: float | None) -> float | None:
    if value is None:
        return None
    daily_volatility = (annualized_volatility / math.sqrt(252)) if annualized_volatility is not None and annualized_volatility > 0 else 0.0125
    expected_move = max(0.01, daily_volatility * math.sqrt(horizon))
    return normalized_signal(value, expected_move * 1.5)


def _momentum_score(snapshot: QuantFeatureSnapshot) -> float | None:
    returns = snapshot.momentum.returns
    volatility = snapshot.volatility.historical_volatility_60 or snapshot.volatility.historical_volatility_20
    return_scores = [
        _return_score(returns.get(label), horizon, volatility)
        for label, horizon in (("5d", 5), ("20d", 20), ("3m", 63), ("6m", 126))
    ]
    rsi = snapshot.momentum.rsi14
    rsi_score = normalized_signal((rsi - 50.0) if rsi is not None else None, 15.0)
    histogram_score = normalized_signal(snapshot.momentum.macd_histogram, max(0.01, (snapshot.volatility.atr14 or 1.0) * 0.35))
    acceleration_score = normalized_signal(snapshot.momentum.acceleration_5d, max(0.01, (snapshot.volatility.atr_pct or 0.02) * 1.5))
    return _mean([_mean(return_scores), rsi_score, histogram_score, acceleration_score])


def _volume_score(snapshot: QuantFeatureSnapshot) -> float | None:
    one_day = snapshot.momentum.returns.get("1d")
    relative_volume = snapshot.volume.relative_volume_20
    directional_impulse = one_day * min(relative_volume, 3.0) if one_day is not None and relative_volume is not None else None
    impulse_score = normalized_signal(directional_impulse, max(0.01, (snapshot.volatility.atr_pct or 0.02)))
    balance = snapshot.volume.accumulation_distribution_balance
    balance_score = clamp(50 + 50 * balance) if balance is not None else None
    trend_impulse = None
    if snapshot.volume.trend_ratio is not None and one_day is not None:
        trend_impulse = normalized_signal((snapshot.volume.trend_ratio - 1.0) * (1.0 if one_day >= 0 else -1.0), 0.35)
    return _mean([impulse_score, balance_score, trend_impulse])


def _relative_strength_score(snapshot: QuantFeatureSnapshot) -> float | None:
    horizons = (("5d", 0.03), ("20d", 0.06), ("3m", 0.12), ("6m", 0.20), ("12m", 0.30))
    spy = [normalized_signal(snapshot.relative_strength.versus_spy.get(label), scale) for label, scale in horizons]
    qqq = [normalized_signal(snapshot.relative_strength.versus_qqq.get(label), scale) for label, scale in horizons]
    sector = [normalized_signal(snapshot.relative_strength.versus_sector.get(label), scale) for label, scale in horizons]
    return weighted_available({"spy": _mean(spy), "qqq": _mean(qqq), "sector": _mean(sector)}, {"spy": 0.5, "qqq": 0.3, "sector": 0.2})


def _volatility_score(snapshot: QuantFeatureSnapshot) -> float | None:
    atr_risk = clamp((snapshot.volatility.atr_pct or 0.0) / 0.08 * 100) if snapshot.volatility.atr_pct is not None else None
    historical_risk = clamp((snapshot.volatility.historical_volatility_60 or 0.0) / 0.8 * 100) if snapshot.volatility.historical_volatility_60 is not None else None
    drawdown_risk = clamp(abs(snapshot.volatility.recent_drawdown_63 or 0.0) / 0.35 * 100) if snapshot.volatility.recent_drawdown_63 is not None else None
    risk = _mean([atr_risk, historical_risk, drawdown_risk])
    return 100.0 - risk if risk is not None else None


def _fundamental_score(context: SymbolContextSnapshot) -> float | None:
    values = context.fundamentals
    if values.status == "INSUFFICIENT_DATA":
        return None
    growth = _mean([
        normalized_signal(values.revenue_growth, 0.25),
        normalized_signal(values.earnings_growth, 0.30),
        normalized_signal(values.eps_growth, 0.30),
    ])
    margins = _mean([
        normalized_signal(values.profit_margins, 0.25),
        normalized_signal(values.operating_margins, 0.25),
    ])
    cash_flow = 75.0 if values.free_cash_flow is not None and values.free_cash_flow > 0 else 25.0 if values.free_cash_flow is not None else None
    debt = normalized_signal(-(values.debt_to_equity - 100.0) if values.debt_to_equity is not None else None, 150.0)
    pe = values.forward_pe if values.forward_pe is not None else values.trailing_pe
    if pe is None:
        valuation = None
    else:
        growth_anchor = max(0.05, values.revenue_growth or values.earnings_growth or 0.05)
        growth_adjusted_multiple = pe / (growth_anchor * 100)
        valuation = normalized_signal(2.0 - growth_adjusted_multiple, 1.5)
    return weighted_available(
        {"growth": growth, "margins": margins, "cash_flow": cash_flow, "debt": debt, "valuation": valuation},
        {"growth": 0.3, "margins": 0.2, "cash_flow": 0.2, "debt": 0.15, "valuation": 0.15},
    )


def _sentiment_score(context: SymbolContextSnapshot) -> float | None:
    sentiment = context.sentiment
    if sentiment.status == "INSUFFICIENT_DATA" or sentiment.news_sentiment == "UNKNOWN":
        return None
    raw = {"POSITIVE": 80.0, "MIXED": 50.0, "NEGATIVE": 20.0}[sentiment.news_sentiment]
    return 50.0 + (raw - 50.0) * sentiment.confidence


def _institutional_score(context: SymbolContextSnapshot) -> float | None:
    institutional = context.institutional
    if institutional.status == "INSUFFICIENT_DATA" or institutional.changes <= 0:
        return None
    signed = institutional.increases + institutional.new_positions - institutional.reductions - institutional.exits
    raw = normalized_signal(signed / institutional.changes, 0.75)
    # 13F evidence is deliberately shrunk toward neutral because it is delayed.
    shrink = 0.15 if institutional.staleness == "STALE" else 0.35
    return 50.0 + ((raw or 50.0) - 50.0) * shrink


def _entry_quality_score(snapshot: QuantFeatureSnapshot) -> float | None:
    price = snapshot.price
    atr = snapshot.volatility.atr14
    ema20 = snapshot.trend.exponential_moving_averages.get("ema20")
    if price is None or atr is None or atr <= 0 or ema20 is None:
        return None
    extension_atr = (price - ema20) / atr
    if extension_atr < -2:
        extension_score = 20.0
    elif extension_atr <= 1.5:
        extension_score = clamp(75 + extension_atr * 8)
    elif extension_atr <= 3:
        extension_score = clamp(87 - (extension_atr - 1.5) * 25)
    else:
        extension_score = max(5.0, 50.0 - (extension_atr - 3) * 20)
    rsi = snapshot.momentum.rsi14
    if rsi is None:
        rsi_entry = None
    elif 42 <= rsi <= 65:
        rsi_entry = 85.0
    elif rsi > 75 or rsi < 25:
        rsi_entry = 20.0
    else:
        rsi_entry = 55.0
    support_distance = abs(snapshot.support_zones[0].midpoint - price) / atr if snapshot.support_zones else None
    support_score = clamp(90 - support_distance * 20) if support_distance is not None else None
    resistance_distance = (snapshot.resistance_zones[0].midpoint - price) / atr if snapshot.resistance_zones else None
    resistance_score = clamp(35 + resistance_distance * 20) if resistance_distance is not None else 75.0
    recent_return = snapshot.momentum.returns.get("20d")
    extension_return_score = clamp(100 - max(0.0, (recent_return or 0.0) - 0.12) / 0.18 * 100) if recent_return is not None else None
    return _mean([extension_score, rsi_entry, support_score, resistance_score, extension_return_score])


def _regime_score(regime: MarketRegimeReport) -> float | None:
    return {
        "STRONG_BULL": 90.0,
        "BULL": 75.0,
        "NEUTRAL": 50.0,
        "CAUTION": 35.0,
        "BEAR": 20.0,
        "HIGH_VOLATILITY": 15.0,
        "RISK_OFF": 10.0,
    }.get(regime.regime)


def _risk_score(snapshot: QuantFeatureSnapshot, context: SymbolContextSnapshot, regime: MarketRegimeReport) -> float | None:
    factors: dict[str, float | None] = {
        "atr": clamp((snapshot.volatility.atr_pct or 0.0) / 0.08 * 100) if snapshot.volatility.atr_pct is not None else None,
        "historical_volatility": clamp((snapshot.volatility.historical_volatility_60 or 0.0) / 0.8 * 100) if snapshot.volatility.historical_volatility_60 is not None else None,
        "drawdown": clamp(abs(snapshot.volatility.recent_drawdown_63 or 0.0) / 0.35 * 100) if snapshot.volatility.recent_drawdown_63 is not None else None,
        "earnings": {"NOT_APPLICABLE": 10.0, "NORMAL": 10.0, "MODERATE": 35.0, "ELEVATED": 70.0, "HIGH": 90.0, "UNKNOWN": 55.0}.get(context.earnings.earnings_risk),
        "liquidity": {"LIQUID": 10.0, "THIN": 50.0, "LOW_LIQUIDITY": 90.0, "INSUFFICIENT_DATA": 70.0}.get(context.liquidity.status),
        "regime": {"STRONG_BULL": 15.0, "BULL": 25.0, "NEUTRAL": 45.0, "CAUTION": 60.0, "BEAR": 75.0, "HIGH_VOLATILITY": 90.0, "RISK_OFF": 90.0}.get(regime.regime),
    }
    return weighted_available(factors, {"atr": 0.2, "historical_volatility": 0.15, "drawdown": 0.15, "earnings": 0.2, "liquidity": 0.15, "regime": 0.15})


def _conflicts(snapshot: QuantFeatureSnapshot, context: SymbolContextSnapshot, regime: MarketRegimeReport) -> list[str]:
    conflicts = list(context.timeframes.conflicts)
    histogram = snapshot.momentum.macd_histogram
    if snapshot.trend.long_term == "BULLISH" and histogram is not None and histogram < 0:
        conflicts.append("Long-term trend is bullish while MACD histogram is negative.")
    if snapshot.trend.short_term == "BEARISH" and snapshot.trend.golden_cross_active is True:
        conflicts.append("Short-term trend is bearish while the 50/200-day golden-cross structure remains active.")
    if snapshot.trend.short_term == "BULLISH" and snapshot.volume.price_volume_confirmation in {"WEAK_RALLY", "BEARISH_CONFIRMATION"}:
        conflicts.append("Bullish price structure lacks supporting volume.")
    rs20 = snapshot.relative_strength.versus_spy.get("20d")
    if snapshot.trend.medium_term == "BULLISH" and rs20 is not None and rs20 < 0:
        conflicts.append("Medium-term trend is bullish but 20-day relative strength trails SPY.")
    if snapshot.trend.long_term == "BULLISH" and regime.risk_state == "RISK_OFF":
        conflicts.append("Stock trend conflicts with a risk-off market regime.")
    return list(dict.fromkeys(conflicts))


def _confidence(
    snapshot: QuantFeatureSnapshot,
    context: SymbolContextSnapshot,
    components: ComponentScores,
    conflicts: list[str],
) -> tuple[float, float]:
    source = {"DATA_OK": 95.0, "DATA_PARTIAL": 70.0, "UNKNOWN": 50.0, "DATA_STALE": 20.0, "DATA_CONFLICT": 10.0, "DATA_INSUFFICIENT": 10.0}.get(snapshot.source_data_status, 50.0)
    quality = float(snapshot.source_quality_score) if snapshot.source_quality_score is not None else source
    history = min(100.0, snapshot.bars / 253 * 100.0)
    agreement = (context.timeframes.agreement_ratio * 100.0) if context.timeframes.agreement_ratio is not None else 35.0
    available_values = [value for value in asdict(components).values() if value is not None]
    availability = len(available_values) / len(asdict(components)) * 100.0
    directional = [1 if value >= 55 else -1 if value <= 45 else 0 for value in available_values]
    directional = [value for value in directional if value != 0]
    signal_agreement = max(directional.count(1), directional.count(-1)) / len(directional) * 100.0 if directional else 50.0
    base = weighted_available(
        {"source": source, "quality": quality, "history": history, "timeframes": agreement, "availability": availability, "signals": signal_agreement},
        {"source": 0.2, "quality": 0.2, "history": 0.15, "timeframes": 0.15, "availability": 0.15, "signals": 0.15},
    ) or 0.0
    penalty = min(35.0, len(conflicts) * 8.0)
    if any("PROVIDER_PRICE_CONFLICT" in warning for warning in snapshot.warnings):
        penalty = max(penalty, 35.0)
    return clamp(base - penalty), penalty


def _entry_setup(snapshot: QuantFeatureSnapshot) -> str:
    rsi = snapshot.momentum.rsi14
    histogram = snapshot.momentum.macd_histogram
    relative_volume = snapshot.volume.relative_volume_20
    return20 = snapshot.momentum.returns.get("20d")
    ema9 = snapshot.trend.exponential_moving_averages.get("ema9")
    if snapshot.trend.short_term == "BEARISH" and rsi is not None and rsi < 30 and snapshot.momentum.acceleration_state == "DETERIORATING":
        return "FALLING_KNIFE"
    if rsi is not None and rsi < 40 and histogram is not None and histogram > 0 and snapshot.momentum.acceleration_state == "ACCELERATING" and snapshot.price is not None and ema9 is not None and snapshot.price > ema9:
        return "CONFIRMED_REVERSAL"
    if rsi is not None and rsi < 40 and snapshot.momentum.acceleration_state in {"ACCELERATING", "MIXED"}:
        return "POSSIBLE_REVERSAL"
    if return20 is not None and return20 >= 0.08 and snapshot.trend.short_term == "BULLISH":
        if relative_volume is not None and relative_volume >= 1.2 and histogram is not None and histogram > 0:
            return "CONFIRMED_BREAKOUT"
        return "BREAKOUT_WITHOUT_VOLUME"
    if snapshot.trend.short_term == "BULLISH" and snapshot.trend.medium_term == "BULLISH":
        return "TREND_CONTINUATION"
    return "NO_CLEAR_SETUP"


def _red_flags(snapshot: QuantFeatureSnapshot, context: SymbolContextSnapshot, regime: MarketRegimeReport, setup: str) -> list[str]:
    flags: list[str] = []
    if snapshot.feature_status in HARD_DATA_STATUSES:
        flags.append(snapshot.feature_status)
    if context.earnings.earnings_risk in {"HIGH", "ELEVATED"}:
        flags.append(f"EARNINGS_{context.earnings.earnings_in_days}_DAYS" if context.earnings.earnings_in_days is not None else "EARNINGS_DATE_CONFLICT")
    elif context.earnings.earnings_risk == "UNKNOWN":
        flags.append("EARNINGS_DATE_UNKNOWN")
    distance20 = snapshot.trend.price_distance_pct.get("ema20")
    if distance20 is not None and snapshot.volatility.atr_pct is not None and distance20 > snapshot.volatility.atr_pct * 3:
        flags.append("EXTENDED_ABOVE_20EMA")
    if snapshot.volume.relative_volume_20 is not None and snapshot.volume.relative_volume_20 < 0.5:
        flags.append("VOLUME_COLLAPSE")
    if snapshot.trend.short_term == snapshot.trend.medium_term == snapshot.trend.long_term == "BEARISH":
        flags.append("SEVERE_DOWNTREND")
    if snapshot.volatility.gap_frequency_60 is not None and snapshot.volatility.gap_frequency_60 > 0.2:
        flags.append("FREQUENT_LARGE_GAPS")
    if context.liquidity.status in {"LOW_LIQUIDITY", "INSUFFICIENT_DATA"}:
        flags.append("LOW_LIQUIDITY")
    if snapshot.momentum.returns.get("20d") is not None and snapshot.momentum.returns["20d"] > 0.25:
        flags.append("MASSIVE_RECENT_RUNUP")
    if snapshot.momentum.acceleration_state in {"FADING", "DETERIORATING"}:
        flags.append("DECLINING_MOMENTUM")
    if regime.risk_state == "RISK_OFF":
        flags.append("MARKET_REGIME_CONFLICT")
    if setup == "FALLING_KNIFE":
        flags.append("FALLING_KNIFE")
    return list(dict.fromkeys(flags))


def _factors(snapshot: QuantFeatureSnapshot, context: SymbolContextSnapshot, components: ComponentScores, conflicts: list[str]) -> tuple[list[str], list[str]]:
    positive: list[str] = []
    negative: list[str] = []
    if snapshot.trend.alignment in {"BULLISH", "BULLISH_PARTIAL"}:
        positive.append(f"Moving-average alignment is {snapshot.trend.alignment.lower().replace('_', ' ')}.")
    elif snapshot.trend.alignment == "BEARISH":
        negative.append("Moving-average alignment is bearish.")
    rs20 = snapshot.relative_strength.versus_spy.get("20d")
    if rs20 is not None:
        destination = positive if rs20 > 0 else negative
        destination.append(f"20-day relative strength versus SPY is {rs20:+.1%}.")
    if snapshot.volume.relative_volume_20 is not None:
        destination = positive if snapshot.volume.price_volume_confirmation == "BULLISH_CONFIRMATION" else negative if snapshot.volume.price_volume_confirmation in {"WEAK_RALLY", "BEARISH_CONFIRMATION"} else positive
        destination.append(f"Relative volume is {snapshot.volume.relative_volume_20:.2f}x with {snapshot.volume.price_volume_confirmation.lower().replace('_', ' ')}.")
    if snapshot.momentum.macd_histogram is not None:
        destination = positive if snapshot.momentum.macd_histogram > 0 else negative
        destination.append(f"MACD histogram is {snapshot.momentum.macd_histogram:+.3f}.")
    if snapshot.momentum.rsi14 is not None and snapshot.momentum.rsi14 >= 70:
        negative.append(f"RSI {snapshot.momentum.rsi14:.1f} indicates short-term extension.")
    if context.earnings.earnings_in_days is not None and context.earnings.earnings_in_days <= 14:
        negative.append(f"Earnings are scheduled in {context.earnings.earnings_in_days} day(s).")
    negative.extend(conflicts)
    return list(dict.fromkeys(positive)), list(dict.fromkeys(negative))


def _action(
    *,
    snapshot: QuantFeatureSnapshot,
    final_score: float | None,
    confidence: float,
    risk: float | None,
    entry_quality: float | None,
    regime: MarketRegimeReport,
    setup: str,
    red_flags: list[str],
) -> str:
    if snapshot.feature_status in HARD_DATA_STATUSES or final_score is None:
        return "INSUFFICIENT_DATA"
    if risk is None or entry_quality is None:
        return "WATCH_FOR_ENTRY"
    critical = {"FALLING_KNIFE", "SEVERE_DOWNTREND", "LOW_LIQUIDITY", "MARKET_REGIME_CONFLICT"}
    if risk >= 85 or critical.intersection(red_flags):
        return "AVOID"
    if regime.regime in {"CAUTION", "BEAR", "HIGH_VOLATILITY", "RISK_OFF"} or risk >= 70:
        return "CAUTION"
    if final_score >= 85 and confidence >= 85 and risk <= 40 and entry_quality >= 70 and setup in {"CONFIRMED_BREAKOUT", "TREND_CONTINUATION", "CONFIRMED_REVERSAL"}:
        return "STRONG_BUY_CANDIDATE"
    if final_score >= 75 and confidence >= 75 and risk <= 55 and entry_quality >= 60 and setup != "BREAKOUT_WITHOUT_VOLUME":
        return "BUY_CANDIDATE"
    if final_score < 45:
        return "AVOID"
    return "WATCH_FOR_ENTRY"


def score_symbol(
    snapshot: QuantFeatureSnapshot,
    context: SymbolContextSnapshot,
    regime: MarketRegimeReport,
    *,
    generated_at: datetime | None = None,
) -> ArgentumScoreCard:
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    components = ComponentScores(
        trend=_rounded(_trend_score(snapshot)),
        momentum=_rounded(_momentum_score(snapshot)),
        volume=_rounded(_volume_score(snapshot)),
        relative_strength=_rounded(_relative_strength_score(snapshot)),
        volatility=_rounded(_volatility_score(snapshot)),
        fundamentals=_rounded(_fundamental_score(context)),
        sentiment=_rounded(_sentiment_score(context)),
        institutional=_rounded(_institutional_score(context)),
        entry_quality=_rounded(_entry_quality_score(snapshot)),
    )
    component_values = asdict(components)
    quant_score = weighted_available(component_values, QUANT_WEIGHTS)
    quality_score = weighted_available(
        {
            "quant": quant_score,
            "fundamentals": components.fundamentals,
            "sentiment": components.sentiment,
            "institutional": components.institutional,
            "entry_quality": components.entry_quality,
        },
        QUALITY_WEIGHTS,
    )
    market_score = _regime_score(regime)
    risk = _risk_score(snapshot, context, regime)
    final_score = weighted_available(
        {"quality": quality_score, "market_regime": market_score, "risk_safety": (100.0 - risk) if risk is not None else None},
        FINAL_WEIGHTS,
    )
    conflicts = _conflicts(snapshot, context, regime)
    confidence, conflict_penalty = _confidence(snapshot, context, components, conflicts)
    setup = _entry_setup(snapshot)
    red_flags = _red_flags(snapshot, context, regime, setup)
    positive, negative = _factors(snapshot, context, components, conflicts)
    action = _action(
        snapshot=snapshot,
        final_score=final_score,
        confidence=confidence,
        risk=risk,
        entry_quality=components.entry_quality,
        regime=regime,
        setup=setup,
        red_flags=red_flags,
    )
    return ArgentumScoreCard(
        version=1,
        symbol=snapshot.symbol,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        components=components,
        quant_score=_rounded(quant_score),
        confidence_score=round(confidence, 2),
        risk_score=_rounded(risk),
        market_regime_score=_rounded(market_score),
        final_score=_rounded(final_score),
        conflict_penalty=round(conflict_penalty, 2),
        entry_setup=setup,
        action=action,
        positive_factors=tuple(positive),
        negative_factors=tuple(negative),
        red_flags=tuple(red_flags),
        methodology={
            "normalization": "continuous tanh/volatility-normalized features with bounded 0-100 outputs; missing components are excluded, never zero-filled",
            "quant_weights": QUANT_WEIGHTS,
            "quality_weights": QUALITY_WEIGHTS,
            "final_weights": FINAL_WEIGHTS,
            "confidence": "data quality, history, availability, timeframe agreement, signal agreement, and explicit conflict penalty",
            "execution": "analytical action only; never bypasses Human Gate or broker review",
        },
    )
