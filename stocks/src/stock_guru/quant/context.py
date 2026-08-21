from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping

import pandas as pd

from ..catalysts import CatalystEvent, summarize_catalysts
from ..research import EquityResearch
from .models import QuantFeatureSnapshot


EARNINGS_NOT_APPLICABLE_SYMBOLS = {
    "SPY", "QQQ", "IWM", "DIA", "^VIX", "^VXN",
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
}

@dataclass(frozen=True)
class TimeframeConfirmation:
    short: str
    medium: str
    long: str
    alignment: str
    agreement_ratio: float | None
    conflicts: tuple[str, ...]


@dataclass(frozen=True)
class FundamentalContext:
    status: str
    available_fields: int
    total_fields: int
    revenue_growth: float | None
    earnings_growth: float | None
    eps_growth: float | None
    profit_margins: float | None
    operating_margins: float | None
    free_cash_flow: float | None
    total_debt: float | None
    debt_to_equity: float | None
    trailing_pe: float | None
    forward_pe: float | None
    peg_ratio: float | None
    price_to_sales: float | None
    enterprise_to_revenue: float | None
    market_cap: float | None
    valuation_context: str
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class EarningsRiskContext:
    next_earnings_at: str | None
    earnings_in_days: int | None
    earnings_risk: str
    source: str
    provider_conflict: bool
    exposure_policy: str


@dataclass(frozen=True)
class SentimentContext:
    status: str
    news_sentiment: str
    news_volume: int
    sentiment_change: float | None
    headline_consistency: float | None
    major_negative_event: bool
    major_positive_event: bool
    positive: int
    negative: int
    neutral: int
    confidence: float
    methodology: str


@dataclass(frozen=True)
class InstitutionalContext:
    status: str
    changes: int
    increases: int
    reductions: int
    new_positions: int
    exits: int
    newest_disclosed_at: str | None
    disclosure_age_days: int | None
    filing_age_days: int | None
    staleness: str
    portfolio_weight: float | None
    methodology: str


@dataclass(frozen=True)
class LiquidityContext:
    status: str
    price: float | None
    average_share_volume_20: float | None
    average_dollar_volume_20: float | None
    relative_volume_20: float | None
    spread_pct: float | None
    market_cap: float | None
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class SymbolContextSnapshot:
    version: int
    symbol: str
    generated_at: str
    timeframes: TimeframeConfirmation
    fundamentals: FundamentalContext
    earnings: EarningsRiskContext
    sentiment: SentimentContext
    institutional: InstitutionalContext
    liquidity: LiquidityContext

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def build_timeframe_confirmation(snapshot: QuantFeatureSnapshot) -> TimeframeConfirmation:
    values = {
        "short": snapshot.trend.short_term,
        "medium": snapshot.trend.medium_term,
        "long": snapshot.trend.long_term,
    }
    known = [value for value in values.values() if value != "UNKNOWN"]
    conflicts: list[str] = []
    if "BULLISH" in known and "BEARISH" in known:
        conflicts.append("Bullish and bearish timeframes disagree.")
    if snapshot.momentum.acceleration_state in {"FADING", "DETERIORATING"} and snapshot.trend.long_term == "BULLISH":
        conflicts.append("Long-term trend is bullish while short-term momentum is fading.")
    if snapshot.volume.price_volume_confirmation in {"WEAK_RALLY", "BEARISH_CONFIRMATION"} and snapshot.trend.short_term == "BULLISH":
        conflicts.append("Short-term bullish trend lacks price-volume confirmation.")
    if not known:
        alignment = "UNKNOWN"
        agreement = None
    else:
        counts = {state: known.count(state) for state in set(known)}
        agreement = max(counts.values()) / len(known)
        if conflicts:
            alignment = "CONFLICT"
        elif len(counts) == 1:
            alignment = "ALIGNED"
        else:
            alignment = "MIXED"
    return TimeframeConfirmation(
        short=values["short"],
        medium=values["medium"],
        long=values["long"],
        alignment=alignment,
        agreement_ratio=round(agreement, 4) if agreement is not None else None,
        conflicts=tuple(conflicts),
    )


def build_fundamental_context(research: EquityResearch | None) -> FundamentalContext:
    if research is None:
        return FundamentalContext(
            status="INSUFFICIENT_DATA",
            available_fields=0,
            total_fields=14,
            revenue_growth=None,
            earnings_growth=None,
            eps_growth=None,
            profit_margins=None,
            operating_margins=None,
            free_cash_flow=None,
            total_debt=None,
            debt_to_equity=None,
            trailing_pe=None,
            forward_pe=None,
            peg_ratio=None,
            price_to_sales=None,
            enterprise_to_revenue=None,
            market_cap=None,
            valuation_context="UNKNOWN",
            warnings=("Company fundamentals are unavailable.",),
        )
    values = {
        "revenue_growth": research.revenue_growth,
        "earnings_growth": research.earnings_growth,
        "eps_growth": research.eps_growth,
        "profit_margins": research.profit_margins,
        "operating_margins": research.operating_margins,
        "free_cash_flow": research.free_cash_flow,
        "total_debt": research.total_debt,
        "debt_to_equity": research.debt_to_equity,
        "trailing_pe": research.trailing_pe,
        "forward_pe": research.forward_pe,
        "peg_ratio": research.peg_ratio,
        "price_to_sales": research.price_to_sales,
        "enterprise_to_revenue": research.enterprise_to_revenue,
        "market_cap": research.market_cap,
    }
    available = sum(value is not None for value in values.values())
    status = "DATA_OK" if available >= 11 else "DATA_PARTIAL" if available >= 4 else "INSUFFICIENT_DATA"
    growth = research.revenue_growth
    pe = research.forward_pe if research.forward_pe is not None else research.trailing_pe
    if pe is None:
        valuation_context = "UNKNOWN"
    elif growth is not None and growth >= 0.2 and pe >= 30:
        valuation_context = "GROWTH_PREMIUM"
    elif growth is not None and growth <= 0.05 and pe >= 30:
        valuation_context = "EXPENSIVE_RELATIVE_TO_GROWTH"
    elif pe <= 15:
        valuation_context = "LOW_MULTIPLE_REQUIRES_QUALITY_REVIEW"
    else:
        valuation_context = "BALANCED_REVIEW_REQUIRED"
    warnings: list[str] = []
    if research.free_cash_flow is not None and research.free_cash_flow < 0:
        warnings.append("Free cash flow is negative.")
    if research.debt_to_equity is not None and research.debt_to_equity > 200:
        warnings.append("Debt-to-equity is elevated.")
    if research.revenue_growth is not None and research.revenue_growth < 0:
        warnings.append("Revenue growth is negative.")
    return FundamentalContext(status=status, available_fields=available, total_fields=len(values), valuation_context=valuation_context, warnings=tuple(warnings), **values)


def _utc_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("America/New_York")
    return parsed.tz_convert("UTC").to_pydatetime()


def build_earnings_risk(research: EquityResearch | None, *, now: datetime, symbol: str = "") -> EarningsRiskContext:
    if symbol.upper() in EARNINGS_NOT_APPLICABLE_SYMBOLS:
        return EarningsRiskContext(None, None, "NOT_APPLICABLE", "ASSET_TYPE", False, "STANDARD_TECHNICAL_REVIEW")
    current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    earnings_at = _utc_datetime(research.next_earnings_at) if research else None
    days = max(0, (earnings_at.date() - current.astimezone(timezone.utc).date()).days) if earnings_at is not None else None
    if days is None:
        risk = "UNKNOWN"
    elif days <= 3:
        risk = "HIGH"
    elif days <= 7:
        risk = "ELEVATED"
    elif days <= 14:
        risk = "MODERATE"
    else:
        risk = "NORMAL"
    conflict = bool(research.earnings_conflict) if research else False
    if conflict:
        risk = "HIGH"
    policy = "EXPLICIT_EARNINGS_EXPOSURE_DECISION_REQUIRED" if risk in {"HIGH", "ELEVATED", "UNKNOWN"} else "STANDARD_TECHNICAL_REVIEW"
    return EarningsRiskContext(
        next_earnings_at=earnings_at.isoformat() if earnings_at else None,
        earnings_in_days=days,
        earnings_risk=risk,
        source=research.earnings_source if research else "UNKNOWN",
        provider_conflict=conflict,
        exposure_policy=policy,
    )


def _signed_sentiment(event: CatalystEvent) -> float:
    direction = 1.0 if event.direction == "POSITIVE" else -1.0 if event.direction == "NEGATIVE" else 0.0
    return direction * event.confidence


def build_sentiment_context(events: Iterable[CatalystEvent]) -> SentimentContext:
    values = list(events)
    summary = summarize_catalysts(values)
    directional = [item for item in values if item.direction in {"POSITIVE", "NEGATIVE"} and item.freshness != "STALE"]
    recent = [item for item in directional if item.age_minutes is not None and item.age_minutes <= 6 * 60]
    older = [item for item in directional if item.age_minutes is not None and 6 * 60 < item.age_minutes <= 72 * 60]
    recent_mean = sum(_signed_sentiment(item) for item in recent) / len(recent) if recent else None
    older_mean = sum(_signed_sentiment(item) for item in older) / len(older) if older else None
    change = recent_mean - older_mean if recent_mean is not None and older_mean is not None else None
    consistency = None
    if directional:
        majority = max(summary.positive, summary.negative)
        consistency = majority / len(directional)
    if summary.score is None:
        sentiment = "UNKNOWN"
    elif summary.score >= 65:
        sentiment = "POSITIVE"
    elif summary.score <= 35:
        sentiment = "NEGATIVE"
    else:
        sentiment = "MIXED"
    major_types = {"REGULATORY", "LEGAL", "CAPITAL", "EARNINGS", "GUIDANCE"}
    return SentimentContext(
        status="DATA_OK" if values else "INSUFFICIENT_DATA",
        news_sentiment=sentiment,
        news_volume=len(values),
        sentiment_change=round(change, 4) if change is not None else None,
        headline_consistency=round(consistency, 4) if consistency is not None else None,
        major_negative_event=any(item.direction == "NEGATIVE" and item.catalyst_type in major_types and item.freshness != "STALE" for item in values),
        major_positive_event=any(item.direction == "POSITIVE" and item.catalyst_type in major_types and item.freshness != "STALE" for item in values),
        positive=summary.positive,
        negative=summary.negative,
        neutral=summary.neutral,
        confidence=summary.confidence,
        methodology="Structured timestamped catalyst evidence; sentiment never creates a BUY action by itself.",
    )


def _mapping_date(item: Mapping[str, object], *keys: str) -> datetime | None:
    for key in keys:
        parsed = _utc_datetime(item.get(key))
        if parsed is not None:
            return parsed
    return None


def build_institutional_context(
    symbol: str,
    changes: Iterable[Mapping[str, object]],
    *,
    now: datetime,
) -> InstitutionalContext:
    normalized = symbol.upper()
    relevant = [item for item in changes if str(item.get("symbol") or "").upper() == normalized]
    increases = reductions = new_positions = exits = 0
    disclosed_dates: list[datetime] = []
    report_dates: list[datetime] = []
    weights: list[float] = []
    for item in relevant:
        side = str(item.get("side") or item.get("change_type") or "").upper()
        prior_shares = item.get("previous_shares")
        current_shares = item.get("current_shares")
        if side in {"BUY", "INCREASED", "INCREASE"}:
            if prior_shares is not None and float(prior_shares or 0) == 0:
                new_positions += 1
            else:
                increases += 1
        elif side in {"SELL", "REDUCED", "REDUCE"}:
            if current_shares is not None and float(current_shares or 0) == 0:
                exits += 1
            else:
                reductions += 1
        disclosed = _mapping_date(item, "disclosed_at", "filing_date", "observed_at")
        report = _mapping_date(item, "report_date", "current_report_date", "period_end")
        if disclosed:
            disclosed_dates.append(disclosed)
        if report:
            report_dates.append(report)
        try:
            weight = float(item.get("portfolio_weight"))
        except (TypeError, ValueError):
            weight = float("nan")
        if pd.notna(weight):
            weights.append(weight)
    current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    newest_disclosed = max(disclosed_dates) if disclosed_dates else None
    newest_report = max(report_dates) if report_dates else None
    disclosure_age = max(0, (current.astimezone(timezone.utc).date() - newest_disclosed.date()).days) if newest_disclosed else None
    filing_age = max(0, (current.astimezone(timezone.utc).date() - newest_report.date()).days) if newest_report else None
    staleness = "UNKNOWN" if not relevant else "STALE" if filing_age is None or filing_age > 135 else "DELAYED"
    return InstitutionalContext(
        status="DATA_PARTIAL" if relevant else "INSUFFICIENT_DATA",
        changes=len(relevant),
        increases=increases,
        reductions=reductions,
        new_positions=new_positions,
        exits=exits,
        newest_disclosed_at=newest_disclosed.isoformat() if newest_disclosed else None,
        disclosure_age_days=disclosure_age,
        filing_age_days=filing_age,
        staleness=staleness,
        portfolio_weight=max(weights) if weights else None,
        methodology="13F is delayed research, can be filed up to 45 days after period end, and never overrides current market data.",
    )


def build_liquidity_context(
    snapshot: QuantFeatureSnapshot,
    *,
    spread_pct: float | None = None,
    market_cap: float | None = None,
) -> LiquidityContext:
    average_shares = snapshot.volume.average_volume_20
    dollar_volume = snapshot.price * average_shares if snapshot.price is not None and average_shares is not None else None
    warnings: list[str] = []
    if snapshot.price is not None and snapshot.price < 1:
        warnings.append("Sub-dollar price increases execution risk.")
    if dollar_volume is not None and dollar_volume < 1_000_000:
        warnings.append("Average dollar volume is below $1M.")
    if spread_pct is not None and spread_pct > 0.01:
        warnings.append("Bid-ask spread exceeds 1%.")
    if dollar_volume is None:
        status = "INSUFFICIENT_DATA"
    elif dollar_volume < 1_000_000 or (spread_pct is not None and spread_pct > 0.02):
        status = "LOW_LIQUIDITY"
    elif dollar_volume < 10_000_000 or (spread_pct is not None and spread_pct > 0.01):
        status = "THIN"
    else:
        status = "LIQUID"
    return LiquidityContext(
        status=status,
        price=snapshot.price,
        average_share_volume_20=average_shares,
        average_dollar_volume_20=dollar_volume,
        relative_volume_20=snapshot.volume.relative_volume_20,
        spread_pct=spread_pct,
        market_cap=market_cap,
        warnings=tuple(warnings),
    )


def build_symbol_context(
    snapshot: QuantFeatureSnapshot,
    *,
    research: EquityResearch | None = None,
    catalyst_events: Iterable[CatalystEvent] = (),
    institutional_changes: Iterable[Mapping[str, object]] = (),
    spread_pct: float | None = None,
    generated_at: datetime | None = None,
) -> SymbolContextSnapshot:
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return SymbolContextSnapshot(
        version=1,
        symbol=snapshot.symbol,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        timeframes=build_timeframe_confirmation(snapshot),
        fundamentals=build_fundamental_context(research),
        earnings=build_earnings_risk(research, now=at, symbol=snapshot.symbol),
        sentiment=build_sentiment_context(catalyst_events),
        institutional=build_institutional_context(snapshot.symbol, institutional_changes, now=at),
        liquidity=build_liquidity_context(snapshot, spread_pct=spread_pct, market_cap=research.market_cap if research else None),
    )
