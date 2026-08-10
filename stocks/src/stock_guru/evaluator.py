from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

import pandas as pd

from .config import REPORT_DIR, Settings
from .data import MarketData, field_for


EVALUATIONS_PATH = REPORT_DIR / "evaluations.json"

VALID_BUY_SETUP = "VALID_BUY_SETUP"
WATCH_ONLY = "WATCH_ONLY"
REJECT = "REJECT"
VALID_SELL_SIGNAL = "VALID_SELL_SIGNAL"
HELD_STOP_LOSS_PCT = 0.02
HELD_PROFIT_TARGET_PCT = 0.03
HELD_PROFIT_LOCK_PCT = 0.02


@dataclass(frozen=True)
class QuoteSnapshot:
    ticker: str
    bid: float | None = None
    ask: float | None = None
    last: float | None = None
    data_fresh: bool = True


@dataclass(frozen=True)
class PositionSnapshot:
    ticker: str
    shares: float
    average_cost: float


@dataclass(frozen=True)
class IndicatorSnapshot:
    ticker: str
    current_price: float
    previous_close: float
    daily_high: float
    daily_low: float
    volume: float
    average_volume: float
    relative_volume: float
    dollar_volume: float
    vwap: float
    ema9: float
    ema20: float
    sma50: float
    sma200: float
    rsi: float
    macd: float
    macd_signal: float
    atr: float
    support: float
    resistance: float
    swing_high: float
    swing_low: float
    percent_change_today: float
    gap_percent: float
    trend_direction: str
    data_fresh: bool


@dataclass(frozen=True)
class TradeEvaluation:
    ticker: str
    decision: str
    setup_type: str
    score: int
    confidence: str
    current_price: float
    entry_zone: str
    stop_loss: float
    target_1: float
    target_2: float
    risk_reward: str
    market_condition: str
    volume_confirmation: bool
    trend_confirmation: bool
    liquidity_passed: bool
    spread_passed: bool
    data_fresh: bool
    hard_rejection_triggered: bool
    rejection_reason: str
    main_reason_valid: str
    main_risk: str
    invalidation_rule: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def round_price(value: float) -> float:
    return round(float(value), 4)


def percent_change(series: pd.Series, days: int) -> float:
    if len(series) <= days:
        return 0.0
    return float(series.iloc[-1] / series.iloc[-days - 1] - 1)


def is_fresh(series: pd.Series, *, max_age_days: int = 7, now: datetime | None = None) -> bool:
    if series.empty:
        return False
    latest = series.index[-1]
    if not hasattr(latest, "to_pydatetime"):
        return True
    latest_dt = latest.to_pydatetime()
    if latest_dt.tzinfo is None:
        latest_dt = latest_dt.replace(tzinfo=timezone.utc)
    evaluated_at = now or datetime.now(timezone.utc)
    if evaluated_at.tzinfo is None:
        evaluated_at = evaluated_at.replace(tzinfo=timezone.utc)
    age_seconds = (evaluated_at.astimezone(timezone.utc) - latest_dt.astimezone(timezone.utc)).total_seconds()
    return 0 <= age_seconds <= max_age_days * 24 * 60 * 60


def rsi(close: pd.Series, period: int = 14) -> float:
    delta = close.diff().dropna()
    if len(delta) < period:
        return 50.0
    gains = delta.clip(lower=0).tail(period).mean()
    losses = -delta.clip(upper=0).tail(period).mean()
    if losses == 0:
        return 100.0
    return float(100 - (100 / (1 + gains / losses)))


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    if len(close) < 2:
        return 0.0
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return float(true_range.dropna().tail(period).mean()) if not true_range.dropna().empty else 0.0


def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, period: int = 20) -> float:
    typical = (high + low + close) / 3
    volume_tail = volume.tail(period)
    typical_tail = typical.tail(period)
    total_volume = float(volume_tail.sum())
    if total_volume <= 0:
        return float(close.iloc[-1])
    return float((typical_tail * volume_tail).sum() / total_volume)


def macd_values(close: pd.Series) -> tuple[float, float]:
    if len(close) < 35:
        return 0.0, 0.0
    macd_line = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd_line.ewm(span=9, adjust=False).mean()
    return float(macd_line.iloc[-1]), float(signal.iloc[-1])


def trend_direction(close: pd.Series, ema20: float, sma50: float, sma200: float) -> str:
    price = float(close.iloc[-1])
    if price > ema20 > sma50 and (len(close) < 200 or sma50 > sma200):
        return "uptrend"
    if price < ema20 < sma50 and (len(close) < 200 or sma50 < sma200):
        return "downtrend"
    return "sideways"


def build_indicator_snapshot(data: MarketData, ticker: str, *, now: datetime | None = None) -> IndicatorSnapshot | None:
    try:
        close = field_for(data.history, ticker, "Close")
        high = field_for(data.history, ticker, "High")
        low = field_for(data.history, ticker, "Low")
        volume = field_for(data.history, ticker, "Volume")
    except Exception:
        return None

    if len(close) < 50 or high.empty or low.empty or volume.empty:
        return None

    price = float(close.iloc[-1])
    previous = float(close.iloc[-2]) if len(close) > 1 else price
    ema9 = float(close.ewm(span=9, adjust=False).mean().iloc[-1])
    ema20 = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
    sma50 = float(close.tail(50).mean())
    sma200 = float(close.tail(200).mean()) if len(close) >= 200 else sma50
    macd_line, macd_signal = macd_values(close)
    avg_volume = float(volume.tail(20).mean())
    latest_volume = float(volume.iloc[-1])
    relative_volume = latest_volume / avg_volume if avg_volume > 0 else 0.0
    support = float(low.tail(20).min())
    resistance = float(high.tail(20).max())
    day_high = float(high.iloc[-1])
    day_low = float(low.iloc[-1])
    return IndicatorSnapshot(
        ticker=ticker,
        current_price=price,
        previous_close=previous,
        daily_high=day_high,
        daily_low=day_low,
        volume=latest_volume,
        average_volume=avg_volume,
        relative_volume=relative_volume,
        dollar_volume=price * avg_volume,
        vwap=vwap(high, low, close, volume),
        ema9=ema9,
        ema20=ema20,
        sma50=sma50,
        sma200=sma200,
        rsi=rsi(close),
        macd=macd_line,
        macd_signal=macd_signal,
        atr=atr(high, low, close),
        support=support,
        resistance=resistance,
        swing_high=resistance,
        swing_low=support,
        percent_change_today=(price / previous - 1) if previous else 0.0,
        gap_percent=0.0,
        trend_direction=trend_direction(close, ema20, sma50, sma200),
        data_fresh=is_fresh(close, now=now),
    )


def market_condition(data: MarketData, *, now: datetime | None = None) -> str:
    snapshots: dict[str, IndicatorSnapshot] = {}
    for ticker in ["SPY", "QQQ", "^VIX"]:
        snapshot = build_indicator_snapshot(data, ticker, now=now)
        if snapshot is not None:
            snapshots[ticker] = snapshot

    spy = snapshots.get("SPY")
    qqq = snapshots.get("QQQ")
    vix = snapshots.get("^VIX")
    if vix and (vix.current_price >= 30 or percent_change(field_for(data.history, "^VIX", "Close"), 5) > 0.15):
        return "high volatility danger"
    if not spy or not qqq:
        return "sideways / choppy"

    spy_momo = percent_change(field_for(data.history, "SPY", "Close"), 20)
    qqq_momo = percent_change(field_for(data.history, "QQQ", "Close"), 20)
    if spy.trend_direction == "uptrend" and qqq.trend_direction == "uptrend" and spy_momo > 0 and qqq_momo > 0:
        return "strong bullish trend"
    if spy.trend_direction == "downtrend" and qqq.trend_direction == "downtrend" and spy_momo < 0 and qqq_momo < 0:
        return "strong bearish trend"
    if spy_momo > 0 and qqq_momo > 0:
        return "weak bullish trend"
    if spy_momo < 0 and qqq_momo < 0:
        return "weak bearish trend"
    if spy.relative_volume < 0.7 and qqq.relative_volume < 0.7:
        return "low volume / no edge"
    return "sideways / choppy"


def detect_setup(indicators: IndicatorSnapshot, market: str) -> str:
    price = indicators.current_price
    near_support = price <= indicators.support + max(indicators.atr, price * 0.015)
    near_resistance = price >= indicators.resistance - max(indicators.atr, price * 0.015)
    reclaim_vwap = price > indicators.vwap and indicators.previous_close < indicators.vwap
    volume_confirmed = indicators.relative_volume >= 1.0
    macd_bullish = indicators.macd >= indicators.macd_signal

    if reclaim_vwap and volume_confirmed and "bearish" not in market:
        return "VWAP Reclaim"
    if indicators.trend_direction == "uptrend" and near_support and indicators.rsi >= 40:
        return "Pullback to Support"
    if near_resistance and price > indicators.resistance * 0.995 and volume_confirmed:
        return "Breakout + Retest"
    if indicators.trend_direction == "uptrend" and price > indicators.ema9 > indicators.ema20 and macd_bullish:
        return "Trend Continuation"
    if indicators.trend_direction == "downtrend" and near_support and indicators.rsi < 40 and macd_bullish:
        return "Reversal Near Support"
    return "Avoid / No Trade"


def spread_passed(quote: QuoteSnapshot | None, price: float) -> bool:
    if quote is None or quote.bid is None or quote.ask is None:
        return True
    if quote.bid <= 0 or quote.ask <= 0 or quote.ask < quote.bid:
        return False
    spread_pct = (quote.ask - quote.bid) / price if price > 0 else 1.0
    return spread_pct <= 0.01


def risk_plan(indicators: IndicatorSnapshot) -> tuple[float, float, float, float]:
    stop = min(indicators.support - indicators.atr * 0.15, indicators.current_price - indicators.atr)
    if stop <= 0 or stop >= indicators.current_price:
        stop = indicators.current_price * 0.98
    risk = max(0.0, indicators.current_price - stop)
    target_1 = indicators.current_price + risk * 2
    target_2 = indicators.current_price + risk * 3
    ratio = (target_1 - indicators.current_price) / risk if risk > 0 else 0.0
    return stop, target_1, target_2, ratio


def score_setup(
    indicators: IndicatorSnapshot,
    *,
    setup_type: str,
    market: str,
    volume_confirmation: bool,
    trend_confirmation: bool,
    liquidity_passed: bool,
    spread_ok: bool,
    risk_reward_ratio: float,
) -> int:
    score = 0
    if trend_confirmation:
        score += 15
    elif indicators.trend_direction == "sideways":
        score += 6
    if "bullish" in market:
        score += 10
    elif "sideways" in market:
        score += 4
    if volume_confirmation:
        score += 15
    elif indicators.relative_volume >= 0.8:
        score += 8
    if setup_type != "Avoid / No Trade":
        score += 15
    if indicators.current_price > indicators.vwap and indicators.ema9 >= indicators.ema20:
        score += 10
    if risk_reward_ratio >= 3:
        score += 15
    elif risk_reward_ratio >= 2:
        score += 12
    if liquidity_passed and spread_ok:
        score += 10
    elif liquidity_passed:
        score += 6
    score += 3
    if setup_type != "Avoid / No Trade" and abs(indicators.current_price - indicators.support) <= indicators.atr * 2.5:
        score += 5
    return min(100, max(0, score))


def held_position_exit_reason(
    indicators: IndicatorSnapshot,
    settings: Settings,
    *,
    market: str,
    position: PositionSnapshot,
    planned_stop: float,
) -> str:
    price = indicators.current_price
    average_cost = position.average_cost
    stop_pct = min(max(settings.stop_loss_pct, 0.001), HELD_STOP_LOSS_PCT)
    hard_stop = average_cost * (1 - stop_pct)
    technical_stop = planned_stop if planned_stop > 0 else hard_stop
    effective_stop = max(hard_stop, technical_stop)
    profit_target = average_cost * (1 + HELD_PROFIT_TARGET_PCT)
    extended_profit_target = average_cost * (1 + HELD_PROFIT_TARGET_PCT * 2)
    profit_lock = average_cost * (1 + HELD_PROFIT_LOCK_PCT)
    momentum_breakdown = (
        price < indicators.vwap
        or indicators.ema9 < indicators.ema20
        or indicators.rsi < 50
        or indicators.macd < indicators.macd_signal
    )

    if price <= effective_stop:
        if price <= hard_stop:
            return f"held position hit {stop_pct:.0%} hard stop"
        return "held position lost technical stop"
    if price >= extended_profit_target:
        return "held position reached second profit target"
    if price >= profit_target and (momentum_breakdown or indicators.trend_direction != "uptrend"):
        return "held position reached profit target with weakening momentum"
    if price >= profit_lock and momentum_breakdown:
        return "held position gain is fading; lock profit"
    if price < indicators.vwap < indicators.ema20:
        return "held position lost VWAP and EMA20"
    if market in {"strong bearish trend", "high volatility danger"}:
        return f"market is {market}; reduce held position risk"
    return ""


def confidence_for(score: int, data_fresh: bool, quote: QuoteSnapshot | None) -> str:
    if not data_fresh:
        return "low"
    if score >= 85 and (quote is None or quote.data_fresh):
        return "high"
    if score >= 65:
        return "medium"
    return "low"


def rejection_reason(
    indicators: IndicatorSnapshot,
    *,
    setup_type: str,
    market: str,
    liquidity_passed: bool,
    spread_ok: bool,
    risk_reward_ratio: float,
    settings: Settings,
) -> str:
    if not indicators.data_fresh:
        return "critical price data is stale"
    if indicators.current_price < settings.min_price:
        return "price below minimum"
    if not liquidity_passed:
        return "volume/liquidity below minimum"
    if not spread_ok:
        return "bid-ask spread too wide"
    if setup_type == "Avoid / No Trade":
        return "no clean technical setup"
    if risk_reward_ratio < 2:
        return "risk/reward below 2:1"
    if market in {"strong bearish trend", "high volatility danger"}:
        return "market condition strongly disagrees"
    if indicators.current_price > indicators.ema20 + indicators.atr * 3:
        return "entry is overextended"
    return ""


def evaluate_ticker(
    indicators: IndicatorSnapshot,
    settings: Settings,
    *,
    market: str,
    quote: QuoteSnapshot | None = None,
    position: PositionSnapshot | None = None,
) -> TradeEvaluation:
    setup_type = detect_setup(indicators, market)
    stop, target_1, target_2, rr_ratio = risk_plan(indicators)
    volume_confirmation = indicators.relative_volume >= 1.0
    trend_confirmation = indicators.trend_direction == "uptrend"
    liquidity_passed = indicators.dollar_volume >= settings.min_dollar_volume
    spread_ok = spread_passed(quote, indicators.current_price)
    data_fresh = indicators.data_fresh and (quote.data_fresh if quote else True)
    reject = rejection_reason(
        indicators,
        setup_type=setup_type,
        market=market,
        liquidity_passed=liquidity_passed,
        spread_ok=spread_ok,
        risk_reward_ratio=rr_ratio,
        settings=settings,
    )
    score = score_setup(
        indicators,
        setup_type=setup_type,
        market=market,
        volume_confirmation=volume_confirmation,
        trend_confirmation=trend_confirmation,
        liquidity_passed=liquidity_passed,
        spread_ok=spread_ok,
        risk_reward_ratio=rr_ratio,
    )

    decision = REJECT if reject else WATCH_ONLY
    held_exit_reason = (
        held_position_exit_reason(indicators, settings, market=market, position=position, planned_stop=stop)
        if position
        else ""
    )
    if position and held_exit_reason:
        decision = VALID_SELL_SIGNAL
        setup_type = "Exit Signal"
        reject = ""
        score = max(score, 75)
    elif position:
        decision = WATCH_ONLY if not reject else REJECT
    elif not reject and score >= 75:
        decision = VALID_BUY_SETUP
    elif not reject and score >= 60:
        decision = WATCH_ONLY
    elif reject:
        decision = REJECT

    hard_rejection = decision == REJECT and bool(reject)
    main_reason = setup_type if decision != REJECT else ""
    if decision == VALID_BUY_SETUP:
        main_reason = f"{setup_type} with trend/volume/risk structure aligned"
    elif decision == VALID_SELL_SIGNAL:
        main_reason = held_exit_reason or "exit rule triggered for held position"
    elif position and decision == WATCH_ONLY:
        main_reason = "hold existing position; no exit rule triggered"

    main_risk = "setup can fail if price loses support or VWAP"
    if market in {"sideways / choppy", "low volume / no edge"}:
        main_risk = f"market is {market}"
    if not volume_confirmation:
        main_risk = "volume has not confirmed the move"

    return TradeEvaluation(
        ticker=indicators.ticker,
        decision=decision,
        setup_type=setup_type,
        score=score,
        confidence=confidence_for(score, data_fresh, quote),
        current_price=round_price(indicators.current_price),
        entry_zone=f"{round_price(indicators.current_price * 0.995)}-{round_price(indicators.current_price * 1.005)}",
        stop_loss=round_price(stop),
        target_1=round_price(target_1),
        target_2=round_price(target_2),
        risk_reward=f"1:{rr_ratio:.1f}" if rr_ratio > 0 else "",
        market_condition=market,
        volume_confirmation=volume_confirmation,
        trend_confirmation=trend_confirmation,
        liquidity_passed=liquidity_passed,
        spread_passed=spread_ok,
        data_fresh=data_fresh,
        hard_rejection_triggered=hard_rejection,
        rejection_reason=reject,
        main_reason_valid=main_reason,
        main_risk=main_risk,
        invalidation_rule=f"Invalid below {round_price(stop)} or if original setup no longer holds.",
    )


def evaluate_market_data(
    data: MarketData,
    settings: Settings,
    *,
    quote_snapshots: Mapping[str, QuoteSnapshot] | None = None,
    positions: Mapping[str, PositionSnapshot] | None = None,
    now: datetime | None = None,
) -> list[TradeEvaluation]:
    market = market_condition(data, now=now)
    quotes = quote_snapshots or {}
    held = positions or {}
    evaluations: list[TradeEvaluation] = []
    for ticker in data.tickers:
        if ticker in {"SPY", "QQQ", "^VIX"}:
            continue
        indicators = build_indicator_snapshot(data, ticker, now=now)
        if indicators is None:
            evaluations.append(
                TradeEvaluation(
                    ticker=ticker,
                    decision=REJECT,
                    setup_type="Avoid / No Trade",
                    score=0,
                    confidence="low",
                    current_price=0.0,
                    entry_zone="",
                    stop_loss=0.0,
                    target_1=0.0,
                    target_2=0.0,
                    risk_reward="",
                    market_condition=market,
                    volume_confirmation=False,
                    trend_confirmation=False,
                    liquidity_passed=False,
                    spread_passed=False,
                    data_fresh=False,
                    hard_rejection_triggered=True,
                    rejection_reason="critical OHLCV data missing",
                    main_reason_valid="",
                    main_risk="missing data",
                    invalidation_rule="Do not trade without complete fresh data.",
                )
            )
            continue
        evaluations.append(
            evaluate_ticker(
                indicators,
                settings,
                market=market,
                quote=quotes.get(ticker),
                position=held.get(ticker),
            )
        )
    return sorted(evaluations, key=evaluation_sort_key)


def evaluation_sort_key(item: TradeEvaluation) -> tuple[int, int, str]:
    decision_priority = {VALID_SELL_SIGNAL: 0, VALID_BUY_SETUP: 1, WATCH_ONLY: 2, REJECT: 3}
    return decision_priority.get(item.decision, 4), -item.score, item.ticker


def write_evaluations_json(evaluations: Sequence[TradeEvaluation], path: Path = EVALUATIONS_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [evaluation.to_dict() for evaluation in evaluations]
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path
