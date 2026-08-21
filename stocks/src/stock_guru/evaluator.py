from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping, Sequence

import pandas as pd

from .config import REPORT_DIR, Settings
from .data import MarketData, field_for
from .market_data_quality import DataQualityReport, assess_market_data
from .quant.engine import build_quant_snapshot, build_quant_snapshots
from .quant.indicators import macd as quant_macd, period_return, volume_weighted_average_price, wilder_atr, wilder_rsi
from .quant.models import QuantFeatureSnapshot


EVALUATIONS_PATH = REPORT_DIR / "evaluations.json"

VALID_BUY_SETUP = "VALID_BUY_SETUP"
WATCH_ONLY = "WATCH_ONLY"
REJECT = "REJECT"
VALID_SELL_SIGNAL = "VALID_SELL_SIGNAL"
HELD_STOP_LOSS_PCT = 0.02
HELD_PROFIT_TARGET_PCT = 0.03
HELD_PROFIT_LOCK_PCT = 0.02
NON_CANDIDATE_CONTEXT_SYMBOLS = {
    "SPY", "QQQ", "IWM", "^VIX", "^VXN",
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
}


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
    sma200: float | None
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
    data_provider: str = "UNKNOWN"
    data_feed_type: str = "UNKNOWN"
    data_source_timestamp: str | None = None
    data_received_at: str | None = None
    data_health_state: str = "UNKNOWN"
    data_quality_score: int | None = None
    data_fallback_from: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def round_price(value: float) -> float:
    return round(float(value), 4)


def percent_change(series: pd.Series, days: int) -> float:
    value = period_return(series, days)
    return value if value is not None else 0.0


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


def symbol_history(history: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Return only one symbol's columns while preserving the provider shape."""
    if history.empty or not isinstance(history.columns, pd.MultiIndex):
        return history.copy()
    columns = [
        column
        for column in history.columns
        if ticker in {str(value).upper() for value in column}
    ]
    return history.loc[:, columns].copy() if columns else pd.DataFrame(index=history.index)


def symbol_data_quality(data: MarketData, ticker: str, *, now: datetime | None = None) -> DataQualityReport | None:
    """Re-score execution quality for the exact symbol, not the whole scan batch.

    A 200-symbol scan can legitimately contain one unavailable or malformed
    ticker. That defect must stay attached to that ticker instead of forcing
    every otherwise coherent symbol in the batch to DATA_PARTIAL/REJECT.
    Provider-validation issues remain in scope because they describe the
    provenance of the selected feed rather than an unrelated symbol's bars.
    """
    if data.quality is None:
        return None
    normalized = str(ticker or "").upper()
    scoped_external_issues = tuple(
        issue
        for issue in data.quality.issues
        if (
            (issue.symbol is not None and str(issue.symbol).upper() == normalized)
            or (issue.symbol is None and issue.code.startswith("PROVIDER_"))
        )
    )
    checked_at = now
    if checked_at is None:
        try:
            checked_at = datetime.fromisoformat(data.quality.checked_at)
        except (TypeError, ValueError):
            checked_at = datetime.now(timezone.utc)
    interval = data.provenance.interval if data.provenance else "1d"
    return assess_market_data(
        symbol_history(data.history, normalized),
        [normalized],
        interval=interval,
        now=checked_at,
        external_issues=scoped_external_issues,
    )


def rsi(close: pd.Series, period: int = 14) -> float:
    value = wilder_rsi(close, period)
    return value if value is not None else 50.0


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    value = wilder_atr(high, low, close, period)
    return value if value is not None else 0.0


def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, period: int = 20) -> float:
    value = volume_weighted_average_price(high, low, close, volume, period)
    return value if value is not None else float(close.iloc[-1])


def macd_values(close: pd.Series) -> tuple[float, float]:
    line, signal, _ = quant_macd(close)
    return (line if line is not None else 0.0, signal if signal is not None else 0.0)


def trend_direction(close: pd.Series, ema20: float, sma50: float, sma200: float) -> str:
    price = float(close.iloc[-1])
    if price > ema20 > sma50 and (len(close) < 200 or sma50 > sma200):
        return "uptrend"
    if price < ema20 < sma50 and (len(close) < 200 or sma50 < sma200):
        return "downtrend"
    return "sideways"


def build_indicator_snapshot(
    data: MarketData,
    ticker: str,
    *,
    now: datetime | None = None,
    quant_snapshot: QuantFeatureSnapshot | None = None,
) -> IndicatorSnapshot | None:
    try:
        close = field_for(data.history, ticker, "Close")
        high = field_for(data.history, ticker, "High")
        low = field_for(data.history, ticker, "Low")
        volume = field_for(data.history, ticker, "Volume")
    except Exception:
        return None

    if len(close) < 50 or high.empty or low.empty or volume.empty:
        return None

    quant = quant_snapshot or build_quant_snapshot(data, ticker, generated_at=now)
    price = quant.price
    ema9 = quant.trend.exponential_moving_averages.get("ema9")
    ema20 = quant.trend.exponential_moving_averages.get("ema20")
    sma50 = quant.trend.simple_moving_averages.get("sma50")
    rsi14 = quant.momentum.rsi14
    macd_line = quant.momentum.macd_line
    macd_signal = quant.momentum.macd_signal
    atr14 = quant.volatility.atr14
    avg_volume = quant.volume.average_volume_20
    latest_volume = quant.volume.current_volume
    relative_volume = quant.volume.relative_volume_20
    weighted_price = quant.volume.volume_weighted_average_price_20
    required = (price, ema9, ema20, sma50, rsi14, macd_line, macd_signal, atr14, avg_volume, latest_volume, relative_volume, weighted_price)
    if any(value is None for value in required):
        return None

    previous = float(close.iloc[-2]) if len(close) > 1 else price
    sma200 = quant.trend.simple_moving_averages.get("sma200")
    # A new all-time high can legitimately have no overhead resistance zone,
    # and an overlay quote can arrive without rewriting the daily OHLC bar.
    # Retain the last observed rolling level in that case; it is real history,
    # not a fabricated replacement value.
    support = quant.support_zones[0].midpoint if quant.support_zones else float(low.tail(20).min())
    resistance = quant.resistance_zones[0].midpoint if quant.resistance_zones else float(high.tail(20).max())
    day_high = float(high.iloc[-1])
    day_low = float(low.iloc[-1])
    direction = "uptrend" if quant.trend.short_term == "BULLISH" and quant.trend.medium_term == "BULLISH" else "downtrend" if quant.trend.short_term == "BEARISH" and quant.trend.medium_term == "BEARISH" else "sideways"
    open_values = field_for(data.history, ticker, "Open")
    latest_open = float(open_values.iloc[-1]) if not open_values.empty else None
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
        vwap=float(weighted_price),
        ema9=ema9,
        ema20=ema20,
        sma50=sma50,
        sma200=sma200,
        rsi=float(rsi14),
        macd=float(macd_line),
        macd_signal=float(macd_signal),
        atr=float(atr14),
        support=support,
        resistance=resistance,
        swing_high=resistance,
        swing_low=support,
        percent_change_today=(price / previous - 1) if previous else 0.0,
        gap_percent=(latest_open / previous - 1.0) if latest_open is not None and previous > 0 else 0.0,
        trend_direction=direction,
        data_fresh=is_fresh(close, now=now),
    )


def market_condition(
    data: MarketData,
    *,
    now: datetime | None = None,
    quant_snapshots: Mapping[str, QuantFeatureSnapshot] | None = None,
) -> str:
    snapshots: dict[str, IndicatorSnapshot] = {}
    for ticker in ["SPY", "QQQ", "^VIX"]:
        snapshot = build_indicator_snapshot(data, ticker, now=now, quant_snapshot=(quant_snapshots or {}).get(ticker))
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
    progress_callback: Callable[[str, int, int], None] | None = None,
    quant_snapshots: Mapping[str, QuantFeatureSnapshot] | None = None,
) -> list[TradeEvaluation]:
    centralized_features = dict(quant_snapshots or build_quant_snapshots(data, data.tickers, generated_at=now))
    market = market_condition(data, now=now, quant_snapshots=centralized_features)
    quotes = quote_snapshots or {}
    held = positions or {}
    evaluations: list[TradeEvaluation] = []
    evaluation_tickers = [ticker for ticker in data.tickers if ticker not in NON_CANDIDATE_CONTEXT_SYMBOLS]
    total_tickers = len(evaluation_tickers)
    for ticker_index, ticker in enumerate(evaluation_tickers):
        if progress_callback is not None:
            progress_callback(ticker, ticker_index, total_tickers)
        indicators = build_indicator_snapshot(data, ticker, now=now, quant_snapshot=centralized_features.get(ticker))
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
        evaluation = evaluate_ticker(
            indicators,
            settings,
            market=market,
            quote=quotes.get(ticker),
            position=held.get(ticker),
        )
        evaluations.append(evaluation)

    if progress_callback is not None and evaluation_tickers:
        progress_callback(evaluation_tickers[-1], total_tickers, total_tickers)

    provenance = data.provenance
    enriched: list[TradeEvaluation] = []
    for evaluation in evaluations:
        quality = symbol_data_quality(data, evaluation.ticker, now=now)
        updates: dict[str, object] = {
            "data_provider": provenance.provider if provenance else "UNKNOWN",
            "data_feed_type": provenance.feed_type if provenance else "UNKNOWN",
            "data_source_timestamp": provenance.source_timestamp if provenance else None,
            "data_received_at": provenance.received_at if provenance else None,
            "data_health_state": quality.state.value if quality else "UNKNOWN",
            "data_quality_score": quality.score if quality else None,
            "data_fallback_from": provenance.fallback_from if provenance else (),
        }
        if quality is not None and not quality.is_usable:
            updates.update({
                "decision": REJECT,
                "confidence": "low",
                "data_fresh": False,
                "hard_rejection_triggered": True,
                "rejection_reason": f"market data health is {quality.state.value.lower()}",
                "main_reason_valid": "",
                "main_risk": "market-data provenance or quality failed the execution gate",
                "invalidation_rule": "Do not trade until a fresh, usable market-data snapshot passes quality checks.",
            })
        enriched.append(replace(evaluation, **updates))
    return sorted(enriched, key=evaluation_sort_key)


def evaluation_sort_key(item: TradeEvaluation) -> tuple[int, int, str]:
    decision_priority = {VALID_SELL_SIGNAL: 0, VALID_BUY_SETUP: 1, WATCH_ONLY: 2, REJECT: 3}
    return decision_priority.get(item.decision, 4), -item.score, item.ticker


def write_evaluations_json(evaluations: Sequence[TradeEvaluation], path: Path = EVALUATIONS_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [evaluation.to_dict() for evaluation in evaluations]
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path
