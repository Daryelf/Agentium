from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .config import Settings, TRADE_DIRECTION_LONG_ONLY, TRADING_MODE_INTRADAY
from .evaluator import IndicatorSnapshot, PositionSnapshot, QuoteSnapshot, detect_setup, risk_plan
from .lifecycle import DailyRiskState, LivePositionPlan, TradeIntent
from .market import parse_hhmm


INTRADAY_REJECT = "INTRADAY_REJECT"
INTRADAY_ALERT_ONLY = "INTRADAY_ALERT_ONLY"
AUTO_ORDER_READY = "AUTO_ORDER_READY"
LARGE_AUTO_ORDER_READY = "LARGE_AUTO_ORDER_READY"
INTRADAY_EXIT = "INTRADAY_EXIT"
INTRADAY_HOLD = "INTRADAY_HOLD"

ALLOWED_INTRADAY_SETUPS = {
    "Momentum Breakout",
    "VWAP Reclaim",
    "Opening Range Breakout",
    "Pullback Continuation",
    "News Momentum",
    "Sector Sympathy Momentum",
    "Trend Continuation",
    "Breakout + Retest",
    "Pullback to Support",
}


@dataclass(frozen=True)
class IntradayMarketContext:
    now: datetime
    market_condition: str
    spy_aligned: bool
    qqq_aligned: bool
    sector_aligned: bool = True
    news_verified: bool = True


@dataclass(frozen=True)
class IntradayExitDecision:
    symbol: str
    action: str
    reason: str
    price: float
    shares: float
    notional: float


def is_after_cutoff(settings: Settings, now: datetime, cutoff: str) -> bool:
    current = now.astimezone(ZoneInfo(settings.market_timezone))
    return current.time() >= parse_hhmm(cutoff)


def daily_risk_reasons(settings: Settings, state: DailyRiskState, *, account_value: float) -> list[str]:
    reasons: list[str] = []
    if state.locked:
        reasons.append(f"daily risk lockout active: {state.lockout_reason}")
    total_daily_pnl = state.realized_pnl + state.unrealized_pnl
    if account_value > 0 and total_daily_pnl <= -(account_value * settings.daily_loss_limit_pct):
        reasons.append("daily loss limit reached")
    if state.consecutive_losses >= settings.max_consecutive_losses:
        reasons.append("max consecutive losses reached")
    if state.trades_today >= settings.max_trades_per_day:
        reasons.append("max trades per day reached")
    return reasons


def spread_pct(quote: QuoteSnapshot | None, price: float) -> float:
    if quote is None or quote.bid is None or quote.ask is None or price <= 0:
        return 1.0
    if quote.bid <= 0 or quote.ask <= 0 or quote.ask < quote.bid:
        return 1.0
    return (quote.ask - quote.bid) / price


def intraday_score(
    indicators: IndicatorSnapshot,
    *,
    quote: QuoteSnapshot | None,
    setup_type: str,
    risk_reward_ratio: float,
    settings: Settings,
    context: IntradayMarketContext,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    def add(condition: bool, points: int, reason: str) -> None:
        nonlocal score
        if condition:
            score += points
        else:
            reasons.append(reason)

    quote_fresh = quote is not None and quote.data_fresh and quote.last is not None and quote.last > 0
    safe_spread = spread_pct(quote, indicators.current_price) <= settings.intraday_max_spread_pct
    add(indicators.data_fresh, 8, "real-time price data is stale")
    add(quote_fresh, 10, "quote data is missing or stale")
    add(safe_spread, 10, "bid-ask spread is unsafe")
    add(indicators.dollar_volume >= settings.min_dollar_volume, 10, "liquidity below minimum")
    add(indicators.relative_volume >= settings.intraday_min_relative_volume, 12, "relative volume below intraday threshold")
    add("bullish" in context.market_condition, 8, "market direction is not bullish")
    add(context.spy_aligned and context.qqq_aligned, 10, "SPY/QQQ are not aligned")
    add(context.sector_aligned, 6, "sector movement is not aligned")
    add(indicators.current_price > indicators.vwap, 10, "price is not above VWAP")
    add(setup_type in ALLOWED_INTRADAY_SETUPS, 10, "setup type is not allowed for intraday mode")
    add(risk_reward_ratio >= 2.0, 10, "risk/reward below 2:1")
    add(indicators.current_price <= indicators.ema20 + indicators.atr * 2.5, 4, "entry is too extended")
    add(context.news_verified, 4, "news is old or unverified")
    return min(score, 100), reasons


def evaluate_intraday_entry(
    indicators: IndicatorSnapshot,
    settings: Settings,
    *,
    quote: QuoteSnapshot | None,
    context: IntradayMarketContext,
    daily_risk: DailyRiskState,
    account_value: float,
    existing_position: PositionSnapshot | None = None,
    open_order_symbols: set[str] | None = None,
) -> TradeIntent:
    stop, target_1, target_2, rr_ratio = risk_plan(indicators)
    setup_type = intraday_setup_type(indicators, context.market_condition)
    score, reasons = intraday_score(
        indicators,
        quote=quote,
        setup_type=setup_type,
        risk_reward_ratio=rr_ratio,
        settings=settings,
        context=context,
    )

    if settings.trading_mode != TRADING_MODE_INTRADAY:
        reasons.append("trading mode is not intraday same-day")
    if settings.trade_direction != TRADE_DIRECTION_LONG_ONLY:
        reasons.append("unsupported trade direction")
    if existing_position is not None:
        reasons.append("existing position blocks automatic averaging down")
    if indicators.ticker in (open_order_symbols or set()):
        reasons.append("open order already exists for symbol")
    if is_after_cutoff(settings, context.now, settings.intraday_no_new_entries_after):
        reasons.append("new entries are blocked after intraday cutoff")
    if stop <= 0 or stop >= indicators.current_price:
        reasons.append("stop loss is unclear")
    if target_1 <= indicators.current_price:
        reasons.append("take profit is unclear")
    reasons.extend(daily_risk_reasons(settings, daily_risk, account_value=account_value))

    if reasons or score < settings.intraday_min_entry_score:
        if score < settings.intraday_min_entry_score:
            reasons.append(f"confidence score {score} below intraday threshold {settings.intraday_min_entry_score}")
        status = INTRADAY_REJECT
    elif score >= settings.intraday_large_size_score:
        status = LARGE_AUTO_ORDER_READY
    elif score >= settings.intraday_auto_order_score:
        status = AUTO_ORDER_READY
    else:
        status = INTRADAY_ALERT_ONLY

    shares_for_risk = 0.0
    if account_value > 0 and indicators.current_price > stop:
        shares_for_risk = (account_value * settings.risk_per_trade_pct) / (indicators.current_price - stop)
    risk_dollars = max(0.0, indicators.current_price - stop) * shares_for_risk
    return TradeIntent(
        symbol=indicators.ticker,
        side="buy",
        setup_type=setup_type,
        confidence_score=score,
        entry_price=round(indicators.current_price, 4),
        entry_zone=f"{round(indicators.current_price * 0.998, 4)}-{round(indicators.current_price * 1.002, 4)}",
        stop_price=round(stop, 4),
        target_1=round(target_1, 4),
        target_2=round(target_2, 4),
        risk_reward_ratio=round(rr_ratio, 2),
        risk_dollars=round(risk_dollars, 2),
        status=status,
        rejection_reasons=reasons,
        thesis=f"{setup_type}; intraday long-only; same-day exit required",
        created_at=context.now.isoformat(timespec="seconds"),
    )


def intraday_setup_type(indicators: IndicatorSnapshot, market: str) -> str:
    setup = detect_setup(indicators, market)
    if setup == "Breakout + Retest":
        return "Momentum Breakout"
    if setup == "Pullback to Support":
        return "Pullback Continuation"
    return setup


def evaluate_intraday_exit(
    position: LivePositionPlan,
    indicators: IndicatorSnapshot,
    settings: Settings,
    *,
    quote: QuoteSnapshot | None,
    context: IntradayMarketContext,
    daily_risk: DailyRiskState,
) -> IntradayExitDecision:
    price = indicators.current_price
    reason = ""
    if price <= position.stop_price:
        reason = "stop loss hit"
    elif price >= position.target_1:
        reason = "take profit hit"
    elif price < indicators.vwap:
        reason = "VWAP failed"
    elif indicators.macd < indicators.macd_signal or indicators.rsi < 50:
        reason = "momentum faded"
    elif "bearish" in context.market_condition or not (context.spy_aligned and context.qqq_aligned):
        reason = "market reversed"
    elif spread_pct(quote, price) > settings.intraday_max_spread_pct:
        reason = "spread became unsafe"
    elif daily_risk_reasons(settings, daily_risk, account_value=position.average_cost * position.shares):
        reason = "daily risk lockout triggered"
    elif is_after_cutoff(settings, context.now, settings.intraday_force_exit_after):
        reason = "end-of-day close rule"
    elif not position.allow_overnight and is_after_cutoff(settings, context.now, settings.regular_market_close):
        reason = "overnight hold blocked"

    action = INTRADAY_EXIT if reason else INTRADAY_HOLD
    return IntradayExitDecision(
        symbol=position.symbol,
        action=action,
        reason=reason or "no intraday exit rule triggered",
        price=price,
        shares=position.shares,
        notional=round(position.shares * price, 2),
    )
