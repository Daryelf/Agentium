from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .config import DATA_DIR, Settings
from .market import market_state


BROKER_REVIEW_ONLY = "broker_review_only"
MANUAL_PER_ORDER = "manual_per_order"
ARGENTUM_HUMAN_GATE_PER_ORDER = "argentum_human_gate_per_order"
VALID_CONFIRMATION_POLICIES = {ARGENTUM_HUMAN_GATE_PER_ORDER, MANUAL_PER_ORDER}
KILL_SWITCH_PATH = DATA_DIR / "live_auto_kill_switch.json"


@dataclass(frozen=True)
class LiveSessionGate:
    armed: bool
    allow_buys: bool
    allow_sells: bool
    reasons: list[str]
    kill_switch_active: bool = False


def live_auto_reasons(settings: Settings, *, account_number: str) -> list[str]:
    reasons: list[str] = []
    if not settings.live_auto_trading_enabled:
        reasons.append("live auto trading is disabled")
    if not account_number.strip():
        reasons.append("explicit Agentic account number is required")
    if settings.live_order_confirmation_policy == BROKER_REVIEW_ONLY:
        reasons.append("broker review alone cannot authorize placement; Argentum Human Gate approval is required per order")
    elif settings.live_order_confirmation_policy not in VALID_CONFIRMATION_POLICIES:
        reasons.append("live order confirmation policy is unsupported")
    elif settings.live_order_confirmation_policy != ARGENTUM_HUMAN_GATE_PER_ORDER:
        reasons.append("confirmation policy must use Argentum Human Gate approval per order")
    if settings.live_principal_dollars <= 0 or settings.live_max_total_dollars <= 0:
        reasons.append("live bankroll guardrails are not configured")
    if settings.live_max_order_dollars <= 0:
        reasons.append("live max order size is not configured")
    return reasons


def live_auto_enabled(settings: Settings, *, account_number: str) -> bool:
    return not live_auto_reasons(settings, account_number=account_number)


def kill_switch_active(path: Path = KILL_SWITCH_PATH) -> bool:
    if not path.exists():
        return False
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return True
    if isinstance(payload, dict):
        return bool(payload.get("enabled", True))
    return bool(payload)


def write_kill_switch(enabled: bool, *, reason: str = "", path: Path = KILL_SWITCH_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"enabled": enabled, "reason": reason}, indent=2, sort_keys=True) + "\n")
    return path


def live_session_gate(
    settings: Settings,
    *,
    account_number: str,
    now: datetime,
    kill_switch_path: Path = KILL_SWITCH_PATH,
) -> LiveSessionGate:
    base_reasons = live_auto_reasons(settings, account_number=account_number)
    state = market_state(settings, now=now)
    if state != "open":
        base_reasons.append(f"market is {state}")
    killed = kill_switch_active(kill_switch_path)
    reasons = list(base_reasons)
    if killed:
        reasons.append("live auto kill switch is active")
    armed = not reasons
    return LiveSessionGate(
        armed=armed,
        allow_buys=armed and not killed,
        allow_sells=not base_reasons,
        reasons=reasons,
        kill_switch_active=killed,
    )
