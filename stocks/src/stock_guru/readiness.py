from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Mapping

from .autonomous import HEARTBEAT_PATH
from .broker_client import BrokerToolStatus, normalized_order_state
from .config import DATA_DIR, Settings
from .lifecycle import LIFECYCLE_STATE_PATH, IntradayLifecycleState, load_lifecycle_state
from .live_autonomy import KILL_SWITCH_PATH, live_session_gate
from .optimization import OPTIMIZATION_REPORT_PATH, optimization_reasons
from .strategy_health import (
    STRATEGY_HEALTH_PATH,
    read_strategy_metrics,
    strategy_health_reasons,
    write_strategy_health,
    write_strategy_health_from_lifecycle,
)


RECONCILIATION_REPORT_PATH = DATA_DIR / "broker_reconciliation_report.json"
ACCOUNT_HEALTH_REPORT_PATH = DATA_DIR / "broker_account_health.json"
CAPITAL_POLICY_REPORT_PATH = DATA_DIR / "capital_policy.json"


@dataclass(frozen=True)
class ReadinessCheck:
    name: str
    passed: bool
    severity: str
    detail: str


@dataclass(frozen=True)
class ReadinessReport:
    ready_for_live_auto: bool
    checks: list[ReadinessCheck]
    generated_at: str

    @property
    def blockers(self) -> list[ReadinessCheck]:
        return [check for check in self.checks if not check.passed and check.severity == "blocker"]

    @property
    def warnings(self) -> list[ReadinessCheck]:
        return [check for check in self.checks if not check.passed and check.severity == "warning"]


def read_json(path: Path) -> Mapping[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    return payload if isinstance(payload, Mapping) else None


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def lifecycle_audit_reasons(state: IntradayLifecycleState, *, now: datetime, settings: Settings) -> list[str]:
    reasons: list[str] = []
    current_date = now.date().isoformat()
    for symbol, position in state.positions.items():
        opened_at = parse_timestamp(position.opened_at)
        force_exit = parse_timestamp(position.force_exit_after)
        if not position.allow_overnight and opened_at and opened_at.date().isoformat() < current_date:
            reasons.append(f"{symbol}: intraday position carried overnight without override")
        if not position.allow_overnight and force_exit and now >= force_exit:
            reasons.append(f"{symbol}: intraday force-exit deadline has passed")
    for plan in state.order_plans:
        placement_state = normalized_order_state(plan.placement_state)
        if plan.status == "PLACEMENT_FAILED" or placement_state == "failed":
            reasons.append(f"{plan.symbol}: {plan.side} order placement failed and requires reconciliation")
        if plan.status == "READY_TO_PLACE" and not plan.placed_order_id:
            reasons.append(f"{plan.symbol}: unplaced READY_TO_PLACE {plan.side} order requires reconciliation")
        if plan.placed_order_id and not plan.placement_state:
            reasons.append(f"{plan.symbol}: placed order missing broker placement state")
    return reasons


def build_readiness_report(
    settings: Settings,
    *,
    account_number: str,
    now: datetime,
    broker_tool_status: BrokerToolStatus | None = None,
    require_broker_tool_status: bool = False,
    require_reconciliation_report: bool = False,
    require_account_health_report: bool = False,
    require_capital_policy_report: bool = False,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    heartbeat_path: Path = HEARTBEAT_PATH,
    kill_switch_path: Path = KILL_SWITCH_PATH,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    optimization_report_path: Path = OPTIMIZATION_REPORT_PATH,
    reconciliation_report_path: Path = RECONCILIATION_REPORT_PATH,
    account_health_report_path: Path = ACCOUNT_HEALTH_REPORT_PATH,
    capital_policy_report_path: Path = CAPITAL_POLICY_REPORT_PATH,
) -> ReadinessReport:
    checks: list[ReadinessCheck] = []
    gate = live_session_gate(settings, account_number=account_number, now=now, kill_switch_path=kill_switch_path)
    checks.append(
        ReadinessCheck(
            name="live_session_gate",
            passed=gate.armed,
            severity="blocker",
            detail="armed" if gate.armed else "; ".join(gate.reasons),
        )
    )

    lifecycle = load_lifecycle_state(lifecycle_path, now=now)
    lifecycle_reasons = lifecycle_audit_reasons(lifecycle, now=now, settings=settings)
    checks.append(
        ReadinessCheck(
            name="lifecycle_state",
            passed=not lifecycle_reasons,
            severity="blocker",
            detail=(
                "; ".join(lifecycle_reasons)
                if lifecycle_reasons
                else f"positions={len(lifecycle.positions)} order_plans={len(lifecycle.order_plans)} updated_at={lifecycle.updated_at or 'empty'}"
            ),
        )
    )

    if broker_tool_status is None:
        checks.append(
            ReadinessCheck(
                name="broker_tool_contract",
                passed=False,
                severity="blocker" if require_broker_tool_status else "warning",
                detail="broker MCP tool status not supplied",
            )
        )
    else:
        checks.append(
            ReadinessCheck(
                name="broker_tool_contract",
                passed=broker_tool_status.configured and broker_tool_status.placement_enabled,
                severity="blocker",
                detail=(
                    "live placement tools configured"
                    if broker_tool_status.configured and broker_tool_status.placement_enabled
                    else "missing tools: " + ", ".join(broker_tool_status.missing_tools or ["place_equity_order"])
                ),
            )
        )

    heartbeat = read_json(heartbeat_path)
    heartbeat_time = parse_timestamp(heartbeat.get("updated_at")) if heartbeat else None
    heartbeat_fresh = bool(
        heartbeat_time and now - heartbeat_time <= timedelta(minutes=settings.live_heartbeat_stale_minutes)
    )
    checks.append(
        ReadinessCheck(
            name="heartbeat_freshness",
            passed=heartbeat_fresh,
            severity="warning",
            detail=(
                f"fresh at {heartbeat_time.isoformat(timespec='seconds')}"
                if heartbeat_fresh and heartbeat_time
                else "heartbeat missing or stale"
            ),
        )
    )

    reconciliation = read_json(reconciliation_report_path)
    reconciliation_time = parse_timestamp(reconciliation.get("generated_at")) if reconciliation else None
    reconciliation_fresh = bool(
        reconciliation_time and now - reconciliation_time <= timedelta(minutes=settings.live_heartbeat_stale_minutes)
    )
    reconciliation_safe = bool(reconciliation and reconciliation.get("safe_to_arm") is True)
    if reconciliation is None:
        checks.append(
            ReadinessCheck(
                name="broker_reconciliation",
                passed=False,
                severity="blocker" if require_reconciliation_report else "warning",
                detail="broker reconciliation report missing",
            )
        )
    else:
        checks.append(
            ReadinessCheck(
                name="broker_reconciliation",
                passed=reconciliation_fresh and reconciliation_safe,
                severity="blocker" if require_reconciliation_report or not reconciliation_safe else "warning",
                detail=(
                    "fresh and safe"
                    if reconciliation_fresh and reconciliation_safe
                    else f"stale_or_unsafe generated_at={reconciliation.get('generated_at', 'unknown')} safe_to_arm={reconciliation.get('safe_to_arm')}"
                ),
            )
        )

    account_health = read_json(account_health_report_path)
    account_health_time = parse_timestamp(account_health.get("generated_at")) if account_health else None
    account_health_fresh = bool(
        account_health_time and now - account_health_time <= timedelta(minutes=settings.live_heartbeat_stale_minutes)
    )
    account_health_safe = bool(account_health and account_health.get("safe_for_entries") is True)
    if account_health is None:
        checks.append(
            ReadinessCheck(
                name="broker_account_health",
                passed=False,
                severity="blocker" if require_account_health_report else "warning",
                detail="broker account health report missing",
            )
        )
    else:
        checks.append(
            ReadinessCheck(
                name="broker_account_health",
                passed=account_health_fresh and account_health_safe,
                severity="blocker" if require_account_health_report or not account_health_safe else "warning",
                detail=(
                    "fresh and safe"
                    if account_health_fresh and account_health_safe
                    else f"stale_or_unsafe generated_at={account_health.get('generated_at', 'unknown')} safe_for_entries={account_health.get('safe_for_entries')}"
                ),
            )
        )

    capital_policy = read_json(capital_policy_report_path)
    capital_policy_time = parse_timestamp(capital_policy.get("generated_at")) if capital_policy else None
    capital_policy_fresh = bool(
        capital_policy_time and now - capital_policy_time <= timedelta(minutes=settings.live_heartbeat_stale_minutes)
    )
    capital_action = str(capital_policy.get("action", "")) if capital_policy else ""
    capital_policy_safe = capital_action in {"HOLD_CURRENT_BANKROLL", "SCALE_UP"}
    if capital_policy is None:
        checks.append(
            ReadinessCheck(
                name="capital_policy",
                passed=False,
                severity="blocker" if require_capital_policy_report else "warning",
                detail="capital policy report missing",
            )
        )
    else:
        checks.append(
            ReadinessCheck(
                name="capital_policy",
                passed=capital_policy_fresh and capital_policy_safe,
                severity="blocker" if require_capital_policy_report or not capital_policy_safe else "warning",
                detail=(
                    f"fresh action={capital_action}"
                    if capital_policy_fresh and capital_policy_safe
                    else f"stale_or_unsafe generated_at={capital_policy.get('generated_at', 'unknown')} action={capital_action}"
                ),
            )
        )

    strategy_metrics = read_strategy_metrics(strategy_health_path)
    if strategy_metrics is None:
        checks.append(
            ReadinessCheck(
                name="strategy_health",
                passed=False,
                severity="warning",
                detail="strategy health metrics missing",
            )
        )
    else:
        drawdown_pct = strategy_metrics.max_drawdown / max(settings.live_principal_dollars, 1.0)
        reasons = strategy_health_reasons(settings, path=strategy_health_path)
        healthy = not reasons
        checks.append(
            ReadinessCheck(
                name="strategy_health",
                passed=healthy,
                severity="blocker" if not healthy else "warning",
                detail=(
                    f"trades={strategy_metrics.trades} expectancy={strategy_metrics.expectancy:.4f} "
                    f"max_drawdown_pct={drawdown_pct:.4f}"
                ),
            )
        )

    opt_reasons = optimization_reasons(settings, now=now, path=optimization_report_path)
    missing_opt = "replay optimization report missing" in opt_reasons
    checks.append(
        ReadinessCheck(
            name="replay_optimization",
            passed=not opt_reasons,
            severity="blocker" if settings.live_require_optimization_for_entries or not missing_opt else "warning",
            detail="fresh and eligible" if not opt_reasons else "; ".join(opt_reasons),
        )
    )

    ready = not any(not check.passed and check.severity == "blocker" for check in checks)
    return ReadinessReport(
        ready_for_live_auto=ready,
        checks=checks,
        generated_at=now.isoformat(timespec="seconds"),
    )
