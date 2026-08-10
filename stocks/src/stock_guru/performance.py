from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .backtest import BacktestMetrics, metrics_for_trades, plan_fill_price, plan_fill_shares
from .config import DATA_DIR, REPORT_DIR, Settings
from .lifecycle import LIFECYCLE_STATE_PATH, OrderPlan, load_lifecycle_state


PERFORMANCE_REPORT_PATH = DATA_DIR / "performance_audit.json"
PERFORMANCE_MARKDOWN_PATH = REPORT_DIR / "performance_audit.md"


@dataclass(frozen=True)
class TradeRecord:
    symbol: str
    shares: float
    entry_price: float
    exit_price: float
    pnl: float
    pnl_pct: float
    entry_time: str
    exit_time: str
    entry_order_id: str
    exit_order_id: str
    entry_ref_id: str
    exit_ref_id: str


@dataclass(frozen=True)
class PerformanceAuditReport:
    generated_at: str
    metrics: BacktestMetrics
    total_pnl: float
    ending_equity_curve: float
    largest_win: float
    largest_loss: float
    profit_factor: float
    average_trade_duration_minutes: float
    capital_scale_ready: bool
    reasons: list[str]
    trades: list[TradeRecord]


def _timestamp(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def realized_trade_records(plans: Iterable[OrderPlan]) -> list[TradeRecord]:
    open_lots: dict[str, list[tuple[float, OrderPlan]]] = {}
    records: list[TradeRecord] = []
    ordered = sorted(plans, key=lambda plan: plan.placed_at or "")
    for plan in ordered:
        if plan.placement_state not in {"filled", "partially_filled"}:
            continue
        price = plan_fill_price(plan)
        shares = plan_fill_shares(plan)
        if price <= 0 or shares <= 0:
            continue
        symbol = plan.symbol.upper()
        if plan.side == "buy":
            open_lots.setdefault(symbol, []).append((shares, plan))
            continue
        if plan.side != "sell":
            continue
        remaining = shares
        lots = open_lots.setdefault(symbol, [])
        while remaining > 0 and lots:
            lot_shares, entry = lots[0]
            closed = min(lot_shares, remaining)
            entry_price = plan_fill_price(entry)
            if entry_price <= 0:
                break
            pnl = round((price - entry_price) * closed, 4)
            pnl_pct = round((price - entry_price) / entry_price, 6)
            records.append(
                TradeRecord(
                    symbol=symbol,
                    shares=round(closed, 6),
                    entry_price=round(entry_price, 4),
                    exit_price=round(price, 4),
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    entry_time=entry.placed_at,
                    exit_time=plan.placed_at,
                    entry_order_id=entry.placed_order_id,
                    exit_order_id=plan.placed_order_id,
                    entry_ref_id=entry.ref_id,
                    exit_ref_id=plan.ref_id,
                )
            )
            remaining = round(remaining - closed, 6)
            lot_shares = round(lot_shares - closed, 6)
            if lot_shares <= 0:
                lots.pop(0)
            else:
                lots[0] = (lot_shares, entry)
    return records


def _metrics_records(records: list[TradeRecord]) -> BacktestMetrics:
    from .backtest import SimulatedTrade

    return metrics_for_trades(
        SimulatedTrade(
            symbol=record.symbol,
            entry_price=record.entry_price,
            exit_price=record.exit_price,
            shares=record.shares,
            entry_reason="filled lifecycle buy",
            exit_reason="filled lifecycle sell",
        )
        for record in records
    )


def _average_duration_minutes(records: list[TradeRecord]) -> float:
    durations: list[float] = []
    for record in records:
        entry = _timestamp(record.entry_time)
        exit_ = _timestamp(record.exit_time)
        if entry and exit_:
            durations.append(max(0.0, (exit_ - entry).total_seconds() / 60.0))
    return round(sum(durations) / len(durations), 2) if durations else 0.0


def build_performance_audit(
    *,
    settings: Settings,
    plans: Iterable[OrderPlan],
    now: datetime,
) -> PerformanceAuditReport:
    records = realized_trade_records(plans)
    metrics = _metrics_records(records)
    wins = [record.pnl for record in records if record.pnl > 0]
    losses = [record.pnl for record in records if record.pnl <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = round(gross_win / gross_loss, 4) if gross_loss > 0 else (round(gross_win, 4) if gross_win > 0 else 0.0)
    total_pnl = round(sum(record.pnl for record in records), 4)
    reasons: list[str] = []
    if metrics.trades < settings.live_min_strategy_trades:
        reasons.append(f"trade sample too small: {metrics.trades} < {settings.live_min_strategy_trades}")
    if metrics.expectancy <= settings.live_min_strategy_expectancy:
        reasons.append(f"expectancy too weak: {metrics.expectancy:.4f}")
    drawdown_pct = metrics.max_drawdown / max(settings.live_principal_dollars, 1.0)
    if drawdown_pct > settings.live_max_strategy_drawdown_pct:
        reasons.append(f"drawdown too high: {drawdown_pct:.4f}")
    if profit_factor and profit_factor < 1.2:
        reasons.append(f"profit factor too low: {profit_factor:.4f}")
    return PerformanceAuditReport(
        generated_at=now.isoformat(timespec="seconds"),
        metrics=metrics,
        total_pnl=total_pnl,
        ending_equity_curve=total_pnl,
        largest_win=round(max(wins), 4) if wins else 0.0,
        largest_loss=round(min(losses), 4) if losses else 0.0,
        profit_factor=profit_factor,
        average_trade_duration_minutes=_average_duration_minutes(records),
        capital_scale_ready=not reasons,
        reasons=reasons,
        trades=records,
    )


def build_performance_audit_from_lifecycle(
    *,
    settings: Settings,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    now: datetime,
) -> PerformanceAuditReport:
    lifecycle = load_lifecycle_state(lifecycle_path, now=now)
    return build_performance_audit(settings=settings, plans=lifecycle.order_plans, now=now)


def write_performance_audit_json(
    report: PerformanceAuditReport,
    path: Path = PERFORMANCE_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(report), indent=2, sort_keys=True) + "\n")
    return path


def performance_audit_markdown(report: PerformanceAuditReport) -> str:
    lines = [
        "# Performance Audit",
        "",
        f"Generated: {report.generated_at}",
        f"Capital scale ready: {'YES' if report.capital_scale_ready else 'NO'}",
        "",
        "## Metrics",
        "",
        f"- Trades: {report.metrics.trades}",
        f"- Win rate: {report.metrics.win_rate:.1%}",
        f"- Expectancy: ${report.metrics.expectancy:.4f}",
        f"- Total P/L: ${report.total_pnl:.4f}",
        f"- Max drawdown: ${report.metrics.max_drawdown:.4f}",
        f"- Profit factor: {report.profit_factor:.4f}",
        f"- Average duration: {report.average_trade_duration_minutes:.2f} minutes",
        "",
    ]
    if report.reasons:
        lines.extend(["## Blockers", ""])
        lines.extend(f"- {reason}" for reason in report.reasons)
        lines.append("")
    lines.extend(["## Trades", ""])
    if not report.trades:
        lines.append("- No realized lifecycle trades found.")
    else:
        lines.append("| Symbol | Shares | Entry | Exit | P/L | P/L % | Entry Time | Exit Time |")
        lines.append("|---|---:|---:|---:|---:|---:|---|---|")
        for trade in report.trades:
            lines.append(
                f"| {trade.symbol} | {trade.shares:.6f} | ${trade.entry_price:.4f} | ${trade.exit_price:.4f} | "
                f"${trade.pnl:.4f} | {trade.pnl_pct:.2%} | {trade.entry_time} | {trade.exit_time} |"
            )
    return "\n".join(lines) + "\n"


def write_performance_audit_markdown(
    report: PerformanceAuditReport,
    path: Path = PERFORMANCE_MARKDOWN_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(performance_audit_markdown(report))
    return path
