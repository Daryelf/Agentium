from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from .config import DATA_DIR, Settings
from .live_autonomy import BROKER_REVIEW_ONLY
from .readiness import ReadinessReport, build_readiness_report


ARM_PLAN_PATH = DATA_DIR / "live_auto_arm_plan.json"
ACTION_READY_TO_ARM = "READY_TO_ARM"
ACTION_NOT_ARMABLE = "NOT_ARMABLE"


@dataclass(frozen=True)
class ConfigChange:
    field: str
    current: object
    required: object
    reason: str


@dataclass(frozen=True)
class LiveAutoArmPlan:
    generated_at: str
    action: str
    account_number: str
    config_changes: list[ConfigChange]
    blockers: list[str]
    warnings: list[str]
    readiness: ReadinessReport


def required_config_changes(settings: Settings, *, account_number: str) -> list[ConfigChange]:
    changes: list[ConfigChange] = []
    if settings.live_account_number != account_number and account_number.strip():
        changes.append(
            ConfigChange(
                field="live_account_number",
                current=settings.live_account_number,
                required=account_number,
                reason="live auto requires an explicit Agentic account identifier",
            )
        )
    if not settings.live_auto_trading_enabled:
        changes.append(
            ConfigChange(
                field="live_auto_trading_enabled",
                current=settings.live_auto_trading_enabled,
                required=True,
                reason="autonomous live trading must be explicitly enabled",
            )
        )
    if settings.live_order_confirmation_policy != BROKER_REVIEW_ONLY:
        changes.append(
            ConfigChange(
                field="live_order_confirmation_policy",
                current=settings.live_order_confirmation_policy,
                required=BROKER_REVIEW_ONLY,
                reason="autonomous mode uses broker review as the confirmation gate",
            )
        )
    return changes


def build_live_auto_arm_plan(
    *,
    settings: Settings,
    account_number: str,
    now: datetime,
) -> LiveAutoArmPlan:
    readiness = build_readiness_report(
        settings,
        account_number=account_number,
        now=now,
        require_broker_tool_status=True,
        require_reconciliation_report=True,
        require_account_health_report=True,
        require_capital_policy_report=True,
    )
    changes = required_config_changes(settings, account_number=account_number)
    blockers = [f"{check.name}: {check.detail}" for check in readiness.blockers]
    warnings = [f"{check.name}: {check.detail}" for check in readiness.warnings]
    action = ACTION_READY_TO_ARM if not blockers and not changes else ACTION_NOT_ARMABLE
    return LiveAutoArmPlan(
        generated_at=now.isoformat(timespec="seconds"),
        action=action,
        account_number=account_number,
        config_changes=changes,
        blockers=blockers,
        warnings=warnings,
        readiness=readiness,
    )


def write_arm_plan(plan: LiveAutoArmPlan, path: Path = ARM_PLAN_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(plan), indent=2, sort_keys=True) + "\n")
    return path
