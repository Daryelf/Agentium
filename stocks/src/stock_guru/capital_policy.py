from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Mapping

from .config import DATA_DIR, Settings
from .performance import PERFORMANCE_REPORT_PATH, PerformanceAuditReport


CAPITAL_POLICY_REPORT_PATH = DATA_DIR / "capital_policy.json"
ACTION_HOLD = "HOLD_CURRENT_BANKROLL"
ACTION_SCALE_UP = "SCALE_UP"
ACTION_REDUCE_LOCKOUT = "REDUCE_OR_LOCKOUT"


@dataclass(frozen=True)
class CapitalPolicyDecision:
    generated_at: str
    action: str
    current_principal_dollars: float
    current_max_total_dollars: float
    current_max_order_dollars: float
    recommended_principal_dollars: float
    recommended_max_total_dollars: float
    recommended_max_order_dollars: float
    reasons: list[str]


def _metrics_from_payload(payload: Mapping[str, object]) -> Mapping[str, object]:
    metrics = payload.get("metrics")
    return metrics if isinstance(metrics, Mapping) else {}


def read_performance_payload(path: Path = PERFORMANCE_REPORT_PATH) -> Mapping[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    return payload if isinstance(payload, Mapping) else None


def capital_policy_from_payload(
    *,
    settings: Settings,
    payload: Mapping[str, object] | None,
    now: datetime,
) -> CapitalPolicyDecision:
    reasons: list[str] = []
    action = ACTION_HOLD
    if payload is None:
        reasons.append("performance audit report missing")
    else:
        metrics = _metrics_from_payload(payload)
        trades = int(metrics.get("trades", 0) or 0)
        expectancy = float(metrics.get("expectancy", 0.0) or 0.0)
        max_drawdown = float(metrics.get("max_drawdown", 0.0) or 0.0)
        profit_factor = float(payload.get("profit_factor", 0.0) or 0.0)
        capital_scale_ready = bool(payload.get("capital_scale_ready") is True)
        audit_reasons = payload.get("reasons")
        if isinstance(audit_reasons, list):
            reasons.extend(str(reason) for reason in audit_reasons)
        if trades < settings.live_min_strategy_trades:
            reasons.append(f"trade sample too small for capital scaling: {trades} < {settings.live_min_strategy_trades}")
        if expectancy <= settings.live_min_strategy_expectancy:
            reasons.append(f"expectancy too weak for capital scaling: {expectancy:.4f}")
        drawdown_pct = max_drawdown / max(settings.live_principal_dollars, 1.0)
        if drawdown_pct > settings.live_max_strategy_drawdown_pct:
            reasons.append(f"drawdown too high for capital scaling: {drawdown_pct:.4f}")
        if profit_factor < settings.live_min_profit_factor_to_scale:
            reasons.append(f"profit factor too low for capital scaling: {profit_factor:.4f} < {settings.live_min_profit_factor_to_scale:.4f}")
        if not capital_scale_ready:
            reasons.append("performance audit did not mark capital_scale_ready")
        if expectancy < 0 or drawdown_pct > settings.live_max_strategy_drawdown_pct * 1.5:
            action = ACTION_REDUCE_LOCKOUT

    current_principal = settings.live_principal_dollars
    current_total = settings.live_max_total_dollars
    current_order = settings.live_max_order_dollars
    recommended_principal = current_principal
    recommended_total = current_total
    recommended_order = current_order
    if not reasons:
        action = ACTION_SCALE_UP
        step_target = min(current_total * settings.live_scale_up_multiplier, current_total + settings.live_max_scale_step_dollars)
        recommended_total = round(max(current_total, step_target), 2)
        recommended_principal = round(max(current_principal, min(recommended_total, current_principal + settings.live_max_scale_step_dollars)), 2)
        recommended_order = round(min(recommended_total, max(current_order, current_order * settings.live_scale_up_multiplier)), 2)

    return CapitalPolicyDecision(
        generated_at=now.isoformat(timespec="seconds"),
        action=action,
        current_principal_dollars=round(current_principal, 2),
        current_max_total_dollars=round(current_total, 2),
        current_max_order_dollars=round(current_order, 2),
        recommended_principal_dollars=recommended_principal,
        recommended_max_total_dollars=recommended_total,
        recommended_max_order_dollars=recommended_order,
        reasons=sorted(set(reasons)),
    )


def capital_policy_from_performance_report(
    *,
    settings: Settings,
    performance_report_path: Path = PERFORMANCE_REPORT_PATH,
    now: datetime,
) -> CapitalPolicyDecision:
    return capital_policy_from_payload(settings=settings, payload=read_performance_payload(performance_report_path), now=now)


def capital_policy_from_audit(
    *,
    settings: Settings,
    audit: PerformanceAuditReport,
    now: datetime,
) -> CapitalPolicyDecision:
    return capital_policy_from_payload(settings=settings, payload=asdict(audit), now=now)


def write_capital_policy_report(
    decision: CapitalPolicyDecision,
    path: Path = CAPITAL_POLICY_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(decision), indent=2, sort_keys=True) + "\n")
    return path
