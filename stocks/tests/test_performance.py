from __future__ import annotations

import json

from stock_guru.lifecycle import DailyRiskState, IntradayLifecycleState, OrderPlan, save_lifecycle_state
from stock_guru.performance import (
    build_performance_audit,
    build_performance_audit_from_lifecycle,
    performance_audit_markdown,
    realized_trade_records,
    write_performance_audit_json,
    write_performance_audit_markdown,
)
from tests.test_intraday_loop import now, settings


def filled_plan(side: str, symbol: str, shares: float, price: float, placed_at: str, ref_id: str = "") -> OrderPlan:
    return OrderPlan(
        side=side,
        symbol=symbol,
        order_type="market",
        dollar_amount=0,
        quantity=shares,
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status="READY_TO_PLACE",
        placed_order_id=f"{side}-{symbol}-{placed_at}",
        placed_at=placed_at,
        placement_state="filled",
        placement_raw={"filled_quantity": shares, "average_price": price},
        ref_id=ref_id,
    )


def plans() -> list[OrderPlan]:
    return [
        filled_plan("buy", "AAPL", 0.5, 100, "2026-06-08T10:00:00-04:00", "buy-ref"),
        filled_plan("sell", "AAPL", 0.25, 104, "2026-06-08T10:30:00-04:00", "sell-ref-1"),
        filled_plan("sell", "AAPL", 0.25, 98, "2026-06-08T11:00:00-04:00", "sell-ref-2"),
    ]


def test_realized_trade_records_pair_lots_and_keep_order_ids() -> None:
    records = realized_trade_records(plans())

    assert len(records) == 2
    assert records[0].pnl == 1
    assert records[1].pnl == -0.5
    assert records[0].entry_ref_id == "buy-ref"
    assert records[0].exit_ref_id == "sell-ref-1"


def test_build_performance_audit_marks_small_sample_not_ready() -> None:
    report = build_performance_audit(settings=settings(), plans=plans(), now=now())

    assert report.metrics.trades == 2
    assert report.total_pnl == 0.5
    assert report.largest_win == 1
    assert report.largest_loss == -0.5
    assert report.average_trade_duration_minutes == 45
    assert not report.capital_scale_ready
    assert any("trade sample too small" in reason for reason in report.reasons)


def test_build_performance_audit_from_lifecycle_and_write_artifacts(tmp_path) -> None:
    lifecycle_path = tmp_path / "lifecycle.json"
    save_lifecycle_state(
        IntradayLifecycleState(
            daily_risk=DailyRiskState(date=now().date().isoformat()),
            order_plans=plans(),
        ),
        lifecycle_path,
    )

    report = build_performance_audit_from_lifecycle(settings=settings(), lifecycle_path=lifecycle_path, now=now())
    json_path = write_performance_audit_json(report, tmp_path / "performance.json")
    md_path = write_performance_audit_markdown(report, tmp_path / "performance.md")

    payload = json.loads(json_path.read_text())
    markdown = md_path.read_text()

    assert payload["metrics"]["trades"] == 2
    assert "Capital scale ready: NO" in markdown
    assert "| AAPL |" in markdown


def test_performance_audit_markdown_handles_no_trades() -> None:
    report = build_performance_audit(settings=settings(), plans=[], now=now())

    markdown = performance_audit_markdown(report)

    assert "No realized lifecycle trades found" in markdown
