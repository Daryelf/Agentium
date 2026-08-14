from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .account_health import ACCOUNT_HEALTH_REPORT_PATH, build_account_health_report, write_account_health_report
from .broker_client import BrokerClient
from .capital_policy import CAPITAL_POLICY_REPORT_PATH, capital_policy_from_audit, write_capital_policy_report
from .config import Settings
from .launch_checklist import LAUNCH_CHECKLIST_PATH, LaunchChecklistReport, build_launch_checklist, write_launch_checklist
from .lifecycle import LIFECYCLE_STATE_PATH
from .performance import (
    PERFORMANCE_MARKDOWN_PATH,
    PERFORMANCE_REPORT_PATH,
    PerformanceAuditReport,
    build_performance_audit_from_lifecycle,
    write_performance_audit_json,
    write_performance_audit_markdown,
)
from .reconciliation import RECONCILIATION_REPORT_PATH, build_reconciliation_report, write_reconciliation_report


@dataclass(frozen=True)
class EvidenceBundleReport:
    account_health_path: Path
    reconciliation_path: Path
    performance_json_path: Path
    performance_markdown_path: Path
    capital_policy_path: Path
    checklist_path: Path
    performance: PerformanceAuditReport
    checklist: LaunchChecklistReport


def build_local_evidence_bundle(
    *,
    settings: Settings,
    account_number: str,
    symbols: list[str],
    broker: BrokerClient,
    now: datetime,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    account_health_path: Path = ACCOUNT_HEALTH_REPORT_PATH,
    reconciliation_path: Path = RECONCILIATION_REPORT_PATH,
    performance_json_path: Path = PERFORMANCE_REPORT_PATH,
    performance_markdown_path: Path = PERFORMANCE_MARKDOWN_PATH,
    capital_policy_path: Path = CAPITAL_POLICY_REPORT_PATH,
    checklist_path: Path = LAUNCH_CHECKLIST_PATH,
    require_broker_tool_status: bool = True,
    output_dir: Path | None = None,
) -> EvidenceBundleReport:
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        lifecycle_path = output_dir / LIFECYCLE_STATE_PATH.name
        account_health_path = output_dir / ACCOUNT_HEALTH_REPORT_PATH.name
        reconciliation_path = output_dir / RECONCILIATION_REPORT_PATH.name
        performance_json_path = output_dir / PERFORMANCE_REPORT_PATH.name
        performance_markdown_path = output_dir / PERFORMANCE_MARKDOWN_PATH.name
        capital_policy_path = output_dir / CAPITAL_POLICY_REPORT_PATH.name
        checklist_path = output_dir / LAUNCH_CHECKLIST_PATH.name
    account_health = build_account_health_report(
        settings=settings,
        account_number=account_number,
        symbols=symbols,
        broker=broker,
        now=now,
    )
    saved_account_health = write_account_health_report(account_health, account_health_path)

    reconciliation = build_reconciliation_report(
        settings=settings,
        account_number=account_number,
        broker=broker,
        now=now,
        lifecycle_path=lifecycle_path,
    )
    saved_reconciliation = write_reconciliation_report(reconciliation, reconciliation_path)

    performance = build_performance_audit_from_lifecycle(
        settings=settings,
        lifecycle_path=lifecycle_path,
        now=now,
    )
    saved_performance_json = write_performance_audit_json(performance, performance_json_path)
    saved_performance_markdown = write_performance_audit_markdown(performance, performance_markdown_path)

    capital = capital_policy_from_audit(settings=settings, audit=performance, now=now)
    saved_capital = write_capital_policy_report(capital, capital_policy_path)

    checklist = build_launch_checklist(
        settings=settings,
        account_number=account_number,
        now=now,
        require_broker_tool_status=require_broker_tool_status,
        lifecycle_path=lifecycle_path,
        account_health_report_path=saved_account_health,
        reconciliation_report_path=saved_reconciliation,
        performance_report_path=saved_performance_json,
        capital_policy_report_path=saved_capital,
    )
    saved_checklist = write_launch_checklist(checklist, checklist_path)

    return EvidenceBundleReport(
        account_health_path=saved_account_health,
        reconciliation_path=saved_reconciliation,
        performance_json_path=saved_performance_json,
        performance_markdown_path=saved_performance_markdown,
        capital_policy_path=saved_capital,
        checklist_path=saved_checklist,
        performance=performance,
        checklist=checklist,
    )
