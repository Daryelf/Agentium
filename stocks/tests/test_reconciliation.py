from __future__ import annotations

import json

from stock_guru.broker import BrokerAccountState
from stock_guru.broker_client import BrokerOrder, BrokerPosition, DryRunBrokerClient
from stock_guru.lifecycle import DailyRiskState, IntradayLifecycleState, LivePositionPlan, OrderPlan, save_lifecycle_state
from stock_guru.reconciliation import build_reconciliation_report, write_reconciliation_report
from tests.test_intraday_loop import now, settings


def live_position(symbol: str = "TEST") -> LivePositionPlan:
    return LivePositionPlan(
        symbol=symbol,
        shares=0.25,
        average_cost=100,
        stop_price=98,
        target_1=103,
        target_2=106,
        profit_lock_price=102,
        thesis="test",
        opened_at=now().isoformat(timespec="seconds"),
        force_exit_after=now().replace(hour=15, minute=45).isoformat(timespec="seconds"),
    )


def ready_order(symbol: str = "TEST") -> OrderPlan:
    return OrderPlan(
        side="buy",
        symbol=symbol,
        order_type="limit",
        dollar_amount=25,
        quantity=None,
        limit_price=100,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
    )


def tracked_open_order(symbol: str = "TEST", order_id: str = "order-1") -> OrderPlan:
    return OrderPlan(
        side="buy",
        symbol=symbol,
        order_type="limit",
        dollar_amount=25,
        quantity=None,
        limit_price=100,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        placed_order_id=order_id,
        placement_state="confirmed",
    )


def tracked_open_order_with_state(symbol: str = "TEST", order_id: str = "order-1", state: str = "confirmed") -> OrderPlan:
    plan = tracked_open_order(symbol=symbol, order_id=order_id)
    return OrderPlan(
        side=plan.side,
        symbol=plan.symbol,
        order_type=plan.order_type,
        dollar_amount=plan.dollar_amount,
        quantity=plan.quantity,
        limit_price=plan.limit_price,
        stop_price=plan.stop_price,
        time_in_force=plan.time_in_force,
        market_hours=plan.market_hours,
        status=plan.status,
        placed_order_id=plan.placed_order_id,
        placement_state=state,
    )


def broker(*, positions=None, orders=None) -> DryRunBrokerClient:
    return DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25),
        positions=positions or [],
        orders=orders or [],
    )


def test_reconciliation_passes_when_broker_and_lifecycle_match(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            positions={"TEST": live_position()},
            order_plans=[tracked_open_order()],
        ),
        lifecycle_path,
    )

    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(
            positions=[BrokerPosition("TEST", 0.25, 100)],
            orders=[BrokerOrder("order-1", "TEST", "buy", "confirmed", quantity=0.25)],
        ),
        now=now(),
        lifecycle_path=lifecycle_path,
    )

    assert report.safe_to_arm
    assert report.blockers == []


def test_reconciliation_normalizes_lifecycle_open_order_state(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            order_plans=[tracked_open_order_with_state(state="Partially Filled")],
        ),
        lifecycle_path,
    )

    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(orders=[BrokerOrder("order-1", "TEST", "buy", "partially_filled", quantity=0.1)]),
        now=now(),
        lifecycle_path=lifecycle_path,
    )

    assert report.safe_to_arm
    assert report.blockers == []


def test_reconciliation_blocks_broker_position_missing_lifecycle(tmp_path) -> None:
    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(positions=[BrokerPosition("TEST", 0.25, 100)]),
        now=now(),
        lifecycle_path=tmp_path / "missing.json",
    )

    assert not report.safe_to_arm
    assert report.blockers[0].code == "broker_position_missing_lifecycle"


def test_reconciliation_blocks_lifecycle_position_missing_broker(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            positions={"TEST": live_position()},
        ),
        lifecycle_path,
    )

    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(),
        now=now(),
        lifecycle_path=lifecycle_path,
    )

    assert not report.safe_to_arm
    assert report.blockers[0].code == "lifecycle_position_missing_broker"


def test_reconciliation_blocks_untracked_broker_open_order(tmp_path) -> None:
    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(orders=[BrokerOrder("order-1", "TEST", "buy", "confirmed", quantity=0.25)]),
        now=now(),
        lifecycle_path=tmp_path / "missing.json",
    )

    assert not report.safe_to_arm
    assert report.blockers[0].code == "broker_open_order_missing_lifecycle"


def test_reconciliation_blocks_unplaced_ready_order(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            order_plans=[ready_order()],
        ),
        lifecycle_path,
    )

    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(),
        now=now(),
        lifecycle_path=lifecycle_path,
    )

    assert not report.safe_to_arm
    assert report.blockers[0].code == "unplaced_ready_order_plan"


def test_reconciliation_writes_report(tmp_path) -> None:
    report = build_reconciliation_report(
        settings=settings(),
        account_number="A123",
        broker=broker(),
        now=now(),
        lifecycle_path=tmp_path / "missing.json",
    )

    path = write_reconciliation_report(report, tmp_path / "reconciliation.json")
    payload = json.loads(path.read_text())

    assert payload["safe_to_arm"] is True
    assert payload["account_number"] == "A123"
