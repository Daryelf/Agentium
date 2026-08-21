from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Mapping, Sequence

import pandas as pd

from ..data import MarketData, field_for
from .indicators import normalize_daily_index
from .models import QuantFeatureSnapshot
from .scoring import ArgentumScoreCard, clamp


@dataclass(frozen=True)
class AccountSnapshot:
    account_value: float | None
    buying_power: float | None
    cash: float | None
    settled_cash: float | None = None
    unsettled_funds: float | None = None
    total_invested: float | None = None
    day_trades_last_5_sessions: int | None = None
    open_orders: int | None = None


@dataclass(frozen=True)
class HoldingSnapshot:
    symbol: str
    market_value: float
    sector: str = "UNKNOWN"
    shares: float | None = None


@dataclass(frozen=True)
class PortfolioPolicy:
    max_position_pct: float = 0.10
    max_sector_pct: float = 0.30
    max_invested_pct: float = 0.80
    max_risk_pct: float = 0.0075
    max_new_positions_per_day: int = 3
    pdt_equity_threshold: float = 25_000.0
    pdt_max_day_trades: int = 3
    correlation_threshold: float = 0.75


@dataclass(frozen=True)
class PortfolioImpact:
    existing_position: bool
    current_invested_pct: float | None
    current_sector_pct: float | None
    projected_position_pct: float | None
    projected_sector_pct: float | None
    correlated_positions: tuple[str, ...]
    concentration_state: str
    pdt_warning: bool
    settlement_state: str
    available_to_allocate: float | None
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class PositionSizeSuggestion:
    symbol: str
    analytical_action: str
    suggested_position_pct: float | None
    suggested_dollars: float | None
    suggested_shares: float | None
    max_risk_pct: float
    risk_budget_dollars: float | None
    stop_price: float | None
    portfolio_impact: PortfolioImpact
    blockers: tuple[str, ...]
    execution_policy: str = "Suggestion only; Human Gate, fresh broker checks, broker review, and one-use dispatch remain mandatory."

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class CircuitBreakerInput:
    requested_mode: str = "OBSERVE"
    live_authorized: bool = False
    daily_pnl_pct: float | None = None
    daily_max_loss_pct: float = 0.02
    new_positions_today: int = 0
    max_new_positions_per_day: int = 3
    proposed_order_pct: float | None = None
    max_single_order_pct: float = 0.10
    provider_conflicts: int = 0
    repeated_provider_conflict_limit: int = 3
    portfolio_data_stale: bool = False
    broker_auth_healthy: bool = True


@dataclass(frozen=True)
class CircuitBreakerDecision:
    requested_mode: str
    effective_mode: str
    allow_new_positions: bool
    allow_risk_reducing_exits: bool
    reasons: tuple[str, ...]


def _number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _correlation(data: MarketData | None, left_symbol: str, right_symbol: str, period: int = 60) -> float | None:
    if data is None:
        return None
    try:
        left = normalize_daily_index(field_for(data.history, left_symbol, "Close")).pct_change().dropna().rename("left")
        right = normalize_daily_index(field_for(data.history, right_symbol, "Close")).pct_change().dropna().rename("right")
    except Exception:
        return None
    aligned = pd.concat([left, right], axis=1, join="inner").dropna().tail(period)
    if len(aligned) < 20:
        return None
    return _number(aligned["left"].corr(aligned["right"]))


def build_portfolio_impact(
    symbol: str,
    sector: str,
    account: AccountSnapshot,
    holdings: Sequence[HoldingSnapshot],
    *,
    proposed_dollars: float | None,
    market_data: MarketData | None = None,
    policy: PortfolioPolicy = PortfolioPolicy(),
) -> PortfolioImpact:
    normalized_symbol = symbol.upper()
    account_value = _number(account.account_value)
    buying_power = _number(account.buying_power)
    settled_cash = _number(account.settled_cash)
    invested = _number(account.total_invested)
    if invested is None:
        invested = sum(max(0.0, holding.market_value) for holding in holdings)
    existing = any(holding.symbol.upper() == normalized_symbol and holding.market_value > 0 for holding in holdings)
    sector_value = sum(max(0.0, holding.market_value) for holding in holdings if holding.sector.lower() == sector.lower())
    current_invested_pct = invested / account_value if account_value and account_value > 0 else None
    current_sector_pct = sector_value / account_value if account_value and account_value > 0 else None
    projected_position_pct = proposed_dollars / account_value if proposed_dollars is not None and account_value and account_value > 0 else None
    projected_sector_pct = (sector_value + (proposed_dollars or 0.0)) / account_value if account_value and account_value > 0 else None
    correlations: list[str] = []
    for holding in holdings:
        if holding.symbol.upper() == normalized_symbol or holding.market_value <= 0:
            continue
        correlation = _correlation(market_data, normalized_symbol, holding.symbol.upper())
        if correlation is not None and correlation >= policy.correlation_threshold:
            correlations.append(holding.symbol.upper())
    warnings: list[str] = []
    if existing:
        warnings.append("Portfolio already owns this symbol.")
    if projected_position_pct is not None and projected_position_pct > policy.max_position_pct:
        warnings.append("Projected single-stock exposure exceeds policy.")
    if projected_sector_pct is not None and projected_sector_pct > policy.max_sector_pct:
        warnings.append("Projected sector exposure exceeds policy.")
    if current_invested_pct is not None and proposed_dollars is not None and current_invested_pct + proposed_dollars / account_value > policy.max_invested_pct:
        warnings.append("Projected invested capital exceeds policy.")
    if correlations:
        warnings.append("Candidate is highly correlated with existing holdings: " + ", ".join(sorted(correlations)) + ".")
    pdt_warning = bool(
        account_value is not None
        and account_value < policy.pdt_equity_threshold
        and account.day_trades_last_5_sessions is not None
        and account.day_trades_last_5_sessions >= policy.pdt_max_day_trades
    )
    if pdt_warning:
        warnings.append("PDT limit may block a same-day round trip; default to a swing horizon.")
    if settled_cash is None:
        settlement_state = "UNKNOWN"
        available = buying_power
    else:
        settlement_state = "SETTLED_ONLY" if account.unsettled_funds and account.unsettled_funds > 0 else "SETTLED"
        available = min(value for value in (buying_power, settled_cash) if value is not None) if buying_power is not None else settled_cash
    concentration = "HIGH" if any("exceeds policy" in warning for warning in warnings) else "ELEVATED" if correlations or existing else "NORMAL"
    return PortfolioImpact(
        existing_position=existing,
        current_invested_pct=round(current_invested_pct, 6) if current_invested_pct is not None else None,
        current_sector_pct=round(current_sector_pct, 6) if current_sector_pct is not None else None,
        projected_position_pct=round(projected_position_pct, 6) if projected_position_pct is not None else None,
        projected_sector_pct=round(projected_sector_pct, 6) if projected_sector_pct is not None else None,
        correlated_positions=tuple(sorted(correlations)),
        concentration_state=concentration,
        pdt_warning=pdt_warning,
        settlement_state=settlement_state,
        available_to_allocate=round(available, 2) if available is not None else None,
        warnings=tuple(warnings),
    )


def suggest_position_size(
    snapshot: QuantFeatureSnapshot,
    score: ArgentumScoreCard,
    account: AccountSnapshot,
    holdings: Sequence[HoldingSnapshot],
    *,
    sector: str = "UNKNOWN",
    market_data: MarketData | None = None,
    fractional_supported: bool = True,
    open_order_symbols: Sequence[str] = (),
    policy: PortfolioPolicy = PortfolioPolicy(),
) -> PositionSizeSuggestion:
    price = snapshot.price
    account_value = _number(account.account_value)
    buying_power = _number(account.buying_power)
    settled_cash = _number(account.settled_cash)
    allocatable = buying_power
    if settled_cash is not None:
        allocatable = min(value for value in (buying_power, settled_cash) if value is not None) if buying_power is not None else settled_cash
    blockers: list[str] = []
    if score.action not in {"STRONG_BUY_CANDIDATE", "BUY_CANDIDATE"}:
        blockers.append(f"Analytical action is {score.action}, not a qualified buy candidate.")
    if price is None or price <= 0:
        blockers.append("Current price is unavailable.")
    if account_value is None or account_value <= 0:
        blockers.append("Account value is unavailable.")
    if allocatable is None or allocatable <= 0:
        blockers.append("Settled buying power is unavailable.")
    if snapshot.symbol in {str(item).upper() for item in open_order_symbols}:
        blockers.append("An open order already exists for this symbol.")
    existing = next((holding for holding in holdings if holding.symbol.upper() == snapshot.symbol and holding.market_value > 0), None)
    if existing is not None:
        blockers.append("Existing position blocks automatic averaging down.")

    atr = snapshot.volatility.atr14
    support = snapshot.support_zones[0].lower if snapshot.support_zones else None
    if price is not None and atr is not None and atr > 0:
        stop = min((support - atr * 0.2) if support is not None else price - atr * 1.5, price - atr)
        stop = stop if stop > 0 else price * 0.95
    else:
        stop = None
    risk_per_share = price - stop if price is not None and stop is not None and stop < price else None
    confidence_factor = max(0.25, score.confidence_score / 100.0)
    safety_factor = max(0.15, 1.0 - ((score.risk_score or 50.0) / 120.0))
    risk_budget = account_value * policy.max_risk_pct * confidence_factor * safety_factor if account_value is not None else None
    risk_sized_dollars = risk_budget / risk_per_share * price if risk_budget is not None and risk_per_share is not None and risk_per_share > 0 and price is not None else None
    max_position_dollars = account_value * policy.max_position_pct if account_value is not None else None
    candidates = [value for value in (risk_sized_dollars, max_position_dollars, allocatable) if value is not None]
    suggested_dollars = min(candidates) if len(candidates) == 3 else None

    preliminary_impact = build_portfolio_impact(snapshot.symbol, sector, account, holdings, proposed_dollars=suggested_dollars, market_data=market_data, policy=policy)
    if preliminary_impact.projected_sector_pct is not None and preliminary_impact.projected_sector_pct > policy.max_sector_pct:
        blockers.append("Projected sector concentration exceeds the portfolio limit.")
    if preliminary_impact.current_invested_pct is not None and preliminary_impact.projected_position_pct is not None and preliminary_impact.current_invested_pct + preliminary_impact.projected_position_pct > policy.max_invested_pct:
        blockers.append("Projected invested capital exceeds the portfolio limit.")
    if blockers:
        suggested_dollars = None
        suggested_shares = None
        suggested_pct = None
        impact = build_portfolio_impact(snapshot.symbol, sector, account, holdings, proposed_dollars=None, market_data=market_data, policy=policy)
    else:
        suggested_dollars = round(max(0.0, suggested_dollars or 0.0), 2)
        raw_shares = suggested_dollars / price if price else 0.0
        suggested_shares = round(raw_shares, 6) if fractional_supported else float(math.floor(raw_shares))
        suggested_pct = suggested_dollars / account_value * 100 if account_value else None
        impact = preliminary_impact
    return PositionSizeSuggestion(
        symbol=snapshot.symbol,
        analytical_action=score.action,
        suggested_position_pct=round(suggested_pct, 4) if suggested_pct is not None else None,
        suggested_dollars=suggested_dollars,
        suggested_shares=suggested_shares,
        max_risk_pct=policy.max_risk_pct * 100,
        risk_budget_dollars=round(risk_budget, 2) if risk_budget is not None else None,
        stop_price=round(stop, 4) if stop is not None else None,
        portfolio_impact=impact,
        blockers=tuple(dict.fromkeys(blockers)),
    )


def evaluate_circuit_breakers(state: CircuitBreakerInput) -> CircuitBreakerDecision:
    requested = str(state.requested_mode or "OBSERVE").upper()
    if requested not in {"OBSERVE", "PAPER", "LIVE"}:
        requested = "OBSERVE"
    reasons: list[str] = []
    effective = requested
    if requested == "LIVE" and not state.live_authorized:
        reasons.append("LIVE mode lacks existing explicit execution authorization.")
        effective = "OBSERVE"
    if state.daily_pnl_pct is not None and state.daily_pnl_pct <= -abs(state.daily_max_loss_pct):
        reasons.append("Daily maximum-loss circuit breaker is active.")
    if state.new_positions_today >= state.max_new_positions_per_day:
        reasons.append("Maximum new positions for the day has been reached.")
    if state.proposed_order_pct is not None and state.proposed_order_pct > state.max_single_order_pct:
        reasons.append("Proposed order exceeds the maximum account percentage.")
    if state.provider_conflicts >= state.repeated_provider_conflict_limit:
        reasons.append("Repeated provider conflicts require OBSERVE mode.")
        effective = "OBSERVE"
    if state.portfolio_data_stale:
        reasons.append("Portfolio-wide market data is stale.")
        effective = "OBSERVE"
    if not state.broker_auth_healthy:
        reasons.append("Broker authentication is unhealthy.")
        effective = "OBSERVE"
    return CircuitBreakerDecision(
        requested_mode=requested,
        effective_mode=effective,
        allow_new_positions=not reasons and effective in {"PAPER", "LIVE"},
        allow_risk_reducing_exits=True,
        reasons=tuple(reasons),
    )
