from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from time import monotonic, sleep
from typing import Callable

from .broker_client import BrokerClient
from .config import DATA_DIR, Settings
from .data import download_history, overlay_latest_closes
from .intraday_loop import IntradayCycleResult, run_intraday_control_cycle
from .lifecycle import LIFECYCLE_STATE_PATH, IntradayLifecycleState, TradeIntent, load_lifecycle_state, save_lifecycle_state
from .live_autonomy import LiveSessionGate, live_session_gate, write_kill_switch
from .live_autonomy import KILL_SWITCH_PATH
from .optimization import OPTIMIZATION_REPORT_PATH, optimized_settings_from_report, optimization_reasons
from .strategy_health import STRATEGY_HEALTH_PATH, read_eligible_symbols, strategy_health_reasons


HEARTBEAT_PATH = DATA_DIR / "live_auto_heartbeat.json"
SESSION_STATE_PATH = DATA_DIR / "live_auto_session.json"


@dataclass(frozen=True)
class AutonomousCycleReport:
    gate: LiveSessionGate
    lifecycle_path: Path
    heartbeat_path: Path
    placed_orders: int
    ready_orders: int
    rejected_orders: int
    next_action: str


@dataclass(frozen=True)
class AutonomousSessionCycle:
    cycle: int
    started_at: str
    finished_at: str
    gate_armed: bool
    allow_buys: bool
    allow_sells: bool
    placed_orders: int
    ready_orders: int
    rejected_orders: int
    next_action: str
    reasons: list[str]
    error: str | None = None


@dataclass(frozen=True)
class AutonomousSessionReport:
    session_path: Path
    cycles: list[AutonomousSessionCycle]
    stopped_reason: str
    started_at: str
    finished_at: str


def analysis_symbols(symbols: list[str]) -> list[str]:
    expanded = list(symbols)
    for symbol in ["SPY", "QQQ", "^VIX"]:
        if symbol not in expanded:
            expanded.append(symbol)
    return expanded


def next_action(result: IntradayCycleResult, gate: LiveSessionGate, strategy_reasons: list[str] | None = None) -> str:
    if result.placed_orders:
        return "monitor placed order and reconcile broker fills"
    if strategy_reasons:
        return "stand down; entry evidence blocks new entries"
    if gate.allow_sells and not gate.allow_buys:
        return "kill switch active; exits only"
    if not gate.armed:
        return "stand down; supervised planning gate is blocked"
    if any(plan.status == "READY_TO_PLACE" for plan in result.state.order_plans):
        return "send ready plan to Argentum Human Gate for exact per-order approval"
    return "wait for a cleaner setup"


def write_heartbeat(
    *,
    result: IntradayCycleResult,
    gate: LiveSessionGate,
    account_value: float,
    buying_power: float,
    position_count: int,
    open_order_count: int,
    strategy_reasons: list[str],
    now: datetime,
    path: Path = HEARTBEAT_PATH,
) -> Path:
    payload = {
        "updated_at": now.isoformat(timespec="seconds"),
        "live_auto_armed": gate.armed,
        "direct_broker_placement_enabled": False,
        "allow_buys": gate.allow_buys,
        "allow_sells": gate.allow_sells,
        "gate_reasons": gate.reasons,
        "strategy_health_reasons": strategy_reasons,
        "account_value": round(account_value, 4),
        "buying_power": round(buying_power, 4),
        "positions": position_count,
        "open_orders": open_order_count,
        "daily_risk": asdict(result.state.daily_risk),
        "placed_orders": len(result.placed_orders),
        "ready_orders": sum(1 for plan in result.state.order_plans if plan.status == "READY_TO_PLACE"),
        "rejected_orders": sum(1 for plan in result.state.order_plans if plan.status == "REJECTED"),
        "last_placed_order": asdict(result.state.order_plans[0]) if result.state.order_plans and result.placed_orders else None,
        "next_action": next_action(result, gate, strategy_reasons),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def write_session_state(
    *,
    cycles: list[AutonomousSessionCycle],
    stopped_reason: str,
    started_at: datetime,
    finished_at: datetime,
    path: Path = SESSION_STATE_PATH,
) -> Path:
    payload = {
        "started_at": started_at.isoformat(timespec="seconds"),
        "finished_at": finished_at.isoformat(timespec="seconds"),
        "stopped_reason": stopped_reason,
        "cycles": [asdict(cycle) for cycle in cycles],
        "last_cycle": asdict(cycles[-1]) if cycles else None,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def run_autonomous_cycle(
    *,
    symbols: list[str],
    settings: Settings,
    broker: BrokerClient,
    account_number: str,
    now: datetime,
    sector_aligned: bool = True,
    news_verified: bool = True,
    execute: bool = True,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    heartbeat_path: Path = HEARTBEAT_PATH,
    kill_switch_path: Path = KILL_SWITCH_PATH,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    optimization_report_path: Path = OPTIMIZATION_REPORT_PATH,
) -> AutonomousCycleReport:
    gate = live_session_gate(settings, account_number=account_number, now=now, kill_switch_path=kill_switch_path)
    if not gate.allow_buys and not gate.allow_sells:
        lifecycle = load_lifecycle_state(lifecycle_path, now=now)
        state = IntradayLifecycleState(
            daily_risk=lifecycle.daily_risk,
            intents=[
                TradeIntent(
                    symbol="SYSTEM",
                    side="buy",
                    setup_type="Live Gate Blocked",
                    confidence_score=0,
                    entry_price=0,
                    entry_zone="",
                    stop_price=0,
                    target_1=0,
                    target_2=0,
                    risk_reward_ratio=0,
                    risk_dollars=0,
                    status="INTRADAY_REJECT",
                    rejection_reasons=gate.reasons or ["live gate blocked"],
                    created_at=now.isoformat(timespec="seconds"),
                )
            ],
            order_plans=lifecycle.order_plans,
            positions=lifecycle.positions,
            updated_at=now.isoformat(timespec="seconds"),
        )
        result = IntradayCycleResult(state=state, placed_orders=[], rejected_reasons=gate.reasons)
        saved_lifecycle = save_lifecycle_state(result.state, lifecycle_path)
        saved_heartbeat = write_heartbeat(
            result=result,
            gate=gate,
            account_value=0.0,
            buying_power=0.0,
            position_count=len(lifecycle.positions),
            open_order_count=0,
            strategy_reasons=[],
            now=now,
            path=heartbeat_path,
        )
        return AutonomousCycleReport(
            gate=gate,
            lifecycle_path=saved_lifecycle,
            heartbeat_path=saved_heartbeat,
            placed_orders=0,
            ready_orders=0,
            rejected_orders=0,
            next_action=next_action(result, gate),
        )
    active_settings = settings
    optimization_entry_reasons = (
        optimization_reasons(settings, now=now, path=optimization_report_path)
        if settings.live_require_optimization_for_entries
        else []
    )
    if settings.live_use_optimized_intraday_settings:
        optimized_settings, optimized_reasons = optimized_settings_from_report(settings, now=now, path=optimization_report_path)
        if optimized_reasons:
            optimization_entry_reasons.extend(reason for reason in optimized_reasons if reason not in optimization_entry_reasons)
        else:
            active_settings = optimized_settings
    strategy_reasons = (
        strategy_health_reasons(active_settings, path=strategy_health_path)
        if active_settings.live_require_strategy_health_for_entries
        else []
    )
    entry_block_reasons = [*strategy_reasons, *optimization_entry_reasons]
    selected_symbols = list(symbols)
    eligible_symbols = read_eligible_symbols(strategy_health_path)
    if eligible_symbols is not None:
        selected_symbols = [symbol for symbol in symbols if symbol in set(eligible_symbols)]
        if not selected_symbols:
            entry_block_reasons.append("no replay-qualified symbols selected")

    data = download_history(analysis_symbols(symbols), period="5d", interval="1m", prefer_cache=False)
    quotes = broker.get_quotes(analysis_symbols(symbols))
    latest = {symbol: quote.last for symbol, quote in quotes.items() if quote.last and quote.last > 0}
    if latest:
        data = overlay_latest_closes(data, latest)

    lifecycle = load_lifecycle_state(lifecycle_path, now=now)
    account = broker.get_portfolio(account_number)
    positions = broker.get_positions(account_number)
    open_orders = [order for order in broker.get_orders(account_number) if order.is_open]
    result = run_intraday_control_cycle(
        data=data,
        symbols=selected_symbols or symbols,
        settings=active_settings,
        broker=broker,
        account_number=account_number,
        lifecycle=lifecycle,
        now=now,
        sector_aligned=sector_aligned,
        news_verified=news_verified,
        execute=execute,
        execute_entries=execute and gate.allow_buys and not entry_block_reasons,
        execute_exits=execute and gate.allow_sells,
        allow_entries=gate.allow_buys and not entry_block_reasons,
        entry_block_reasons=[*(gate.reasons or []), *entry_block_reasons] or ["live entries are blocked"],
    )
    saved_lifecycle = save_lifecycle_state(result.state, lifecycle_path)
    saved_heartbeat = write_heartbeat(
        result=result,
        gate=gate,
        account_value=account.account_value,
        buying_power=account.buying_power,
        position_count=len(positions),
        open_order_count=len(open_orders),
        strategy_reasons=entry_block_reasons,
        now=now,
        path=heartbeat_path,
    )
    return AutonomousCycleReport(
        gate=gate,
        lifecycle_path=saved_lifecycle,
        heartbeat_path=saved_heartbeat,
        placed_orders=len(result.placed_orders),
        ready_orders=sum(1 for plan in result.state.order_plans if plan.status == "READY_TO_PLACE"),
        rejected_orders=sum(1 for plan in result.state.order_plans if plan.status == "REJECTED"),
        next_action=next_action(result, gate, entry_block_reasons),
    )


def run_autonomous_session(
    *,
    symbols: list[str],
    settings: Settings,
    broker: BrokerClient,
    account_number: str,
    interval_seconds: float = 60.0,
    max_cycles: int | None = None,
    max_runtime_seconds: float | None = None,
    max_consecutive_errors: int = 3,
    stop_on_gate_blocked: bool = True,
    execute: bool = True,
    sector_aligned: bool = True,
    news_verified: bool = True,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    heartbeat_path: Path = HEARTBEAT_PATH,
    session_path: Path = SESSION_STATE_PATH,
    kill_switch_path: Path = KILL_SWITCH_PATH,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    optimization_report_path: Path = OPTIMIZATION_REPORT_PATH,
    now_fn: Callable[[], datetime] | None = None,
    sleep_fn: Callable[[float], None] | None = None,
    cycle_fn: Callable[..., AutonomousCycleReport] = run_autonomous_cycle,
) -> AutonomousSessionReport:
    """Run supervised autonomous cycles until a hard stop condition is reached."""

    if interval_seconds < 0:
        raise ValueError("interval_seconds must be non-negative")
    if max_cycles is not None and max_cycles <= 0:
        raise ValueError("max_cycles must be positive when provided")
    if max_consecutive_errors <= 0:
        raise ValueError("max_consecutive_errors must be positive")

    clock = now_fn or (lambda: datetime.now().astimezone())
    pause = sleep_fn or sleep
    started_at = clock()
    started_monotonic = monotonic()
    cycles: list[AutonomousSessionCycle] = []
    consecutive_errors = 0
    stopped_reason = "max cycles reached"

    while True:
        cycle_number = len(cycles) + 1
        cycle_started = clock()
        try:
            report = cycle_fn(
                symbols=symbols,
                settings=settings,
                broker=broker,
                account_number=account_number,
                now=cycle_started,
                sector_aligned=sector_aligned,
                news_verified=news_verified,
                execute=execute,
                lifecycle_path=lifecycle_path,
                heartbeat_path=heartbeat_path,
                kill_switch_path=kill_switch_path,
                strategy_health_path=strategy_health_path,
                optimization_report_path=optimization_report_path,
            )
            cycle = AutonomousSessionCycle(
                cycle=cycle_number,
                started_at=cycle_started.isoformat(timespec="seconds"),
                finished_at=clock().isoformat(timespec="seconds"),
                gate_armed=report.gate.armed,
                allow_buys=report.gate.allow_buys,
                allow_sells=report.gate.allow_sells,
                placed_orders=report.placed_orders,
                ready_orders=report.ready_orders,
                rejected_orders=report.rejected_orders,
                next_action=report.next_action,
                reasons=report.gate.reasons,
            )
            consecutive_errors = 0
        except Exception as exc:
            consecutive_errors += 1
            cycle = AutonomousSessionCycle(
                cycle=cycle_number,
                started_at=cycle_started.isoformat(timespec="seconds"),
                finished_at=clock().isoformat(timespec="seconds"),
                gate_armed=False,
                allow_buys=False,
                allow_sells=False,
                placed_orders=0,
                ready_orders=0,
                rejected_orders=0,
                next_action="stand down; autonomous cycle error",
                reasons=["autonomous cycle error"],
                error=str(exc),
            )
            if consecutive_errors >= max_consecutive_errors:
                write_kill_switch(
                    True,
                    reason=f"autonomous session stopped after {consecutive_errors} consecutive errors: {exc}",
                    path=kill_switch_path,
                )
                stopped_reason = "consecutive error limit reached; kill switch enabled"
                cycles.append(cycle)
                break

        cycles.append(cycle)

        if max_cycles is not None and len(cycles) >= max_cycles:
            stopped_reason = "max cycles reached"
            break
        if max_runtime_seconds is not None and monotonic() - started_monotonic >= max_runtime_seconds:
            stopped_reason = "max runtime reached"
            break
        if stop_on_gate_blocked and cycle.error is None and not cycle.gate_armed and not cycle.allow_sells:
            stopped_reason = "live gate blocked"
            break

        pause(interval_seconds)

    finished_at = clock()
    saved_session = write_session_state(
        cycles=cycles,
        stopped_reason=stopped_reason,
        started_at=started_at,
        finished_at=finished_at,
        path=session_path,
    )
    return AutonomousSessionReport(
        session_path=saved_session,
        cycles=cycles,
        stopped_reason=stopped_reason,
        started_at=started_at.isoformat(timespec="seconds"),
        finished_at=finished_at.isoformat(timespec="seconds"),
    )
