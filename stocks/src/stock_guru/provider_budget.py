from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Mapping

from .config import PROVIDER_BUDGET_PATH
from .market_calendar import market_clock


DEFAULT_DAILY_BUDGETS = {
    "TWELVE_DATA": 800,
    "FMP": 1_000,
    "ALPHA_VANTAGE": 25,
    "YAHOO_CHART": 10_000,
    "YFINANCE": 500,
    "STOOQ": 1_000,
    "FRED": 20,
}


@dataclass(frozen=True)
class ProviderBudgetDecision:
    provider: str
    day: str
    allowed: bool
    requested_units: int
    used_units: int
    daily_budget: int
    remaining_units: int
    reason: str
    market_session: str = "UNKNOWN"
    session_budget: int = 0
    session_used_units: int = 0
    session_remaining_units: int = 0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def provider_budget(provider: str, env: Mapping[str, str] | None = None) -> int:
    normalized = str(provider or "").strip().upper()
    values = env if env is not None else os.environ
    key = f"STOCK_GURU_PROVIDER_{normalized}_DAILY_BUDGET"
    try:
        configured = int(str(values.get(key, "") or "").strip())
    except ValueError:
        configured = 0
    if configured > 0:
        return configured
    return DEFAULT_DAILY_BUDGETS.get(normalized, 500)


def provider_session_budget(provider: str, session: str, env: Mapping[str, str] | None = None) -> int:
    normalized = str(provider or "").strip().upper()
    normalized_session = str(session or "OVERNIGHT").strip().upper()
    values = env if env is not None else os.environ
    key = f"STOCK_GURU_PROVIDER_{normalized}_{normalized_session}_BUDGET"
    try:
        configured = int(str(values.get(key, "") or "").strip())
    except ValueError:
        configured = 0
    # Session caps are configurable independently, while the conservative
    # default preserves the existing daily budget behavior.
    return configured if configured > 0 else provider_budget(normalized, values)


def read_provider_budgets(path: Path = PROVIDER_BUDGET_PATH) -> dict[str, object]:
    if not path.exists():
        return {"version": 1, "day": None, "providers": {}}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {"version": 1, "day": None, "providers": {}}
    return payload if isinstance(payload, dict) else {"version": 1, "day": None, "providers": {}}


def reserve_provider_budget(
    provider: str,
    units: int = 1,
    *,
    path: Path = PROVIDER_BUDGET_PATH,
    env: Mapping[str, str] | None = None,
    now: datetime | None = None,
) -> ProviderBudgetDecision:
    normalized = str(provider or "UNKNOWN").strip().upper()
    requested = max(1, int(units or 1))
    at = now or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    day = at.astimezone(timezone.utc).date().isoformat()
    budget = provider_budget(normalized, env)
    session = market_clock(at).session.value
    session_budget = provider_session_budget(normalized, session, env)
    payload = read_provider_budgets(path)
    if payload.get("day") != day:
        payload = {"version": 1, "day": day, "providers": {}}
    providers = payload.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        payload["providers"] = providers
    prior = providers.get(normalized, {})
    if not isinstance(prior, dict):
        prior = {}
    used = max(0, int(prior.get("used_units", 0) or 0))
    states = prior.get("sessions", {})
    if not isinstance(states, dict):
        states = {}
    state = states.get(session, {})
    if not isinstance(state, dict):
        state = {}
    session_used = max(0, int(state.get("used_units", 0) or 0))
    allowed = used + requested <= budget and session_used + requested <= session_budget
    updated_used = used + requested if allowed else used
    updated_session_used = session_used + requested if allowed else session_used
    if allowed:
        reason = "reserved"
    elif used + requested > budget:
        reason = f"daily provider budget exhausted ({used}/{budget})"
    else:
        reason = f"{session} provider budget exhausted ({session_used}/{session_budget})"
    states[session] = {
        "session": session,
        "used_units": updated_session_used,
        "budget": session_budget,
        "remaining_units": max(0, session_budget - updated_session_used),
        "last_requested_units": requested,
        "last_allowed": allowed,
        "last_checked_at": at.isoformat(),
    }
    providers[normalized] = {
        "provider": normalized,
        "used_units": updated_used,
        "daily_budget": budget,
        "remaining_units": max(0, budget - updated_used),
        "last_requested_units": requested,
        "last_allowed": allowed,
        "last_checked_at": at.isoformat(),
        "reason": reason,
        "sessions": states,
    }
    payload["updated_at"] = at.isoformat()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
    except OSError:
        # A read-only runtime must not convert a potentially valid request into
        # fabricated data. It may proceed while reporting no persisted budget.
        allowed = True
        reason = "budget ledger unavailable; request allowed without persistence"
        updated_used = used
    return ProviderBudgetDecision(
        provider=normalized,
        day=day,
        allowed=allowed,
        requested_units=requested,
        used_units=updated_used,
        daily_budget=budget,
        remaining_units=max(0, budget - updated_used),
        market_session=session,
        session_budget=session_budget,
        session_used_units=updated_session_used,
        session_remaining_units=max(0, session_budget - updated_session_used),
        reason=reason,
    )
