from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Mapping

from .account_health import ACCOUNT_HEALTH_REPORT_PATH
from .autonomous import HEARTBEAT_PATH
from .capital_policy import ACTION_REDUCE_LOCKOUT, CAPITAL_POLICY_REPORT_PATH
from .config import DATA_DIR, Settings
from .lifecycle import LIFECYCLE_STATE_PATH
from .optimization import OPTIMIZATION_REPORT_PATH, optimization_reasons
from .performance import PERFORMANCE_REPORT_PATH
from .readiness import ReadinessReport, build_readiness_report, parse_timestamp, read_json
from .reconciliation import RECONCILIATION_REPORT_PATH
from .strategy_health import STRATEGY_HEALTH_PATH, strategy_health_reasons


LAUNCH_CHECKLIST_PATH = DATA_DIR / "live_auto_launch_checklist.json"


@dataclass(frozen=True)
class ArtifactCheck:
    name: str
    path: str
    exists: bool
    fresh: bool
    passed: bool
    severity: str
    detail: str


@dataclass(frozen=True)
class LaunchChecklistReport:
    generated_at: str
    ready_for_live_auto: bool
    artifacts: list[ArtifactCheck]
    readiness: ReadinessReport
    next_steps: list[str]

    @property
    def blockers(self) -> list[ArtifactCheck]:
        return [artifact for artifact in self.artifacts if not artifact.passed and artifact.severity == "blocker"]

    @property
    def warnings(self) -> list[ArtifactCheck]:
        return [artifact for artifact in self.artifacts if not artifact.passed and artifact.severity == "warning"]


def _fresh(payload: Mapping[str, object] | None, *, now: datetime, settings: Settings) -> bool:
    timestamp = parse_timestamp(payload.get("generated_at") or payload.get("updated_at")) if payload else None
    return bool(timestamp and now - timestamp <= timedelta(minutes=settings.live_heartbeat_stale_minutes))


def _artifact(
    *,
    name: str,
    path: Path,
    settings: Settings,
    now: datetime,
    required: bool,
    pass_key: str | None = None,
    pass_value: object = True,
    action_key: str | None = None,
    allowed_actions: set[str] | None = None,
    stale_allowed: bool = False,
) -> ArtifactCheck:
    payload = read_json(path)
    exists = payload is not None
    fresh = _fresh(payload, now=now, settings=settings) if exists else False
    severity = "blocker" if required else "warning"
    if not exists:
        return ArtifactCheck(name, str(path), False, False, False, severity, "missing")
    if not fresh and not stale_allowed:
        return ArtifactCheck(name, str(path), True, False, False, severity, "stale")
    passed = True
    detail = "fresh"
    if pass_key is not None:
        passed = payload.get(pass_key) == pass_value
        detail = f"{pass_key}={payload.get(pass_key)}"
    if action_key is not None and allowed_actions is not None:
        action = str(payload.get(action_key, ""))
        passed = action in allowed_actions
        detail = f"{action_key}={action}"
        if action == ACTION_REDUCE_LOCKOUT:
            severity = "blocker"
    return ArtifactCheck(name, str(path), True, fresh or stale_allowed, passed, severity, detail)


def _strategy_health_artifact(*, path: Path, settings: Settings) -> ArtifactCheck:
    payload = read_json(path)
    if payload is None:
        return ArtifactCheck("strategy_health", str(path), False, False, False, "blocker", "missing")
    reasons = strategy_health_reasons(settings, path=path)
    passed = not reasons
    detail = "healthy" if passed else "; ".join(reasons)
    return ArtifactCheck("strategy_health", str(path), True, True, passed, "blocker", detail)


def _optimization_artifact(*, path: Path, settings: Settings, now: datetime) -> ArtifactCheck:
    payload = read_json(path)
    if payload is None:
        return ArtifactCheck("replay_optimization", str(path), False, False, False, "blocker", "missing")
    reasons = optimization_reasons(settings, now=now, path=path)
    stale = any("stale" in reason for reason in reasons)
    passed = not reasons
    detail = "fresh and eligible" if passed else "; ".join(reasons)
    return ArtifactCheck("replay_optimization", str(path), True, not stale, passed, "blocker", detail)


def next_steps_for(report: LaunchChecklistReport) -> list[str]:
    steps: list[str] = []
    failed_names = {artifact.name for artifact in report.artifacts if not artifact.passed}
    if "broker_account_health" in failed_names:
        steps.append("run live-auto-health with live broker account, quotes, and tradability")
    if "broker_reconciliation" in failed_names:
        steps.append("run live-auto-reconcile with live broker positions and open orders")
    if "performance_audit" in failed_names:
        steps.append("run performance-audit after lifecycle fills exist")
    if "capital_policy" in failed_names:
        steps.append("run capital-policy after performance-audit writes JSON")
    if "strategy_health" in failed_names:
        steps.append("run strategy-health or intraday-replay --write-health")
    if "replay_optimization" in failed_names:
        steps.append("run intraday-walk-forward --write-report or live-auto-prepare")
    if "heartbeat" in failed_names:
        steps.append("run a supervised live-auto-session cycle to refresh heartbeat")
    if report.readiness.blockers:
        steps.append("resolve strict preflight blockers before arming live auto")
    return list(dict.fromkeys(steps))


def build_launch_checklist(
    *,
    settings: Settings,
    account_number: str,
    now: datetime,
    require_broker_tool_status: bool = True,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    heartbeat_path: Path = HEARTBEAT_PATH,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    optimization_report_path: Path = OPTIMIZATION_REPORT_PATH,
    reconciliation_report_path: Path = RECONCILIATION_REPORT_PATH,
    account_health_report_path: Path = ACCOUNT_HEALTH_REPORT_PATH,
    performance_report_path: Path = PERFORMANCE_REPORT_PATH,
    capital_policy_report_path: Path = CAPITAL_POLICY_REPORT_PATH,
) -> LaunchChecklistReport:
    artifacts = [
        _artifact(name="heartbeat", path=heartbeat_path, settings=settings, now=now, required=False),
        _artifact(
            name="broker_reconciliation",
            path=reconciliation_report_path,
            settings=settings,
            now=now,
            required=True,
            pass_key="safe_to_arm",
        ),
        _artifact(
            name="broker_account_health",
            path=account_health_report_path,
            settings=settings,
            now=now,
            required=True,
            pass_key="safe_for_entries",
        ),
        _artifact(
            name="performance_audit",
            path=performance_report_path,
            settings=settings,
            now=now,
            required=True,
            stale_allowed=True,
        ),
        _artifact(
            name="capital_policy",
            path=capital_policy_report_path,
            settings=settings,
            now=now,
            required=True,
            action_key="action",
            allowed_actions={"HOLD_CURRENT_BANKROLL", "SCALE_UP"},
        ),
        _strategy_health_artifact(path=strategy_health_path, settings=settings),
        _optimization_artifact(path=optimization_report_path, settings=settings, now=now),
    ]
    readiness = build_readiness_report(
        settings,
        account_number=account_number,
        now=now,
        require_broker_tool_status=require_broker_tool_status,
        require_reconciliation_report=True,
        require_account_health_report=True,
        require_capital_policy_report=True,
        lifecycle_path=lifecycle_path,
        heartbeat_path=heartbeat_path,
        strategy_health_path=strategy_health_path,
        optimization_report_path=optimization_report_path,
        reconciliation_report_path=reconciliation_report_path,
        account_health_report_path=account_health_report_path,
        capital_policy_report_path=capital_policy_report_path,
    )
    draft = LaunchChecklistReport(
        generated_at=now.isoformat(timespec="seconds"),
        ready_for_live_auto=False,
        artifacts=artifacts,
        readiness=readiness,
        next_steps=[],
    )
    steps = next_steps_for(draft)
    ready = readiness.ready_for_live_auto and not any(not artifact.passed and artifact.severity == "blocker" for artifact in artifacts)
    return LaunchChecklistReport(
        generated_at=draft.generated_at,
        ready_for_live_auto=ready,
        artifacts=artifacts,
        readiness=readiness,
        next_steps=steps,
    )


def write_launch_checklist(report: LaunchChecklistReport, path: Path = LAUNCH_CHECKLIST_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(report), indent=2, sort_keys=True) + "\n")
    return path
