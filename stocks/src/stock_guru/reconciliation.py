from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from .broker_client import BrokerClient, BrokerOrder, BrokerPosition, normalized_order_state
from .config import DATA_DIR, Settings
from .lifecycle import LIFECYCLE_STATE_PATH, IntradayLifecycleState, load_lifecycle_state
from .readiness import lifecycle_audit_reasons


RECONCILIATION_REPORT_PATH = DATA_DIR / "broker_reconciliation_report.json"


@dataclass(frozen=True)
class ReconciliationIssue:
    severity: str
    code: str
    detail: str
    symbol: str = ""


@dataclass(frozen=True)
class BrokerReconciliationReport:
    generated_at: str
    account_number: str
    broker_positions: int
    lifecycle_positions: int
    broker_open_orders: int
    lifecycle_order_plans: int
    issues: list[ReconciliationIssue]
    safe_to_arm: bool

    @property
    def blockers(self) -> list[ReconciliationIssue]:
        return [issue for issue in self.issues if issue.severity == "blocker"]

    @property
    def warnings(self) -> list[ReconciliationIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]


def open_broker_orders(orders: list[BrokerOrder]) -> list[BrokerOrder]:
    return [order for order in orders if order.is_open]


def broker_position_symbols(positions: list[BrokerPosition]) -> set[str]:
    return {position.symbol for position in positions if position.shares > 0}


def lifecycle_open_order_refs(state: IntradayLifecycleState) -> set[str]:
    return {
        plan.placed_order_id
        for plan in state.order_plans
        if plan.placed_order_id
        and normalized_order_state(plan.placement_state) in {"new", "queued", "confirmed", "unconfirmed", "partially_filled"}
    }


def lifecycle_ready_symbols(state: IntradayLifecycleState) -> set[tuple[str, str]]:
    return {(plan.symbol, plan.side) for plan in state.order_plans if plan.status == "READY_TO_PLACE" and not plan.placed_order_id}


def build_reconciliation_report(
    *,
    settings: Settings,
    account_number: str,
    broker: BrokerClient | None,
    now: datetime,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
) -> BrokerReconciliationReport:
    issues: list[ReconciliationIssue] = []
    lifecycle = load_lifecycle_state(lifecycle_path, now=now)
    if broker is None:
        return BrokerReconciliationReport(
            generated_at=now.isoformat(timespec="seconds"),
            account_number=account_number,
            broker_positions=0,
            lifecycle_positions=len(lifecycle.positions),
            broker_open_orders=0,
            lifecycle_order_plans=len(lifecycle.order_plans),
            issues=[
                ReconciliationIssue(
                    severity="blocker",
                    code="broker_missing",
                    detail="broker client missing; cannot reconcile live account state",
                )
            ],
            safe_to_arm=False,
        )

    if not account_number.strip():
        issues.append(
            ReconciliationIssue(
                severity="blocker",
                code="account_missing",
                detail="explicit Agentic account number is required",
            )
        )

    try:
        broker_positions = broker.get_positions(account_number)
        broker_orders = broker.get_orders(account_number)
    except Exception as exc:
        return BrokerReconciliationReport(
            generated_at=now.isoformat(timespec="seconds"),
            account_number=account_number,
            broker_positions=0,
            lifecycle_positions=len(lifecycle.positions),
            broker_open_orders=0,
            lifecycle_order_plans=len(lifecycle.order_plans),
            issues=[
                *issues,
                ReconciliationIssue(
                    severity="blocker",
                    code="broker_read_failed",
                    detail=f"broker state read failed: {exc}",
                ),
            ],
            safe_to_arm=False,
        )

    broker_symbols = broker_position_symbols(broker_positions)
    lifecycle_symbols = set(lifecycle.positions)
    for symbol in sorted(broker_symbols - lifecycle_symbols):
        issues.append(
            ReconciliationIssue(
                severity="blocker",
                code="broker_position_missing_lifecycle",
                symbol=symbol,
                detail=f"{symbol}: broker position exists but lifecycle has no LivePositionPlan",
            )
        )
    for symbol in sorted(lifecycle_symbols - broker_symbols):
        issues.append(
            ReconciliationIssue(
                severity="blocker",
                code="lifecycle_position_missing_broker",
                symbol=symbol,
                detail=f"{symbol}: lifecycle position exists but broker has no matching open position",
            )
        )

    broker_orders_open = open_broker_orders(broker_orders)
    lifecycle_order_ids = lifecycle_open_order_refs(lifecycle)
    for order in broker_orders_open:
        if order.order_id not in lifecycle_order_ids:
            issues.append(
                ReconciliationIssue(
                    severity="blocker",
                    code="broker_open_order_missing_lifecycle",
                    symbol=order.symbol,
                    detail=f"{order.symbol}: broker open {order.side} order {order.order_id} is not tracked in lifecycle",
                )
            )
    ready_symbols = lifecycle_ready_symbols(lifecycle)
    for symbol, side in sorted(ready_symbols):
        issues.append(
            ReconciliationIssue(
                severity="blocker",
                code="unplaced_ready_order_plan",
                symbol=symbol,
                detail=f"{symbol}: lifecycle has unplaced READY_TO_PLACE {side} order requiring review/reconciliation",
            )
        )

    for reason in lifecycle_audit_reasons(lifecycle, now=now, settings=settings):
        if "READY_TO_PLACE" in reason:
            continue
        issues.append(
            ReconciliationIssue(
                severity="blocker",
                code="lifecycle_audit",
                detail=reason,
            )
        )

    return BrokerReconciliationReport(
        generated_at=now.isoformat(timespec="seconds"),
        account_number=account_number,
        broker_positions=len(broker_symbols),
        lifecycle_positions=len(lifecycle.positions),
        broker_open_orders=len(broker_orders_open),
        lifecycle_order_plans=len(lifecycle.order_plans),
        issues=issues,
        safe_to_arm=not any(issue.severity == "blocker" for issue in issues),
    )


def write_reconciliation_report(
    report: BrokerReconciliationReport,
    path: Path = RECONCILIATION_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(report), indent=2, sort_keys=True) + "\n")
    return path
