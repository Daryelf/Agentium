from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
import time
import warnings
from typing import List, Optional

import typer
from rich.console import Console
from rich.table import Table

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

from .bot import BotSnapshot, load_bot_state, reset_bot_state, run_bot_once
from .account_health import ACCOUNT_HEALTH_REPORT_PATH, build_account_health_report, write_account_health_report
from .arm_plan import ARM_PLAN_PATH, build_live_auto_arm_plan, write_arm_plan
from .broker import BrokerAccountState, BrokerGuardrails, BrokerMission, build_mission_lines, write_mission_report
from .broker_client import BrokerOrder, BrokerPosition, DryRunBrokerClient
from .capital_policy import CAPITAL_POLICY_REPORT_PATH, capital_policy_from_performance_report, write_capital_policy_report
from .config import load_settings, load_universe, normalize_tickers
from .copilot import TradeTicket, build_trade_ticket, write_ticket_markdown
from .copy_trader import (
    COPY_HISTORY_PATH,
    COPY_PLAN_MARKDOWN_PATH,
    COPY_PLAN_PATH,
    COPY_SIGNALS_PATH,
    COPY_TRADER_CONFIG_PATH,
    apply_paper_candidates,
    build_mirror_plan,
    load_copy_history,
    load_copy_policy,
    load_public_signals,
    write_mirror_plan,
)
from .copy_knowledge import (
    COPY_KNOWLEDGE_MARKDOWN_PATH,
    COPY_KNOWLEDGE_PATH,
    COPY_PRICE_OBSERVATIONS_PATH,
    build_copy_knowledge,
    capture_signal_price_observations,
    copy_knowledge_dict,
    load_price_observations,
    write_copy_knowledge,
)
from .data import MarketData, download_history, latest_prices, load_provider_keys, overlay_latest_closes
from .evaluator import EVALUATIONS_PATH, PositionSnapshot, QuoteSnapshot, TradeEvaluation, VALID_BUY_SETUP, VALID_SELL_SIGNAL, build_indicator_snapshot, evaluate_market_data, market_condition, write_evaluations_json
from .evidence_bundle import build_local_evidence_bundle
from .intraday_loop import run_intraday_control_cycle
from .intraday_replay import optimize_intraday_replay, optimize_intraday_walk_forward, replay_intraday_rules
from .launch_checklist import LAUNCH_CHECKLIST_PATH, build_launch_checklist, write_launch_checklist
from .lifecycle import BrokerReview, IntradayLifecycleState, load_lifecycle_state, save_lifecycle_state
from .live_autonomy import KILL_SWITCH_PATH, live_auto_reasons, live_session_gate, write_kill_switch
from .autonomous import HEARTBEAT_PATH, SESSION_STATE_PATH, run_autonomous_session
from .readiness import build_readiness_report, write_strategy_health_from_lifecycle
from .strategy_health import write_strategy_health
from .optimization import write_optimization_report, write_walk_forward_optimization_report
from .preparation import prepare_live_auto
from .performance import (
    PERFORMANCE_MARKDOWN_PATH,
    PERFORMANCE_REPORT_PATH,
    build_performance_audit_from_lifecycle,
    write_performance_audit_json,
    write_performance_audit_markdown,
)
from .reconciliation import RECONCILIATION_REPORT_PATH, build_reconciliation_report, write_reconciliation_report
from .market import market_state
from .notifier import (
    TelegramConfigError,
    create_telegram_approval_request,
    format_evaluation_update,
    format_market_status_update,
    format_manual_notification,
    format_money,
    format_telegram_approval_request,
    format_ticket_update,
    load_telegram_approval_state,
    poll_telegram_approval,
    save_last_signature,
    send_telegram_message,
    should_send_update,
)
from .paper import read_ledger, record_trade
from .research import fetch_equity_research, money as research_money, pct as research_pct, ratio as research_ratio, write_research_report
from .reports import write_markdown_report
from .scoring import Candidate, score_candidates
from .sec_13f import (
    SEC_13F_IMPORT_STATUS_PATH,
    SEC_13F_WATCHLIST_PATH,
    refresh_sec_13f_signals,
)
from .sec_form4 import (
    SEC_FORM4_IMPORT_STATUS_PATH,
    SEC_FORM4_WATCHLIST_PATH,
    SEC_USER_AGENT_ENV,
    refresh_sec_form4_signals,
)
from .universe import DynamicUniverse, build_dynamic_universe


app = typer.Typer(help="Live market scanner and paper-trading toolkit.")
paper_app = typer.Typer(help="Paper-trading journal.")
telegram_app = typer.Typer(help="Telegram approval receiver.")
app.add_typer(paper_app, name="paper")
app.add_typer(telegram_app, name="telegram")
console = Console()
LIVE_AGENT_STATE_PATH = Path(__file__).resolve().parents[2] / "data" / "live_agent_state.json"


def format_pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def render_candidates(candidates: list[Candidate], limit: int) -> None:
    table = Table(title="Stock Guru Rankings")
    table.add_column("#", justify="right")
    table.add_column("Ticker")
    table.add_column("Rating")
    table.add_column("Score", justify="right")
    table.add_column("Price", justify="right")
    table.add_column("1D", justify="right")
    table.add_column("20D", justify="right")
    table.add_column("60D", justify="right")
    table.add_column("Vol", justify="right")
    table.add_column("Size", justify="right")
    table.add_column("Why")

    for idx, item in enumerate(candidates[:limit], start=1):
        style = "green" if item.rating == "Strong" else "yellow" if item.rating == "Watch" else "red"
        table.add_row(
            str(idx),
            item.ticker,
            f"[{style}]{item.rating}[/{style}]",
            f"{item.score:.1f}",
            f"${item.price:.2f}",
            format_pct(item.daily_return),
            format_pct(item.momentum_20d),
            format_pct(item.momentum_60d),
            format_pct(item.volatility_20d),
            f"{item.suggested_shares} sh",
            ", ".join(item.reasons) or "none",
        )
    console.print(table)


def render_bot_snapshot(snapshot: BotSnapshot, limit: int) -> None:
    decision = snapshot.decision
    console.print(
        f"Paper bot: {decision.action}"
        f"{' ' + decision.ticker if decision.ticker else ''}"
        f" | {decision.reason}"
    )
    console.print(
        f"Equity: ${snapshot.equity:,.2f} | Cash: ${snapshot.state.cash:,.2f} | "
        f"Unrealized P/L: ${snapshot.unrealized_pnl:,.2f}"
    )

    position_table = Table(title="Paper Bot Positions")
    for column in ["Ticker", "Shares", "Avg Cost", "Cost Basis", "Stop", "Target"]:
        position_table.add_column(column)
    for position in snapshot.state.positions.values():
        position_table.add_row(
            position.ticker,
            f"{position.shares:.6f}",
            f"${position.avg_cost:.2f}",
            f"${position.cost_basis:,.2f}",
            f"${position.stop_price:.2f}" if position.stop_price is not None else "N/A",
            f"${position.take_profit_price:.2f}" if position.take_profit_price is not None else "N/A",
        )
    console.print(position_table)
    render_candidates(snapshot.candidates, limit)


def render_trade_ticket(ticket: TradeTicket) -> None:
    table = Table(title="Manual Trade Copilot Ticket")
    table.add_column("Field")
    table.add_column("Value")
    table.add_row("Mode", "paper signal only; you must place any broker order yourself")
    table.add_row("Action", ticket.action)
    table.add_row("Ticker", ticket.ticker or "N/A")
    table.add_row("Reason", ticket.reason)
    table.add_row("Shares", f"{ticket.shares:.6f}")
    table.add_row("Estimated price", f"${ticket.estimated_price:.2f}")
    table.add_row("Notional", f"${ticket.notional:.2f}")
    table.add_row("Cash now", f"${ticket.cash_now:.2f}")
    table.add_row("Cash after signal", f"${ticket.cash_after_signal:.2f}")
    if ticket.stop_price is not None:
        table.add_row("Stop", f"${ticket.stop_price:.2f}")
    if ticket.take_profit_price is not None:
        table.add_row("Take profit", f"${ticket.take_profit_price:.2f}")
    if ticket.generated_at is not None:
        table.add_row("Generated", ticket.generated_at.isoformat(timespec="seconds"))
    if ticket.expires_at is not None:
        table.add_row("Refresh after", ticket.expires_at.isoformat(timespec="seconds"))
    console.print(table)


def render_evaluations(evaluations: list[TradeEvaluation], limit: int) -> None:
    table = Table(title="Trade Evaluator")
    for column in ["Ticker", "Decision", "Setup", "Score", "Confidence", "Price", "R/R", "Main Risk"]:
        table.add_column(column)
    for item in evaluations[:limit]:
        table.add_row(
            item.ticker,
            item.decision,
            item.setup_type,
            str(item.score),
            item.confidence,
            f"${item.current_price:.2f}",
            item.risk_reward,
            item.main_risk,
        )
    console.print(table)


@app.command("copy-plan")
def copy_plan(
    signals_json: Path = typer.Option(COPY_SIGNALS_PATH, "--signals-json", help="Public-signal inbox using the copy_signals schema."),
    config: Path = typer.Option(COPY_TRADER_CONFIG_PATH, "--config", help="Copy Trader policy and source registry."),
    history_json: Path = typer.Option(COPY_HISTORY_PATH, "--history-json", help="Applied paper-signal fingerprint history."),
    output_json: Path = typer.Option(COPY_PLAN_PATH, "--output-json", help="Generated machine-readable mirror plan."),
    output_markdown: Path = typer.Option(COPY_PLAN_MARKDOWN_PATH, "--output-markdown", help="Generated operator-readable mirror report."),
    observations_json: Path = typer.Option(COPY_PRICE_OBSERVATIONS_PATH, "--observations-json", help="Append-only real price/fill observation ledger."),
    knowledge_json: Path = typer.Option(COPY_KNOWLEDGE_PATH, "--knowledge-json", help="Generated evidence-weighted source/trader knowledge report."),
    knowledge_markdown: Path = typer.Option(COPY_KNOWLEDGE_MARKDOWN_PATH, "--knowledge-markdown", help="Generated operator-readable knowledge report."),
    as_of: Optional[str] = typer.Option(None, "--as-of", help="Optional ISO-8601 evaluation time for deterministic testing."),
    apply_paper: bool = typer.Option(False, "--apply-paper", help="Append paper-ready candidates to the local paper ledger. Never places a live order."),
) -> None:
    """Build a delay-aware public-trade mirror plan with paper/Human Gate boundaries."""
    try:
        policy = load_copy_policy(config)
        signals, import_warnings = load_public_signals(signals_json)
        evaluated_at = datetime.fromisoformat(as_of.replace("Z", "+00:00")) if as_of else None
        observations, observation_warnings = load_price_observations(observations_json)
        knowledge_report = build_copy_knowledge(
            signals,
            observations,
            policy,
            now=evaluated_at,
            import_warnings=observation_warnings,
        )
        write_copy_knowledge(knowledge_report, knowledge_json, knowledge_markdown)
        plan = build_mirror_plan(
            signals,
            policy,
            now=evaluated_at,
            history_fingerprints=load_copy_history(history_json),
            import_warnings=import_warnings,
            knowledge=copy_knowledge_dict(knowledge_report),
        )
        json_path, markdown_path = write_mirror_plan(plan, output_json, output_markdown)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        console.print(f"Copy plan failed closed: {exc}")
        raise typer.Exit(1)

    table = Table(title="Copy Trader Mirror Lab")
    for column in ["Source", "Trader", "Signal", "Status", "Lag", "Drift", "Paper Size", "Reason"]:
        table.add_column(column)
    for candidate in plan.candidates:
        table.add_row(
            candidate.source_name,
            candidate.trader_name,
            f"{candidate.side} {candidate.symbol}",
            candidate.status,
            f"{candidate.disclosure_lag_hours:.1f}h",
            f"{candidate.price_drift_pct:.2%}" if candidate.price_drift_pct is not None else "unknown",
            f"${candidate.mirror_notional_dollars:.2f}",
            candidate.reasons[0] if candidate.reasons else "none recorded",
        )
    console.print(table)
    console.print(
        f"Signals {plan.summary['signals_received']} | paper-ready {plan.summary['paper_ready']} | "
        f"research-only {plan.summary['research_only']} | rejected {plan.summary['rejected']} | "
        f"live orders placed {plan.summary['live_orders_placed']}"
    )
    console.print(f"Wrote mirror plan: {json_path}")
    console.print(f"Wrote mirror report: {markdown_path}")
    console.print(f"Wrote copy knowledge: {knowledge_json}")
    if apply_paper:
        trades = apply_paper_candidates(
            plan,
            timezone_name=load_settings().market_timezone,
            history_path=history_json,
        )
        console.print(f"Applied {len(trades)} paper mirror trade(s). No live broker order was placed.")


@app.command("copy-knowledge")
def copy_knowledge(
    signals_json: Path = typer.Option(COPY_SIGNALS_PATH, "--signals-json", help="Public-signal inbox used as the outcome cohort."),
    observations_json: Path = typer.Option(COPY_PRICE_OBSERVATIONS_PATH, "--observations-json", help="Append-only real price/fill observation ledger."),
    config: Path = typer.Option(COPY_TRADER_CONFIG_PATH, "--config", help="Copy Trader source and evidence policy."),
    output_json: Path = typer.Option(COPY_KNOWLEDGE_PATH, "--output-json", help="Generated machine-readable knowledge ledger."),
    output_markdown: Path = typer.Option(COPY_KNOWLEDGE_MARKDOWN_PATH, "--output-markdown", help="Generated operator-readable knowledge report."),
    as_of: Optional[str] = typer.Option(None, "--as-of", help="Optional ISO-8601 cutoff; observations after it are ignored."),
) -> None:
    """Measure post-disclosure source/trader outcomes without look-ahead or broker actions."""
    try:
        policy = load_copy_policy(config)
        signals, signal_warnings = load_public_signals(signals_json)
        observations, observation_warnings = load_price_observations(observations_json)
        evaluated_at = datetime.fromisoformat(as_of.replace("Z", "+00:00")) if as_of else None
        report = build_copy_knowledge(
            signals,
            observations,
            policy,
            now=evaluated_at,
            import_warnings=[*signal_warnings, *observation_warnings],
        )
        json_path, markdown_path = write_copy_knowledge(report, output_json, output_markdown)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        console.print(f"Copy knowledge failed closed: {exc}")
        raise typer.Exit(1)
    table = Table(title="Copy Trader Knowledge")
    for column in ["Source", "Samples", "Hit rate", "Mean return", "Evidence", "Status"]:
        table.add_column(column)
    for profile in report.source_profiles:
        table.add_row(
            profile.source_id,
            str(profile.sample_size),
            f"{profile.hit_rate:.1%}",
            f"{profile.mean_directional_return:.2%}",
            f"{profile.evidence_score:.3f}",
            profile.evidence_status,
        )
    console.print(table)
    console.print(
        f"Measured {report.summary['measured_outcomes']} outcome(s); "
        f"pending {report.summary['pending_outcomes']}; live orders placed 0."
    )
    console.print(f"Wrote knowledge ledger: {json_path}")
    console.print(f"Wrote knowledge report: {markdown_path}")


def _refresh_sec_copy_plan(
    *,
    watchlist: Path,
    signals_json: Path,
    config: Path,
    history_json: Path,
    status_json: Path,
    output_json: Path,
    output_markdown: Path,
    observations_json: Path,
    knowledge_json: Path,
    knowledge_markdown: Path,
    user_agent: Optional[str],
    max_filings: int,
) -> tuple[object, object, int]:
    refresh = refresh_sec_form4_signals(
        watchlist_path=watchlist,
        signals_path=signals_json,
        status_path=status_json,
        user_agent=user_agent,
        max_filings_per_entry=max_filings,
        price_lookup=latest_prices,
    )
    policy = load_copy_policy(config)
    signals, import_warnings = load_public_signals(signals_json)
    captured, capture_warnings = capture_signal_price_observations(signals, path=observations_json)
    observations, observation_warnings = load_price_observations(observations_json)
    knowledge_report = build_copy_knowledge(
        signals,
        observations,
        policy,
        import_warnings=[*capture_warnings, *observation_warnings],
    )
    write_copy_knowledge(knowledge_report, knowledge_json, knowledge_markdown)
    plan = build_mirror_plan(
        signals,
        policy,
        history_fingerprints=load_copy_history(history_json),
        import_warnings=[*refresh.warnings, *import_warnings],
        knowledge=copy_knowledge_dict(knowledge_report),
    )
    write_mirror_plan(plan, output_json, output_markdown)
    return refresh, plan, captured


@app.command("copy-refresh-sec")
def copy_refresh_sec(
    watchlist: Path = typer.Option(SEC_FORM4_WATCHLIST_PATH, "--watchlist", help="Named SEC reporting-person/entity CIK watchlist."),
    signals_json: Path = typer.Option(COPY_SIGNALS_PATH, "--signals-json", help="Local public-signal inbox to update."),
    config: Path = typer.Option(COPY_TRADER_CONFIG_PATH, "--config", help="Copy Trader policy and source registry."),
    history_json: Path = typer.Option(COPY_HISTORY_PATH, "--history-json", help="Applied paper-signal fingerprint history."),
    status_json: Path = typer.Option(SEC_FORM4_IMPORT_STATUS_PATH, "--status-json", help="Bounded importer status report."),
    output_json: Path = typer.Option(COPY_PLAN_PATH, "--output-json", help="Generated machine-readable mirror plan."),
    output_markdown: Path = typer.Option(COPY_PLAN_MARKDOWN_PATH, "--output-markdown", help="Generated operator-readable mirror report."),
    observations_json: Path = typer.Option(COPY_PRICE_OBSERVATIONS_PATH, "--observations-json", help="Append-only post-disclosure price observation ledger."),
    knowledge_json: Path = typer.Option(COPY_KNOWLEDGE_PATH, "--knowledge-json", help="Generated source/trader knowledge report."),
    knowledge_markdown: Path = typer.Option(COPY_KNOWLEDGE_MARKDOWN_PATH, "--knowledge-markdown", help="Generated operator-readable knowledge report."),
    user_agent: Optional[str] = typer.Option(None, "--user-agent", envvar=SEC_USER_AGENT_ENV, help=f"SEC-compliant app/contact identity; prefer the {SEC_USER_AGENT_ENV} environment variable."),
    max_filings: int = typer.Option(10, "--max-filings", min=1, max=50, help="Maximum recent Form 4 filings fetched per enabled watchlist entry."),
) -> None:
    """Refresh official SEC Form 4 signals and rebuild the paper/Human Gate plan."""
    try:
        refresh, plan, captured = _refresh_sec_copy_plan(
            watchlist=watchlist,
            signals_json=signals_json,
            config=config,
            history_json=history_json,
            status_json=status_json,
            output_json=output_json,
            output_markdown=output_markdown,
            observations_json=observations_json,
            knowledge_json=knowledge_json,
            knowledge_markdown=knowledge_markdown,
            user_agent=user_agent,
            max_filings=max_filings,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        console.print(f"SEC copy refresh failed closed: {exc}")
        raise typer.Exit(1)
    console.print(
        f"SEC watchlist {refresh.enabled_entries}/{refresh.watchlist_entries} enabled | "
        f"filings {refresh.filings_scanned} | imported signals {refresh.signals_imported} | "
        f"paper-ready {plan.summary['paper_ready']} | live orders placed 0"
    )
    console.print(f"Captured {captured} new post-disclosure price observation(s).")
    console.print(f"Updated signals: {refresh.signals_path}")
    console.print(f"Updated import status: {refresh.status_path}")
    console.print(f"Updated mirror plan: {output_json}")
    for warning in refresh.warnings:
        console.print(f"Warning: {warning}")


@app.command("copy-refresh-13f")
def copy_refresh_13f(
    watchlist: Path = typer.Option(SEC_13F_WATCHLIST_PATH, "--watchlist", help="Named SEC institutional-manager CIK watchlist."),
    signals_json: Path = typer.Option(COPY_SIGNALS_PATH, "--signals-json", help="Local public-signal inbox to update."),
    status_json: Path = typer.Option(SEC_13F_IMPORT_STATUS_PATH, "--status-json", help="Bounded 13F importer status report."),
    user_agent: Optional[str] = typer.Option(None, "--user-agent", envvar=SEC_USER_AGENT_ENV, help=f"SEC-compliant app/contact identity; prefer the {SEC_USER_AGENT_ENV} environment variable."),
    max_filings: int = typer.Option(3, "--max-filings", min=2, max=8, help="Maximum distinct recent 13F reporting periods fetched per enabled manager."),
) -> None:
    """Import official 13F holding changes as delayed research-only signals."""
    try:
        refresh = refresh_sec_13f_signals(
            watchlist_path=watchlist,
            signals_path=signals_json,
            status_path=status_json,
            user_agent=user_agent,
            max_filings_per_entry=max_filings,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        console.print(f"SEC 13F refresh failed closed: {exc}")
        raise typer.Exit(1)
    console.print(
        f"SEC 13F managers {refresh.enabled_entries}/{refresh.watchlist_entries} enabled | "
        f"filings {refresh.filings_scanned} | research signals {refresh.signals_imported} | "
        "live orders placed 0"
    )
    console.print(f"Updated signals: {refresh.signals_path}")
    console.print(f"Updated 13F status: {refresh.status_path}")
    for warning in refresh.warnings:
        console.print(f"Warning: {warning}")


@app.command("copy-watch-sec")
def copy_watch_sec(
    interval_minutes: int = typer.Option(15, "--interval-minutes", min=5, help="Minutes between official SEC refreshes."),
    watchlist: Path = typer.Option(SEC_FORM4_WATCHLIST_PATH, "--watchlist", help="Named SEC reporting-person/entity CIK watchlist."),
    signals_json: Path = typer.Option(COPY_SIGNALS_PATH, "--signals-json", help="Local public-signal inbox to update."),
    config: Path = typer.Option(COPY_TRADER_CONFIG_PATH, "--config", help="Copy Trader policy and source registry."),
    history_json: Path = typer.Option(COPY_HISTORY_PATH, "--history-json", help="Applied paper-signal fingerprint history."),
    status_json: Path = typer.Option(SEC_FORM4_IMPORT_STATUS_PATH, "--status-json", help="Bounded importer status report."),
    output_json: Path = typer.Option(COPY_PLAN_PATH, "--output-json", help="Generated machine-readable mirror plan."),
    output_markdown: Path = typer.Option(COPY_PLAN_MARKDOWN_PATH, "--output-markdown", help="Generated operator-readable mirror report."),
    observations_json: Path = typer.Option(COPY_PRICE_OBSERVATIONS_PATH, "--observations-json", help="Append-only post-disclosure price observation ledger."),
    knowledge_json: Path = typer.Option(COPY_KNOWLEDGE_PATH, "--knowledge-json", help="Generated source/trader knowledge report."),
    knowledge_markdown: Path = typer.Option(COPY_KNOWLEDGE_MARKDOWN_PATH, "--knowledge-markdown", help="Generated operator-readable knowledge report."),
    user_agent: Optional[str] = typer.Option(None, "--user-agent", envvar=SEC_USER_AGENT_ENV, help=f"SEC-compliant app/contact identity; prefer the {SEC_USER_AGENT_ENV} environment variable."),
    max_filings: int = typer.Option(10, "--max-filings", min=1, max=50, help="Maximum recent Form 4 filings fetched per enabled watchlist entry."),
) -> None:
    """Continuously refresh official filings and paper plans; never apply or submit trades."""
    while True:
        try:
            refresh, plan, captured = _refresh_sec_copy_plan(
                watchlist=watchlist,
                signals_json=signals_json,
                config=config,
                history_json=history_json,
                status_json=status_json,
                output_json=output_json,
                output_markdown=output_markdown,
                observations_json=observations_json,
                knowledge_json=knowledge_json,
                knowledge_markdown=knowledge_markdown,
                user_agent=user_agent,
                max_filings=max_filings,
            )
            console.print(
                f"[{refresh.generated_at}] SEC signals {refresh.signals_imported}; "
                f"paper-ready {plan.summary['paper_ready']}; live orders placed 0."
            )
            console.print(f"Captured {captured} new price observation(s) for the knowledge ledger.")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            console.print(f"SEC copy watcher failed closed: {exc}")
            raise typer.Exit(1)
        try:
            time.sleep(interval_minutes * 60)
        except KeyboardInterrupt:
            console.print("SEC copy watcher stopped. No live orders were placed.")
            return


def render_intraday_state(state: IntradayLifecycleState, limit: int) -> None:
    table = Table(title="Intraday Same-Day Engine")
    for column in ["Symbol", "Status", "Score", "Setup", "Entry", "Stop", "Target", "Reason"]:
        table.add_column(column)
    for intent in state.intents[:limit]:
        table.add_row(
            intent.symbol,
            intent.status,
            str(intent.confidence_score),
            intent.setup_type,
            f"${intent.entry_price:.2f}",
            f"${intent.stop_price:.2f}",
            f"${intent.target_1:.2f}",
            "; ".join(intent.rejection_reasons[:2]) or intent.thesis,
        )
    console.print(table)

    order_table = Table(title="Auto Order Plans")
    for column in ["Symbol", "Side", "Status", "Amount", "Type", "Reason"]:
        order_table.add_column(column)
    for order in state.order_plans[:limit]:
        order_table.add_row(
            order.symbol,
            order.side,
            order.status,
            f"${order.dollar_amount:.2f}",
            order.order_type,
            "; ".join(order.rejection_reasons[:2]) or "broker review passed",
        )
    console.print(order_table)


def resolve_tickers(tickers: Optional[List[str]]) -> list[str]:
    if tickers:
        expanded: list[str] = []
        for item in tickers:
            expanded.extend(item.replace(",", " ").split())
        return normalize_tickers(expanded)
    return load_universe()


def analysis_symbols(symbols: list[str]) -> list[str]:
    expanded = list(symbols)
    for ticker in ["SPY", "QQQ", "^VIX"]:
        if ticker not in expanded:
            expanded.append(ticker)
    return expanded


def resolve_live_symbols(
    tickers: Optional[List[str]],
    *,
    max_symbols: int,
    rotate_count: int,
) -> tuple[list[str], DynamicUniverse | None]:
    if tickers:
        return resolve_tickers(tickers), None
    dynamic = build_dynamic_universe(load_universe(), max_symbols=max_symbols, rotate_count=rotate_count)
    return dynamic.symbols, dynamic


def quote_snapshots_from_json(path: Path) -> dict[str, QuoteSnapshot]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError("quotes JSON must be an object keyed by ticker")

    snapshots: dict[str, QuoteSnapshot] = {}
    for ticker, values in raw.items():
        if not isinstance(values, dict):
            raise ValueError(f"quotes JSON entry for {ticker} must be an object")
        symbol = str(ticker).strip().upper()
        if not symbol:
            continue

        def number(name: str) -> float | None:
            value = values.get(name)
            if value in {None, ""}:
                return None
            return float(value)

        snapshots[symbol] = QuoteSnapshot(
            ticker=symbol,
            bid=number("bid"),
            ask=number("ask"),
            last=number("last"),
            data_fresh=bool(values.get("data_fresh", True)),
        )
    return snapshots


def broker_review_from_quote(quote: QuoteSnapshot | None, warnings: list[str] | None = None) -> BrokerReview:
    clean_warnings = [item for item in warnings or [] if item]
    passed = quote is not None and quote.data_fresh and quote.last is not None and quote.last > 0 and not clean_warnings
    return BrokerReview(
        passed=passed,
        quote_last=quote.last if quote else None,
        bid=quote.bid if quote else None,
        ask=quote.ask if quote else None,
        warnings=clean_warnings if clean_warnings else ([] if passed else ["fresh broker quote missing"]),
    )


def overlay_quote_snapshots(data: MarketData, quotes: dict[str, QuoteSnapshot]) -> MarketData:
    last_prices = {ticker: quote.last for ticker, quote in quotes.items() if quote.last and quote.last > 0}
    if not last_prices:
        return data
    return overlay_latest_closes(data, last_prices)


def load_live_agent_state(path: Path = LIVE_AGENT_STATE_PATH) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def save_live_agent_state(payload: dict[str, object], path: Path = LIVE_AGENT_STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


@app.command()
def scan(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    budget: Optional[float] = typer.Option(None, "--budget", "-b", help="Hypothetical deployable budget."),
    limit: int = typer.Option(15, "--limit", "-l", min=1, help="Rows to show."),
    period: str = typer.Option("6mo", "--period", help="History period passed to yfinance."),
) -> None:
    """Rank stocks and write a Markdown report."""
    settings = load_settings()
    chosen_budget = budget if budget is not None else settings.default_budget
    symbols = resolve_tickers(tickers)
    console.print(f"Fetching {len(symbols)} tickers...")
    data = download_history(symbols, period=period, interval="1d")
    candidates = score_candidates(data, settings, chosen_budget)
    if not candidates:
        raise typer.Exit("No candidates survived filters.")
    render_candidates(candidates, limit)
    report = write_markdown_report(candidates, settings, chosen_budget)
    console.print(f"Wrote report: {report}")


@app.command()
def watch(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    budget: Optional[float] = typer.Option(None, "--budget", "-b", help="Hypothetical deployable budget."),
    interval: int = typer.Option(60, "--interval", "-i", min=15, help="Seconds between refreshes."),
    limit: int = typer.Option(10, "--limit", "-l", min=1, help="Rows to show."),
    once: bool = typer.Option(False, "--once", help="Run one refresh and exit."),
    include_closed: bool = typer.Option(False, "--include-closed", help="Keep running outside regular market hours."),
) -> None:
    """Refresh rankings repeatedly during regular US market hours."""
    settings = load_settings()
    chosen_budget = budget if budget is not None else settings.default_budget
    symbols = resolve_tickers(tickers)

    while True:
        state = market_state(settings)
        if state != "open" and not include_closed:
            console.print(f"Market is {state}; run with --include-closed to scan anyway.")
            if once:
                return
            time.sleep(interval)
            continue

        console.clear()
        console.print(f"Market state: {state}. Refresh interval: {interval}s.")
        data = download_history(symbols, period="6mo", interval="1d")
        data = overlay_latest_closes(data, latest_prices(symbols))
        candidates = score_candidates(data, settings, chosen_budget)
        render_candidates(candidates, limit)
        write_markdown_report(candidates, settings, chosen_budget)
        if once:
            return
        time.sleep(interval)


@app.command("mission")
def mission(
    account_label: str = typer.Option("Agentic", "--account-label", help="Broker account label for display only."),
    account_value: float = typer.Option(..., "--account-value", min=0, help="Current broker account value."),
    cash: float = typer.Option(..., "--cash", min=0, help="Current broker cash."),
    buying_power: float = typer.Option(..., "--buying-power", min=0, help="Current broker buying power."),
    deployed_dollars: float = typer.Option(0.0, "--deployed", min=0, help="Dollars already deployed in live positions."),
    positions: int = typer.Option(0, "--positions", min=0, help="Current live equity position count."),
    open_orders: int = typer.Option(0, "--open-orders", min=0, help="Current live open equity order count."),
    max_total_dollars: Optional[float] = typer.Option(None, "--max-total", min=0, help="Override configured max live deployed dollars."),
    max_order_dollars: Optional[float] = typer.Option(None, "--max-order", min=0, help="Override configured max dollars per live order."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print only; do not write reports/mission.md."),
) -> None:
    """Summarize live-account growth mission guardrails."""
    settings = load_settings()
    guardrails = BrokerGuardrails.from_settings(settings)
    if max_total_dollars is not None or max_order_dollars is not None:
        guardrails = BrokerGuardrails(
            account_nickname=guardrails.account_nickname,
            principal_dollars=guardrails.principal_dollars,
            max_total_dollars=max_total_dollars if max_total_dollars is not None else guardrails.max_total_dollars,
            max_order_dollars=max_order_dollars if max_order_dollars is not None else guardrails.max_order_dollars,
            min_order_dollars=guardrails.min_order_dollars,
            cash_reserve_dollars=guardrails.cash_reserve_dollars,
            lock_profits=guardrails.lock_profits,
        )
    live_mission = BrokerMission(
        account_label=account_label,
        account_value=account_value,
        cash=cash,
        buying_power=buying_power,
        deployed_dollars=deployed_dollars,
        open_orders=open_orders,
        positions=positions,
    )
    for line in build_mission_lines(live_mission, guardrails):
        console.print(line)
    if dry_run:
        return
    path = write_mission_report(live_mission, guardrails)
    console.print(f"Wrote mission report: {path}")


@app.command("research")
def research(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    news_limit: int = typer.Option(3, "--news-limit", min=0, max=10, help="Recent headlines per ticker."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print only; do not write reports/research.md."),
) -> None:
    """Fetch company/profile/news context for tickers."""
    symbols = resolve_tickers(tickers)
    items = fetch_equity_research(symbols, news_limit=news_limit)
    table = Table(title="Equity Research Context")
    for column in ["Ticker", "Company", "Sector", "Market Cap", "TTM P/E", "Fwd P/E", "Rev Growth", "Reco"]:
        table.add_column(column)
    for item in items:
        table.add_row(
            item.ticker,
            item.company_name or "N/A",
            item.sector or "N/A",
            research_money(item.market_cap),
            research_ratio(item.trailing_pe),
            research_ratio(item.forward_pe),
            research_pct(item.revenue_growth),
            item.recommendation or "N/A",
        )
    console.print(table)
    if dry_run:
        return
    path = write_research_report(items)
    console.print(f"Wrote research report: {path}")


@app.command("evaluate")
def evaluate(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    limit: int = typer.Option(15, "--limit", "-l", min=1, help="Rows to show."),
    notify_telegram: bool = typer.Option(False, "--notify-telegram", help="Send Telegram only for valid buy/sell signals."),
    quotes_json: Optional[Path] = typer.Option(None, "--quotes-json", help="Optional JSON file with live quote snapshots keyed by ticker."),
    cache_first_history: bool = typer.Option(False, "--cache-first-history", help="Prefer fresh cached history before hitting network."),
    history_cache_hours: float = typer.Option(6.0, "--history-cache-hours", min=0.25, help="Fresh-history cache window used with --cache-first-history."),
    max_symbols: int = typer.Option(80, "--max-symbols", min=10, help="Maximum symbol count when building the expanded live universe."),
    rotate_count: int = typer.Option(40, "--rotate-count", min=0, help="How many non-seed symbols to rotate into the live universe when --tickers is omitted."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print only; do not write JSON or send Telegram."),
) -> None:
    """Evaluate tickers with the structured decision engine."""
    settings = load_settings()
    symbols, dynamic = resolve_live_symbols(tickers, max_symbols=max_symbols, rotate_count=rotate_count)
    if dynamic:
        console.print(
            f"Expanded universe: {len(symbols)} symbols "
            f"(seed {dynamic.seed_count}, rotated {dynamic.selected_dynamic_count}, catalog {dynamic.source_catalog_count})"
        )
    console.print(f"Evaluating {len(symbols)} tickers...")
    try:
        data = download_history(
            analysis_symbols(symbols),
            period="1y",
            interval="1d",
            prefer_cache=cache_first_history,
            cache_max_age_seconds=int(history_cache_hours * 3600),
        )
    except RuntimeError as exc:
        console.print(f"Evaluation skipped: {exc}")
        if EVALUATIONS_PATH.exists():
            console.print(f"Keeping last evaluations: {EVALUATIONS_PATH}")
        else:
            console.print("No prior evaluations report is available.")
        return
    quotes = quote_snapshots_from_json(quotes_json) if quotes_json else {}
    if quotes:
        data = overlay_quote_snapshots(data, quotes)
    evaluations = evaluate_market_data(data, settings, quote_snapshots=quotes)
    render_evaluations(evaluations, limit)
    if dry_run:
        return

    path = write_evaluations_json(evaluations)
    console.print(f"Wrote evaluations: {path}")

    if notify_telegram:
        guardrails = BrokerGuardrails.from_settings(settings)
        sent = 0
        for item in evaluations:
            if item.decision not in {VALID_BUY_SETUP, VALID_SELL_SIGNAL}:
                continue
            try:
                send_telegram_message(
                    format_evaluation_update(
                        item,
                        principal_dollars=guardrails.principal_dollars,
                        buy_amount=guardrails.max_order_dollars,
                    )
                )
            except TelegramConfigError as exc:
                console.print(f"Telegram not configured: {exc}")
                raise typer.Exit(1)
            except RuntimeError as exc:
                console.print(str(exc))
                raise typer.Exit(1)
            sent += 1
        console.print(f"Sent {sent} Telegram evaluation alert(s).")


@app.command("intraday-evaluate")
def intraday_evaluate(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    quotes_json: Optional[Path] = typer.Option(None, "--quotes-json", help="Required for auto-order readiness: live quote snapshots keyed by ticker."),
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic broker account number for live auto-order planning."),
    account_value: float = typer.Option(25.0, "--account-value", min=0, help="Current account value used for risk and guardrails."),
    cash: float = typer.Option(25.0, "--cash", min=0, help="Current broker cash."),
    buying_power: float = typer.Option(25.0, "--buying-power", min=0, help="Current broker buying power."),
    deployed_dollars: float = typer.Option(0.0, "--deployed", min=0, help="Dollars already deployed in live positions."),
    open_orders: int = typer.Option(0, "--open-orders", min=0, help="Current live open equity order count."),
    positions: int = typer.Option(0, "--positions", min=0, help="Current live equity position count."),
    broker_warning: Optional[List[str]] = typer.Option(None, "--broker-warning", help="Broker warning to include; repeat for multiple warnings."),
    account_restriction: Optional[List[str]] = typer.Option(None, "--account-restriction", help="Account restriction to include; repeat for multiple restrictions."),
    sector_aligned: bool = typer.Option(True, "--sector-aligned/--sector-not-aligned", help="Whether sector movement confirms entries."),
    news_verified: bool = typer.Option(True, "--news-verified/--news-unverified", help="Whether catalyst/news is fresh and verified."),
    limit: int = typer.Option(15, "--limit", "-l", min=1, help="Rows to show."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print only; do not write lifecycle JSON."),
) -> None:
    """Run the strict intraday same-day engine and build fail-closed auto-order plans."""
    settings = load_settings()
    symbols, dynamic = resolve_live_symbols(tickers, max_symbols=80, rotate_count=40)
    if dynamic:
        console.print(
            f"Expanded universe: {len(symbols)} symbols "
            f"(seed {dynamic.seed_count}, rotated {dynamic.selected_dynamic_count}, catalog {dynamic.source_catalog_count})"
        )

    quotes = quote_snapshots_from_json(quotes_json) if quotes_json else {}
    try:
        data = download_history(
            analysis_symbols(symbols),
            period="5d",
            interval="1m",
            prefer_cache=False,
        )
    except RuntimeError as exc:
        console.print(f"Intraday evaluation skipped: {exc}")
        return
    if quotes:
        data = overlay_quote_snapshots(data, quotes)

    account = BrokerAccountState(
        account_number=account_number or settings.live_account_number,
        account_value=account_value,
        cash=cash,
        buying_power=buying_power,
        deployed_dollars=deployed_dollars,
        open_orders=open_orders,
        positions=positions,
        warnings=broker_warning or [],
        restrictions=account_restriction or [],
    )
    broker = DryRunBrokerClient(account=account, quotes=quotes, review_warnings=broker_warning or [])
    auto_reasons = live_auto_reasons(settings, account_number=account.account_number)
    if auto_reasons:
        console.print("Live auto execution: BLOCKED - " + "; ".join(auto_reasons))
    else:
        console.print("Live auto execution: ARMED - broker review is the confirmation gate")
    lifecycle = load_lifecycle_state(now=datetime.now().astimezone())
    result = run_intraday_control_cycle(
        data=data,
        symbols=symbols,
        settings=settings,
        broker=broker,
        account_number=account.account_number,
        lifecycle=lifecycle,
        now=datetime.now().astimezone(),
        sector_aligned=sector_aligned,
        news_verified=news_verified,
        execute=not dry_run,
    )
    state = result.state
    render_intraday_state(state, limit)
    if dry_run:
        return
    path = save_lifecycle_state(state)
    console.print(f"Wrote intraday lifecycle state: {path}")


@app.command("live-auto-status")
def live_auto_status(
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
) -> None:
    """Show autonomous live-trading gate, kill switch, and heartbeat state."""
    settings = load_settings()
    account = account_number or settings.live_account_number
    gate = live_session_gate(settings, account_number=account, now=datetime.now().astimezone())
    state = "ARMED" if gate.armed else "BLOCKED"
    console.print(f"Live auto: {state}")
    console.print(f"Buys: {'allowed' if gate.allow_buys else 'blocked'} | Sells: {'allowed' if gate.allow_sells else 'blocked'}")
    if gate.reasons:
        console.print("Reasons: " + "; ".join(gate.reasons))
    console.print(f"Kill switch: {KILL_SWITCH_PATH}")
    if HEARTBEAT_PATH.exists():
        console.print(f"Heartbeat: {HEARTBEAT_PATH}")
        try:
            payload = json.loads(HEARTBEAT_PATH.read_text())
        except Exception:
            payload = {}
        if isinstance(payload, dict):
            console.print(f"Last cycle: {payload.get('updated_at', 'unknown')} | Next action: {payload.get('next_action', 'unknown')}")
    else:
        console.print("Heartbeat: none yet")


@app.command("live-auto-preflight")
def live_auto_preflight(
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    require_broker_tool_status: bool = typer.Option(False, "--require-broker-tool-status", help="Block readiness unless Codex/MCP broker tool status is supplied."),
    require_reconciliation: bool = typer.Option(False, "--require-reconciliation", help="Block readiness unless a fresh safe broker reconciliation report exists."),
    require_account_health: bool = typer.Option(False, "--require-account-health", help="Block readiness unless a fresh safe broker account-health report exists."),
    require_capital_policy: bool = typer.Option(False, "--require-capital-policy", help="Block readiness unless a fresh safe capital policy report exists."),
) -> None:
    """Run production-readiness checks before arming autonomous live trading."""
    settings = load_settings()
    account = account_number or settings.live_account_number
    report = build_readiness_report(
        settings,
        account_number=account,
        now=datetime.now().astimezone(),
        require_broker_tool_status=require_broker_tool_status,
        require_reconciliation_report=require_reconciliation,
        require_account_health_report=require_account_health,
        require_capital_policy_report=require_capital_policy,
    )
    table = Table(title="Live Auto Preflight")
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Severity")
    table.add_column("Detail")
    for check in report.checks:
        table.add_row(
            check.name,
            "PASS" if check.passed else "FAIL",
            check.severity,
            check.detail,
        )
    console.print(table)
    console.print(f"Ready for live auto: {'YES' if report.ready_for_live_auto else 'NO'}")


@app.command("live-auto-checklist")
def live_auto_checklist(
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    require_broker_tool_status: bool = typer.Option(True, "--require-broker-tool-status/--no-require-broker-tool-status", help="Require Codex/MCP broker tool status in strict preflight."),
    write_report: bool = typer.Option(True, "--write-report/--no-write-report", help="Write data/live_auto_launch_checklist.json."),
) -> None:
    """Show the full artifact checklist for autonomous live-auto launch."""
    settings = load_settings()
    account = account_number or settings.live_account_number
    report = build_launch_checklist(
        settings=settings,
        account_number=account,
        now=datetime.now().astimezone(),
        require_broker_tool_status=require_broker_tool_status,
    )
    table = Table(title="Live Auto Launch Checklist")
    for column in ["Artifact", "Status", "Severity", "Fresh", "Detail"]:
        table.add_column(column)
    for artifact in report.artifacts:
        table.add_row(
            artifact.name,
            "PASS" if artifact.passed else "FAIL",
            artifact.severity,
            "yes" if artifact.fresh else "no",
            artifact.detail,
        )
    console.print(table)
    console.print(f"Ready for live auto: {'YES' if report.ready_for_live_auto else 'NO'}")
    if report.next_steps:
        console.print("Next steps: " + "; ".join(report.next_steps))
    if write_report:
        path = write_launch_checklist(report, LAUNCH_CHECKLIST_PATH)
        console.print(f"Wrote launch checklist: {path}")


@app.command("live-auto-arm-plan")
def live_auto_arm_plan(
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to arm against."),
    write_report: bool = typer.Option(True, "--write-report/--no-write-report", help="Write data/live_auto_arm_plan.json."),
) -> None:
    """Show exact config changes and blockers before live auto can be armed."""
    settings = load_settings()
    account = account_number or settings.live_account_number
    plan = build_live_auto_arm_plan(settings=settings, account_number=account, now=datetime.now().astimezone())
    table = Table(title="Live Auto Arm Plan")
    table.add_column("Item")
    table.add_column("Value")
    table.add_row("Action", plan.action)
    table.add_row("Account", plan.account_number or "missing")
    table.add_row("Config changes", str(len(plan.config_changes)))
    table.add_row("Blockers", str(len(plan.blockers)))
    table.add_row("Warnings", str(len(plan.warnings)))
    console.print(table)
    if plan.config_changes:
        changes = Table(title="Required Config Changes")
        for column in ["Field", "Current", "Required", "Reason"]:
            changes.add_column(column)
        for change in plan.config_changes:
            changes.add_row(change.field, str(change.current), str(change.required), change.reason)
        console.print(changes)
    if plan.blockers:
        console.print("Blockers: " + "; ".join(plan.blockers))
    if plan.warnings:
        console.print("Warnings: " + "; ".join(plan.warnings))
    if write_report:
        path = write_arm_plan(plan, ARM_PLAN_PATH)
        console.print(f"Wrote arm plan: {path}")


@app.command("live-auto-evidence")
def live_auto_evidence(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    account_value: Optional[float] = typer.Option(None, "--account-value", min=0, help="Dry-run account value override."),
    buying_power: Optional[float] = typer.Option(None, "--buying-power", min=0, help="Dry-run buying power override."),
    cash: Optional[float] = typer.Option(None, "--cash", min=0, help="Dry-run cash override."),
    broker_position: Optional[List[str]] = typer.Option(None, "--broker-position", help="Dry-run broker position as SYMBOL:SHARES:AVG_COST. Repeatable."),
    broker_open_order: Optional[List[str]] = typer.Option(None, "--broker-open-order", help="Dry-run open order as ORDER_ID:SYMBOL:SIDE:STATE. Repeatable."),
    broker_warning: Optional[List[str]] = typer.Option(None, "--broker-warning", help="Dry-run broker warning. Repeatable."),
    broker_restriction: Optional[List[str]] = typer.Option(None, "--broker-restriction", help="Dry-run broker restriction. Repeatable."),
    require_broker_tool_status: bool = typer.Option(True, "--require-broker-tool-status/--no-require-broker-tool-status", help="Require Codex/MCP broker tool status in generated checklist."),
) -> None:
    """Refresh local launch evidence artifacts in one dry-run pass."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    account = account_number or settings.live_account_number or "DRY-RUN"
    prices = latest_prices(analysis_symbols(symbols))
    quotes = {
        symbol: QuoteSnapshot(ticker=symbol, bid=round(price * 0.999, 4), ask=round(price * 1.001, 4), last=price, data_fresh=True)
        for symbol, price in prices.items()
    }
    positions = []
    for item in broker_position or []:
        try:
            symbol, shares, average = item.replace(",", ":").split(":", maxsplit=2)
            positions.append(BrokerPosition(symbol.upper(), float(shares), float(average)))
        except ValueError:
            console.print(f"Invalid --broker-position value: {item}")
            raise typer.Exit(code=1)
    orders = []
    for item in broker_open_order or []:
        try:
            order_id, symbol, side, state = item.replace(",", ":").split(":", maxsplit=3)
            orders.append(BrokerOrder(order_id, symbol.upper(), side.lower(), state.lower()))
        except ValueError:
            console.print(f"Invalid --broker-open-order value: {item}")
            raise typer.Exit(code=1)
    broker = DryRunBrokerClient(
        account=BrokerAccountState(
            account_number=account,
            account_value=account_value if account_value is not None else settings.live_principal_dollars,
            cash=cash if cash is not None else settings.live_principal_dollars,
            buying_power=buying_power if buying_power is not None else settings.live_principal_dollars,
            open_orders=len([order for order in orders if order.is_open]),
            warnings=broker_warning or [],
            restrictions=broker_restriction or [],
        ),
        quotes=quotes,
        positions=positions,
        orders=orders,
        tradability={symbol: True for symbol in symbols},
    )
    report = build_local_evidence_bundle(
        settings=settings,
        account_number=account,
        symbols=symbols,
        broker=broker,
        now=datetime.now().astimezone(),
        require_broker_tool_status=require_broker_tool_status,
    )
    table = Table(title="Live Auto Evidence Bundle")
    table.add_column("Artifact")
    table.add_column("Path")
    table.add_row("Account health", str(report.account_health_path))
    table.add_row("Reconciliation", str(report.reconciliation_path))
    table.add_row("Performance JSON", str(report.performance_json_path))
    table.add_row("Performance markdown", str(report.performance_markdown_path))
    table.add_row("Capital policy", str(report.capital_policy_path))
    table.add_row("Launch checklist", str(report.checklist_path))
    console.print(table)
    console.print(f"Ready for live auto: {'YES' if report.checklist.ready_for_live_auto else 'NO'}")
    if report.checklist.next_steps:
        console.print("Next steps: " + "; ".join(report.checklist.next_steps))


@app.command("live-auto-health")
def live_auto_health(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    account_value: Optional[float] = typer.Option(None, "--account-value", min=0, help="Dry-run account value override."),
    buying_power: Optional[float] = typer.Option(None, "--buying-power", min=0, help="Dry-run buying power override."),
    cash: Optional[float] = typer.Option(None, "--cash", min=0, help="Dry-run cash override."),
    broker_warning: Optional[List[str]] = typer.Option(None, "--broker-warning", help="Dry-run broker warning. Repeatable."),
    broker_restriction: Optional[List[str]] = typer.Option(None, "--broker-restriction", help="Dry-run broker restriction. Repeatable."),
    broker_open_order: Optional[List[str]] = typer.Option(None, "--broker-open-order", help="Dry-run open order as ORDER_ID:SYMBOL:SIDE:STATE. Repeatable."),
    write_report: bool = typer.Option(True, "--write-report/--no-write-report", help="Write data/broker_account_health.json."),
) -> None:
    """Check broker account, quote, spread, and tradability health before entries."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    account = account_number or settings.live_account_number or "DRY-RUN"
    prices = latest_prices(analysis_symbols(symbols))
    quotes = {
        symbol: QuoteSnapshot(ticker=symbol, bid=round(price * 0.999, 4), ask=round(price * 1.001, 4), last=price, data_fresh=True)
        for symbol, price in prices.items()
    }
    orders = []
    for item in broker_open_order or []:
        try:
            order_id, symbol, side, state = item.replace(",", ":").split(":", maxsplit=3)
            orders.append(BrokerOrder(order_id, symbol.upper(), side.lower(), state.lower()))
        except ValueError:
            console.print(f"Invalid --broker-open-order value: {item}")
            raise typer.Exit(code=1)
    broker = DryRunBrokerClient(
        account=BrokerAccountState(
            account_number=account,
            account_value=account_value if account_value is not None else settings.live_principal_dollars,
            cash=cash if cash is not None else settings.live_principal_dollars,
            buying_power=buying_power if buying_power is not None else settings.live_principal_dollars,
            open_orders=len([order for order in orders if order.is_open]),
            warnings=broker_warning or [],
            restrictions=broker_restriction or [],
        ),
        quotes=quotes,
        tradability={symbol: True for symbol in symbols},
        orders=orders,
    )
    report = build_account_health_report(
        settings=settings,
        account_number=account,
        symbols=symbols,
        broker=broker,
        now=datetime.now().astimezone(),
    )
    table = Table(title="Broker Account Health")
    table.add_column("Item")
    table.add_column("Value")
    table.add_row("Safe for entries", "YES" if report.safe_for_entries else "NO")
    table.add_row("Account value", f"${report.account_value:.2f}")
    table.add_row("Buying power", f"${report.buying_power:.2f}")
    table.add_row("Cash", f"${report.cash:.2f}")
    table.add_row("Open orders", str(report.open_orders))
    table.add_row("Positions", str(report.positions))
    table.add_row("Symbols checked", ", ".join(report.symbols_checked) or "none")
    console.print(table)
    if report.issues:
        issue_table = Table(title="Account Health Issues")
        for column in ["Severity", "Code", "Symbol", "Detail"]:
            issue_table.add_column(column)
        for issue in report.issues:
            issue_table.add_row(issue.severity, issue.code, issue.symbol or "-", issue.detail)
        console.print(issue_table)
    if write_report:
        path = write_account_health_report(report, ACCOUNT_HEALTH_REPORT_PATH)
        console.print(f"Wrote broker account health report: {path}")


@app.command("live-auto-reconcile")
def live_auto_reconcile(
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    broker_position: Optional[List[str]] = typer.Option(None, "--broker-position", help="Dry-run broker position as SYMBOL:SHARES:AVG_COST. Repeatable."),
    broker_open_order: Optional[List[str]] = typer.Option(None, "--broker-open-order", help="Dry-run open order as ORDER_ID:SYMBOL:SIDE:STATE. Repeatable."),
    write_report: bool = typer.Option(True, "--write-report/--no-write-report", help="Write data/broker_reconciliation_report.json."),
) -> None:
    """Compare broker positions/open orders with lifecycle state before arming live auto."""
    settings = load_settings()
    account = account_number or settings.live_account_number or "DRY-RUN"
    positions = []
    for item in broker_position or []:
        try:
            symbol, shares, average = item.replace(",", ":").split(":", maxsplit=2)
            positions.append(BrokerPosition(symbol.upper(), float(shares), float(average)))
        except ValueError:
            console.print(f"Invalid --broker-position value: {item}")
            raise typer.Exit(code=1)
    orders = []
    for item in broker_open_order or []:
        try:
            order_id, symbol, side, state = item.replace(",", ":").split(":", maxsplit=3)
            orders.append(BrokerOrder(order_id, symbol.upper(), side.lower(), state.lower()))
        except ValueError:
            console.print(f"Invalid --broker-open-order value: {item}")
            raise typer.Exit(code=1)

    broker = DryRunBrokerClient(
        account=BrokerAccountState(account_number=account, account_value=settings.live_principal_dollars, cash=settings.live_principal_dollars, buying_power=settings.live_principal_dollars),
        positions=positions,
        orders=orders,
    )
    report = build_reconciliation_report(
        settings=settings,
        account_number=account,
        broker=broker,
        now=datetime.now().astimezone(),
    )
    table = Table(title="Broker Reconciliation")
    table.add_column("Item")
    table.add_column("Value")
    table.add_row("Safe to arm", "YES" if report.safe_to_arm else "NO")
    table.add_row("Broker positions", str(report.broker_positions))
    table.add_row("Lifecycle positions", str(report.lifecycle_positions))
    table.add_row("Broker open orders", str(report.broker_open_orders))
    table.add_row("Lifecycle order plans", str(report.lifecycle_order_plans))
    console.print(table)
    if report.issues:
        issue_table = Table(title="Reconciliation Issues")
        for column in ["Severity", "Code", "Symbol", "Detail"]:
            issue_table.add_column(column)
        for issue in report.issues:
            issue_table.add_row(issue.severity, issue.code, issue.symbol or "-", issue.detail)
        console.print(issue_table)
    if write_report:
        path = write_reconciliation_report(report, RECONCILIATION_REPORT_PATH)
        console.print(f"Wrote broker reconciliation report: {path}")


@app.command("strategy-health")
def strategy_health() -> None:
    """Rebuild strategy-health metrics from filled lifecycle order history."""
    path, metrics = write_strategy_health_from_lifecycle(now=datetime.now().astimezone())
    table = Table(title="Strategy Health")
    table.add_column("Metric")
    table.add_column("Value")
    table.add_row("Trades", str(metrics.trades))
    table.add_row("Wins", str(metrics.wins))
    table.add_row("Losses", str(metrics.losses))
    table.add_row("Win rate", f"{metrics.win_rate:.1%}")
    table.add_row("Average win", f"${metrics.average_win:.4f}")
    table.add_row("Average loss", f"${metrics.average_loss:.4f}")
    table.add_row("Expectancy", f"${metrics.expectancy:.4f}")
    table.add_row("Max drawdown", f"${metrics.max_drawdown:.4f}")
    console.print(table)
    console.print(f"Wrote strategy health: {path}")


@app.command("performance-audit")
def performance_audit(
    write_json: bool = typer.Option(True, "--write-json/--no-write-json", help="Write data/performance_audit.json."),
    write_markdown: bool = typer.Option(True, "--write-markdown/--no-write-markdown", help="Write reports/performance_audit.md."),
) -> None:
    """Audit realized lifecycle trade performance before increasing capital."""
    settings = load_settings()
    report = build_performance_audit_from_lifecycle(settings=settings, now=datetime.now().astimezone())
    table = Table(title="Performance Audit")
    table.add_column("Metric")
    table.add_column("Value")
    table.add_row("Capital scale ready", "YES" if report.capital_scale_ready else "NO")
    table.add_row("Trades", str(report.metrics.trades))
    table.add_row("Win rate", f"{report.metrics.win_rate:.1%}")
    table.add_row("Expectancy", f"${report.metrics.expectancy:.4f}")
    table.add_row("Total P/L", f"${report.total_pnl:.4f}")
    table.add_row("Max drawdown", f"${report.metrics.max_drawdown:.4f}")
    table.add_row("Profit factor", f"{report.profit_factor:.4f}")
    table.add_row("Average duration", f"{report.average_trade_duration_minutes:.2f} min")
    console.print(table)
    if report.reasons:
        console.print("Blockers: " + "; ".join(report.reasons))
    if write_json:
        path = write_performance_audit_json(report, PERFORMANCE_REPORT_PATH)
        console.print(f"Wrote performance audit JSON: {path}")
    if write_markdown:
        path = write_performance_audit_markdown(report, PERFORMANCE_MARKDOWN_PATH)
        console.print(f"Wrote performance audit markdown: {path}")


@app.command("capital-policy")
def capital_policy(
    write_report: bool = typer.Option(True, "--write-report/--no-write-report", help="Write data/capital_policy.json."),
) -> None:
    """Recommend whether live bankroll may scale based on audited performance."""
    settings = load_settings()
    decision = capital_policy_from_performance_report(settings=settings, now=datetime.now().astimezone())
    table = Table(title="Capital Policy")
    table.add_column("Item")
    table.add_column("Value")
    table.add_row("Action", decision.action)
    table.add_row("Current principal", f"${decision.current_principal_dollars:.2f}")
    table.add_row("Current max total", f"${decision.current_max_total_dollars:.2f}")
    table.add_row("Current max order", f"${decision.current_max_order_dollars:.2f}")
    table.add_row("Recommended principal", f"${decision.recommended_principal_dollars:.2f}")
    table.add_row("Recommended max total", f"${decision.recommended_max_total_dollars:.2f}")
    table.add_row("Recommended max order", f"${decision.recommended_max_order_dollars:.2f}")
    console.print(table)
    if decision.reasons:
        console.print("Reasons: " + "; ".join(decision.reasons))
    if write_report:
        path = write_capital_policy_report(decision, CAPITAL_POLICY_REPORT_PATH)
        console.print(f"Wrote capital policy report: {path}")


@app.command("intraday-replay")
def intraday_replay(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    period: str = typer.Option("5d", "--period", help="History period passed to yfinance."),
    interval: str = typer.Option("1m", "--interval", help="History interval passed to yfinance."),
    write_health: bool = typer.Option(False, "--write-health", help="Write data/strategy_health.json from replay metrics."),
) -> None:
    """Replay strict intraday rules over historical candles."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    data = download_history(analysis_symbols(symbols), period=period, interval=interval, prefer_cache=False)
    result = replay_intraday_rules(data, settings, symbols=symbols)
    table = Table(title="Intraday Replay")
    table.add_column("Metric")
    table.add_column("Value")
    table.add_row("Symbols", ", ".join(result.symbols))
    table.add_row("Bars processed", str(result.bars_processed))
    table.add_row("Trades", str(result.metrics.trades))
    table.add_row("Wins", str(result.metrics.wins))
    table.add_row("Losses", str(result.metrics.losses))
    table.add_row("Win rate", f"{result.metrics.win_rate:.1%}")
    table.add_row("Expectancy", f"${result.metrics.expectancy:.4f}")
    table.add_row("Max drawdown", f"${result.metrics.max_drawdown:.4f}")
    table.add_row("Eligible symbols", ", ".join(result.eligible_symbols) or "none")
    console.print(table)
    symbol_table = Table(title="Replay Symbol Attribution")
    for column in ["Symbol", "Trades", "Win Rate", "Expectancy", "Max DD", "Eligible"]:
        symbol_table.add_column(column)
    for symbol, metrics in sorted(result.symbol_metrics.items()):
        symbol_table.add_row(
            symbol,
            str(metrics.trades),
            f"{metrics.win_rate:.1%}",
            f"${metrics.expectancy:.4f}",
            f"${metrics.max_drawdown:.4f}",
            "yes" if symbol in result.eligible_symbols else "no",
        )
    console.print(symbol_table)
    if result.trades:
        trades = Table(title="Replay Trades")
        for column in ["Symbol", "Entry", "Exit", "Shares", "P/L", "Exit Reason"]:
            trades.add_column(column)
        for trade in result.trades[:20]:
            trades.add_row(
                trade.symbol,
                f"${trade.entry_price:.4f}",
                f"${trade.exit_price:.4f}",
                f"{trade.shares:.6f}",
                f"${trade.pnl:.4f}",
                trade.exit_reason,
            )
        console.print(trades)
    if write_health:
        path = write_strategy_health(
            result.metrics,
            symbol_metrics=result.symbol_metrics,
            eligible_symbols=result.eligible_symbols,
        )
        console.print(f"Wrote strategy health: {path}")


@app.command("intraday-optimize")
def intraday_optimize(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    period: str = typer.Option("5d", "--period", help="History period passed to yfinance."),
    interval: str = typer.Option("1m", "--interval", help="History interval passed to yfinance."),
    top: int = typer.Option(5, "--top", min=1, max=20, help="Number of ranked configurations to show."),
    write_report: bool = typer.Option(False, "--write-report", help="Write data/replay_optimization.json from ranked results."),
) -> None:
    """Grid-search strict intraday replay settings and rank by edge/risk."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    data = download_history(analysis_symbols(symbols), period=period, interval=interval, prefer_cache=False)
    results = optimize_intraday_replay(data, settings, symbols=symbols)
    table = Table(title="Intraday Replay Optimizer")
    for column in ["Rank", "Score", "Trades", "Win Rate", "Expectancy", "Max DD", "MinScore", "AutoScore", "RVOL", "Spread", "Status"]:
        table.add_column(column)
    for idx, item in enumerate(results[:top], start=1):
        table.add_row(
            str(idx),
            f"{item.rank_score:.4f}",
            str(item.replay.metrics.trades),
            f"{item.replay.metrics.win_rate:.1%}",
            f"${item.replay.metrics.expectancy:.4f}",
            f"${item.replay.metrics.max_drawdown:.4f}",
            str(item.settings.intraday_min_entry_score),
            str(item.settings.intraday_auto_order_score),
            f"{item.settings.intraday_min_relative_volume:.2f}",
            f"{item.settings.intraday_max_spread_pct:.3%}",
            "blocked: " + "; ".join(item.reasons[:2]) if item.reasons else "eligible",
        )
    console.print(table)
    if write_report:
        path = write_optimization_report(results, symbols=symbols, generated_at=datetime.now().astimezone())
        console.print(f"Wrote replay optimization report: {path}")


@app.command("intraday-walk-forward")
def intraday_walk_forward(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    period: str = typer.Option("5d", "--period", help="History period passed to yfinance."),
    interval: str = typer.Option("1m", "--interval", help="History interval passed to yfinance."),
    train_fraction: float = typer.Option(0.6, "--train-fraction", min=0.3, max=0.8, help="Earlier fraction used for tuning before validation."),
    top: int = typer.Option(5, "--top", min=1, max=20, help="Number of walk-forward configurations to show."),
    write_report: bool = typer.Option(False, "--write-report", help="Write data/replay_optimization.json from walk-forward results."),
) -> None:
    """Tune on earlier candles and validate on later candles to reduce overfit."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    data = download_history(analysis_symbols(symbols), period=period, interval=interval, prefer_cache=False)
    results = optimize_intraday_walk_forward(data, settings, symbols=symbols, train_fraction=train_fraction)
    table = Table(title="Intraday Walk-Forward Optimizer")
    for column in ["Rank", "ValScore", "ValTrades", "ValExp", "ValDD", "TrainExp", "MinScore", "AutoScore", "RVOL", "Spread", "Status"]:
        table.add_column(column)
    for idx, item in enumerate(results[:top], start=1):
        table.add_row(
            str(idx),
            f"{item.validation_score:.4f}",
            str(item.validation_replay.metrics.trades),
            f"${item.validation_replay.metrics.expectancy:.4f}",
            f"${item.validation_replay.metrics.max_drawdown:.4f}",
            f"${item.train_replay.metrics.expectancy:.4f}",
            str(item.settings.intraday_min_entry_score),
            str(item.settings.intraday_auto_order_score),
            f"{item.settings.intraday_min_relative_volume:.2f}",
            f"{item.settings.intraday_max_spread_pct:.3%}",
            "blocked: " + "; ".join(item.validation_reasons[:2]) if item.validation_reasons else "validated",
        )
    console.print(table)
    if write_report:
        path = write_walk_forward_optimization_report(results, symbols=symbols, generated_at=datetime.now().astimezone())
        console.print(f"Wrote walk-forward optimization report: {path}")


@app.command("live-auto-prepare")
def live_auto_prepare(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check in preflight."),
    period: str = typer.Option("5d", "--period", help="History period passed to yfinance."),
    interval: str = typer.Option("1m", "--interval", help="History interval passed to yfinance."),
    train_fraction: float = typer.Option(0.6, "--train-fraction", min=0.3, max=0.8, help="Earlier fraction used for tuning before validation."),
    local_evidence: bool = typer.Option(True, "--local-evidence/--no-local-evidence", help="Also write local dry-run launch evidence artifacts."),
    require_broker_tool_status: bool = typer.Option(False, "--require-broker-tool-status/--no-require-broker-tool-status", help="Require broker tool status in generated local checklist."),
) -> None:
    """Run replay, walk-forward optimization, artifact writes, and preflight in one pass."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    account = account_number or settings.live_account_number
    broker = None
    if local_evidence:
        prices = latest_prices(analysis_symbols(symbols))
        quotes = {
            symbol: QuoteSnapshot(ticker=symbol, bid=round(price * 0.999, 4), ask=round(price * 1.001, 4), last=price, data_fresh=True)
            for symbol, price in prices.items()
        }
        broker = DryRunBrokerClient(
            account=BrokerAccountState(
                account_number=account,
                account_value=settings.live_principal_dollars,
                cash=settings.live_principal_dollars,
                buying_power=settings.live_principal_dollars,
            ),
            quotes=quotes,
            tradability={symbol: True for symbol in symbols},
        )
    report = prepare_live_auto(
        symbols=symbols,
        settings=settings,
        account_number=account,
        now=datetime.now().astimezone(),
        period=period,
        interval=interval,
        train_fraction=train_fraction,
        broker=broker,
        require_broker_tool_status=require_broker_tool_status,
    )
    table = Table(title="Live Auto Preparation")
    table.add_column("Item")
    table.add_column("Value")
    table.add_row("Symbols", ", ".join(symbols))
    table.add_row("Replay trades", str(report.replay.metrics.trades))
    table.add_row("Replay expectancy", f"${report.replay.metrics.expectancy:.4f}")
    table.add_row("Eligible symbols", ", ".join(report.replay.eligible_symbols) or "none")
    table.add_row("Walk-forward candidates", str(len(report.walk_forward)))
    if report.walk_forward:
        table.add_row("Best validation expectancy", f"${report.walk_forward[0].validation_replay.metrics.expectancy:.4f}")
        table.add_row("Best validation status", "blocked: " + "; ".join(report.walk_forward[0].validation_reasons[:2]) if report.walk_forward[0].validation_reasons else "validated")
    table.add_row("Strategy health", str(report.strategy_health_path))
    table.add_row("Optimization report", str(report.optimization_report_path))
    if report.evidence_bundle is not None:
        table.add_row("Account health", str(report.evidence_bundle.account_health_path))
        table.add_row("Reconciliation", str(report.evidence_bundle.reconciliation_path))
        table.add_row("Performance audit", str(report.evidence_bundle.performance_json_path))
        table.add_row("Capital policy", str(report.evidence_bundle.capital_policy_path))
        table.add_row("Launch checklist", str(report.evidence_bundle.checklist_path))
    table.add_row("Ready for live auto", "YES" if report.readiness.ready_for_live_auto else "NO")
    console.print(table)
    if report.readiness.blockers:
        console.print("Blockers: " + "; ".join(f"{item.name}: {item.detail}" for item in report.readiness.blockers))


@app.command("live-auto-session")
def live_auto_session(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    account_number: Optional[str] = typer.Option(None, "--account-number", help="Explicit Agentic account number to check."),
    interval_seconds: float = typer.Option(60.0, "--interval-seconds", min=0.0, help="Seconds between autonomous cycles."),
    cycles: int = typer.Option(1, "--cycles", min=1, help="Maximum cycles to run unless --forever is set."),
    forever: bool = typer.Option(False, "--forever", help="Run until the live gate blocks, runtime expires, or the process is stopped."),
    max_runtime_seconds: Optional[float] = typer.Option(None, "--max-runtime-seconds", min=1.0, help="Optional wall-clock runtime cap."),
    max_consecutive_errors: int = typer.Option(3, "--max-consecutive-errors", min=1, help="Enable the kill switch after this many failed cycles."),
    dry_run: bool = typer.Option(True, "--dry-run/--live", help="Local CLI only supports dry-run; live requires Codex-injected MCP broker functions."),
    simulate_placement: bool = typer.Option(False, "--simulate-placement", help="Let DryRunBrokerClient mark ready orders as filled."),
) -> None:
    """Run a supervised autonomous live-auto session loop."""
    if not dry_run:
        console.print(
            "Live MCP execution cannot be started by local Python alone. "
            "Run this through Codex with an injected CodexMcpBrokerClient/RobintradeBrokerClient."
        )
        raise typer.Exit(code=1)

    settings = load_settings()
    symbols = resolve_tickers(tickers)
    account = account_number or settings.live_account_number or "DRY-RUN"
    prices = latest_prices(analysis_symbols(symbols))
    quotes = {
        symbol: QuoteSnapshot(
            ticker=symbol,
            bid=round(price * 0.999, 4),
            ask=round(price * 1.001, 4),
            last=price,
            data_fresh=True,
        )
        for symbol, price in prices.items()
    }
    broker = DryRunBrokerClient(
        account=BrokerAccountState(
            account_number=account,
            account_value=settings.live_principal_dollars,
            cash=settings.live_principal_dollars,
            buying_power=settings.live_principal_dollars,
        ),
        quotes=quotes,
    )
    report = run_autonomous_session(
        symbols=symbols,
        settings=settings,
        broker=broker,
        account_number=account,
        interval_seconds=interval_seconds,
        max_cycles=None if forever else cycles,
        max_runtime_seconds=max_runtime_seconds,
        max_consecutive_errors=max_consecutive_errors,
        execute=simulate_placement,
        session_path=SESSION_STATE_PATH,
    )
    table = Table(title="Live Auto Session")
    table.add_column("Cycle")
    table.add_column("Gate")
    table.add_column("Orders")
    table.add_column("Next Action")
    table.add_column("Reason")
    for cycle in report.cycles[-10:]:
        table.add_row(
            str(cycle.cycle),
            "armed" if cycle.gate_armed else "blocked",
            f"placed={cycle.placed_orders} ready={cycle.ready_orders} rejected={cycle.rejected_orders}",
            cycle.next_action,
            cycle.error or "; ".join(cycle.reasons) or "none",
        )
    console.print(table)
    console.print(f"Stopped: {report.stopped_reason}")
    console.print(f"Session state: {report.session_path}")
    console.print(f"Heartbeat: {HEARTBEAT_PATH}")


@app.command("live-auto-kill")
def live_auto_kill(
    enabled: bool = typer.Option(..., "--enabled/--disabled", help="Enable or disable the autonomous live-trading kill switch."),
    reason: str = typer.Option("", "--reason", help="Reason to store with the kill-switch state."),
) -> None:
    """Block new autonomous buys while still permitting risk-reducing sells."""
    path = write_kill_switch(enabled, reason=reason)
    console.print(f"Live auto kill switch {'enabled' if enabled else 'disabled'}: {path}")


@app.command("doctor")
def doctor(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    quotes_json: Optional[Path] = typer.Option(None, "--quotes-json", help="Optional JSON file with live quote snapshots keyed by ticker."),
    cache_first_history: bool = typer.Option(True, "--cache-first-history/--no-cache-first-history", help="Prefer fresh cached history before hitting network."),
    history_cache_hours: float = typer.Option(36.0, "--history-cache-hours", min=0.25, help="Fresh-history cache window for doctor/evaluate-live checks."),
    max_symbols: int = typer.Option(80, "--max-symbols", min=10, help="Maximum symbol count when building the expanded live universe."),
    rotate_count: int = typer.Option(40, "--rotate-count", min=0, help="How many non-seed symbols to rotate into the live universe when --tickers is omitted."),
) -> None:
    """Show runtime and market-data readiness for the live monitor."""
    symbols, dynamic = resolve_live_symbols(tickers, max_symbols=max_symbols, rotate_count=rotate_count)
    console.print(f"Python executable: {Path(__import__('sys').executable)}")
    console.print(f"Universe count: {len(symbols)}")
    if dynamic:
        console.print(
            f"Expanded universe mode: seed {dynamic.seed_count}, rotated {dynamic.selected_dynamic_count}, catalog {dynamic.source_catalog_count}"
        )
    provider_keys = load_provider_keys()
    providers = [
        name
        for name, enabled in [
            ("Twelve Data", bool(provider_keys.twelve_data_api_key)),
            ("FMP", bool(provider_keys.fmp_api_key)),
            ("Alpha Vantage", bool(provider_keys.alpha_vantage_api_key)),
        ]
        if enabled
    ]
    console.print(f"Configured market-data providers: {', '.join(providers) if providers else 'none'}")

    quotes = quote_snapshots_from_json(quotes_json) if quotes_json else {}
    if quotes:
        console.print(f"Live quote snapshots supplied: {len(quotes)}")
    else:
        console.print("Live quote snapshots supplied: 0")

    try:
        data = download_history(
            analysis_symbols(symbols),
            period="1y",
            interval="1d",
            prefer_cache=cache_first_history,
            cache_max_age_seconds=int(history_cache_hours * 3600),
        )
    except RuntimeError as exc:
        console.print(f"History status: FAIL - {exc}")
        raise typer.Exit(1)

    console.print(f"History status: OK - {len(data.history)} rows loaded")
    if quotes:
        data = overlay_quote_snapshots(data, quotes)
    evaluations = evaluate_market_data(data, load_settings(), quote_snapshots=quotes)
    valid_buys = sum(item.decision == VALID_BUY_SETUP for item in evaluations)
    valid_sells = sum(item.decision == VALID_SELL_SIGNAL for item in evaluations)
    console.print(f"Evaluation status: OK - {len(evaluations)} tickers, {valid_buys} buy setup(s), {valid_sells} sell signal(s)")


@app.command("live-agent")
def live_agent(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    interval: int = typer.Option(60, "--interval", "-i", min=15, help="Seconds between refreshes."),
    once: bool = typer.Option(False, "--once", help="Run one live cycle and exit."),
    include_closed: bool = typer.Option(False, "--include-closed", help="Allow cycles outside regular US market hours."),
    limit: int = typer.Option(15, "--limit", "-l", min=1, help="Rows to show."),
    cache_first_history: bool = typer.Option(True, "--cache-first-history/--no-cache-first-history", help="Prefer fresh cached history before hitting network."),
    history_cache_hours: float = typer.Option(36.0, "--history-cache-hours", min=0.25, help="Fresh-history cache window for live cycles."),
    max_symbols: int = typer.Option(80, "--max-symbols", min=10, help="Maximum symbol count when building the expanded live universe."),
    rotate_count: int = typer.Option(40, "--rotate-count", min=0, help="How many non-seed symbols to rotate into the live universe when --tickers is omitted."),
    notify_readiness: bool = typer.Option(False, "--notify-readiness", help="Send the once-per-day Money Maker Active Telegram ping after a successful cycle."),
) -> None:
    """Run the recurring live monitor over the expanded rotating universe."""
    settings = load_settings()

    while True:
        state = market_state(settings)
        if state != "open" and not include_closed:
            console.print(f"Market is {state}; live agent is waiting for regular US hours.")
            if once:
                return
            time.sleep(interval)
            continue

        symbols, dynamic = resolve_live_symbols(tickers, max_symbols=max_symbols, rotate_count=rotate_count)
        console.print(f"Live agent cycle: market {state}; symbols {len(symbols)}")
        if dynamic:
            console.print(
                f"Expanded universe: seed {dynamic.seed_count}, rotated {dynamic.selected_dynamic_count}, catalog {dynamic.source_catalog_count}"
            )

        try:
            data = download_history(
                analysis_symbols(symbols),
                period="1y",
                interval="1d",
                prefer_cache=cache_first_history,
                cache_max_age_seconds=int(history_cache_hours * 3600),
            )
        except RuntimeError as exc:
            console.print(f"Live agent fail-closed: {exc}")
            if once:
                return
            time.sleep(interval)
            continue

        data = overlay_latest_closes(data, latest_prices(analysis_symbols(symbols)))
        evaluations = evaluate_market_data(data, settings)
        render_evaluations(evaluations, limit)
        path = write_evaluations_json(evaluations)
        console.print(f"Wrote evaluations: {path}")

        if notify_readiness:
            today = datetime.now().date().isoformat()
            live_state = load_live_agent_state()
            if live_state.get("last_readiness_date") != today:
                try:
                    send_telegram_message(format_market_status_update(is_open=True))
                except TelegramConfigError as exc:
                    console.print(f"Telegram not configured: {exc}")
                except RuntimeError as exc:
                    console.print(str(exc))
                else:
                    live_state["last_readiness_date"] = today
                    save_live_agent_state(live_state)
                    console.print("Sent readiness Telegram ping.")

        if once:
            return
        time.sleep(interval)


@app.command("notify-market")
def notify_market(
    state: str = typer.Argument(..., help="'open' or 'closed'."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the notification instead of sending it."),
) -> None:
    """Send a simple market open/closed Telegram status."""
    normalized = state.strip().lower()
    if normalized not in {"open", "closed"}:
        console.print("state must be 'open' or 'closed'")
        raise typer.Exit(1)
    message = format_market_status_update(is_open=normalized == "open")
    if dry_run:
        console.print(message)
        return
    try:
        send_telegram_message(message)
    except TelegramConfigError as exc:
        console.print(f"Telegram not configured: {exc}")
        raise typer.Exit(1)
    except RuntimeError as exc:
        console.print(str(exc))
        raise typer.Exit(1)
    console.print("Sent Telegram market status.")


@app.command("notify")
def notify(
    title: str = typer.Option(..., "--title", "-t", help="Short notification title."),
    line: Optional[List[str]] = typer.Option(None, "--line", "-l", help="Detail line; repeat for multiple lines."),
    no_robinhood_guard: bool = typer.Option(False, "--no-robinhood-guard", help="Omit the Robinhood approval guardrail text."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the notification instead of sending it."),
) -> None:
    """Send a manual Telegram notification."""
    try:
        guardrail_summary = None
        if not no_robinhood_guard:
            guardrail_summary = BrokerGuardrails.from_settings(load_settings()).summary()
        message = format_manual_notification(
            title,
            line,
            robinhood_guard=not no_robinhood_guard,
            guardrail_summary=guardrail_summary,
        )
    except ValueError as exc:
        console.print(str(exc))
        raise typer.Exit(1)

    if dry_run:
        console.print(message)
        return
    try:
        send_telegram_message(message)
    except TelegramConfigError as exc:
        console.print(f"Telegram not configured: {exc}")
        raise typer.Exit(1)
    except RuntimeError as exc:
        console.print(str(exc))
        raise typer.Exit(1)
    console.print("Sent Telegram notification.")


@telegram_app.command("approval-request")
def telegram_approval_request(
    action: str = typer.Option(..., "--action", help="Order action needing approval: BUY or SELL."),
    symbol: str = typer.Option(..., "--symbol", help="Ticker symbol needing approval."),
    amount: float = typer.Option(..., "--amount", min=0.01, help="Dollar notional needing approval."),
    stop: Optional[float] = typer.Option(
        None,
        "--stop",
        min=0.01,
        help="Planned stop price for the approval record.",
    ),
    take_profit: Optional[float] = typer.Option(
        None,
        "--take-profit",
        min=0.01,
        help="Planned first profit target for the approval record.",
    ),
    detail: Optional[List[str]] = typer.Option(None, "--detail", help="Optional review detail; repeat for multiple lines."),
    replace: bool = typer.Option(False, "--replace", help="Replace an existing pending approval."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print and save request without sending Telegram."),
) -> None:
    """Create a pending Telegram YES/NO approval request."""
    try:
        request = create_telegram_approval_request(
            action=action,
            symbol=symbol,
            dollar_amount=amount,
            details=detail,
            stop_price=stop,
            take_profit_price=take_profit,
            replace=replace,
        )
        message = format_telegram_approval_request(request)
    except (RuntimeError, ValueError) as exc:
        console.print(str(exc))
        raise typer.Exit(1)

    if dry_run:
        console.print(message)
        return
    try:
        send_telegram_message(message)
    except TelegramConfigError as exc:
        console.print(f"Telegram not configured: {exc}")
        raise typer.Exit(1)
    except RuntimeError as exc:
        console.print(str(exc))
        raise typer.Exit(1)
    console.print(f"Sent Telegram approval request: {request['id']}")


@telegram_app.command("approval-poll")
def telegram_approval_poll(
    poll_timeout: int = typer.Option(0, "--poll-timeout", min=0, max=30, help="Telegram long-poll timeout in seconds."),
) -> None:
    """Poll Telegram and record the first YES/NO reply from the configured chat."""
    try:
        state = poll_telegram_approval(poll_timeout=poll_timeout)
    except TelegramConfigError as exc:
        console.print(f"Telegram not configured: {exc}")
        raise typer.Exit(1)
    except RuntimeError as exc:
        console.print(str(exc))
        raise typer.Exit(1)

    pending = state.get("pending")
    if not isinstance(pending, dict):
        console.print("No approval request exists.")
        return

    status = str(pending.get("status", "unknown"))
    action = str(pending.get("action", "")).upper()
    symbol = str(pending.get("symbol", "")).upper()
    amount = float(pending.get("dollar_amount", 0) or 0)
    console.print(f"Approval status: {status} | {action} {symbol} {format_money(amount)} | {pending.get('id')}")


@telegram_app.command("approval-status")
def telegram_approval_status() -> None:
    """Show the current Telegram approval state."""
    state = load_telegram_approval_state()
    pending = state.get("pending")
    if not isinstance(pending, dict):
        console.print("No approval request exists.")
        return
    action = str(pending.get("action", "")).upper()
    symbol = str(pending.get("symbol", "")).upper()
    amount = float(pending.get("dollar_amount", 0) or 0)
    console.print(
        f"Approval status: {pending.get('status', 'unknown')} | "
        f"{action} {symbol} {format_money(amount)} | {pending.get('id')}"
    )


@paper_app.command("buy")
def paper_buy(
    ticker: str,
    shares: float,
    price: float,
    note: str = typer.Option("", "--note", "-n"),
) -> None:
    """Record a paper buy."""
    settings = load_settings()
    trade = record_trade("BUY", ticker, shares, price, note, settings.market_timezone)
    console.print(f"Recorded paper BUY: {trade.shares:g} {trade.ticker} @ ${trade.price:.2f}")


@paper_app.command("sell")
def paper_sell(
    ticker: str,
    shares: float,
    price: float,
    note: str = typer.Option("", "--note", "-n"),
) -> None:
    """Record a paper sell."""
    settings = load_settings()
    trade = record_trade("SELL", ticker, shares, price, note, settings.market_timezone)
    console.print(f"Recorded paper SELL: {trade.shares:g} {trade.ticker} @ ${trade.price:.2f}")


@paper_app.command("ledger")
def paper_ledger() -> None:
    """Show the paper-trading journal."""
    trades = read_ledger()
    table = Table(title="Paper Trades")
    for column in ["Time", "Side", "Ticker", "Shares", "Price", "Notional", "Note"]:
        table.add_column(column)
    for trade in trades:
        table.add_row(
            trade.timestamp,
            trade.side,
            trade.ticker,
            f"{trade.shares:g}",
            f"${trade.price:.2f}",
            f"${trade.notional:,.2f}",
            trade.note,
        )
    console.print(table)


@paper_app.command("telegram-test")
def paper_telegram_test(
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the test message instead of sending it."),
) -> None:
    """Send a Telegram test alert using environment credentials."""
    message = "\n".join(
        [
            "Money Maker Update: Telegram test from Stock Guru.",
            "Bot Details: No trade signal; connection test only.",
            "Robinhood Context: Not checked for this test.",
            "Action: No real Robinhood order was placed.",
            "Refresh: Test message only.",
        ]
    )
    if dry_run:
        console.print(message)
        return
    try:
        send_telegram_message(message)
    except TelegramConfigError as exc:
        console.print(f"Telegram not configured: {exc}")
        raise typer.Exit(1)
    except RuntimeError as exc:
        console.print(str(exc))
        raise typer.Exit(1)
    console.print("Sent Telegram test message.")


@paper_app.command("bot")
def paper_bot(
    tickers: Optional[List[str]] = typer.Option(None, "--tickers", "-t", help="Repeatable ticker option or comma-separated ticker groups."),
    budget: float = typer.Option(20.0, "--budget", "-b", min=1.0, help="Starting paper bankroll."),
    interval: int = typer.Option(60, "--interval", "-i", min=15, help="Seconds between refreshes."),
    limit: int = typer.Option(10, "--limit", "-l", min=1, help="Ranking rows to show."),
    once: bool = typer.Option(False, "--once", help="Run one refresh and exit."),
    include_closed: bool = typer.Option(False, "--include-closed", help="Keep running outside regular market hours."),
    reset: bool = typer.Option(False, "--reset", help="Reset the paper bot bankroll before running."),
    entry_score: float = typer.Option(72.0, "--entry-score", min=0, max=100, help="Minimum score required to buy."),
    exit_score: float = typer.Option(55.0, "--exit-score", min=0, max=100, help="Sell if held ticker drops below this score."),
    stop_loss_pct: float = typer.Option(0.02, "--stop-loss", min=0.001, max=0.5, help="Fractional stop loss, e.g. 0.02 for 2%."),
    take_profit_pct: float = typer.Option(0.03, "--take-profit", min=0.001, max=1.0, help="Fractional take profit, e.g. 0.03 for 3%."),
    trade_dollars: Optional[float] = typer.Option(None, "--trade-dollars", min=1.0, help="Target dollars for each new paper buy ticket."),
    ticket_stale_minutes: int = typer.Option(5, "--ticket-stale-minutes", min=1, help="Minutes before a manual broker ticket should be refreshed."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the next action without recording it."),
    notify_telegram: bool = typer.Option(False, "--notify-telegram", help="Send useful copilot updates to Telegram."),
    telegram_always: bool = typer.Option(False, "--telegram-always", help="Send Telegram updates every refresh instead of only on useful changes."),
) -> None:
    """Run an automatic paper-trading loop with fractional shares."""
    settings = load_settings()
    symbols = resolve_tickers(tickers)
    if reset:
        reset_bot_state(budget)
        console.print(f"Reset paper bot bankroll to ${budget:,.2f}.")

    while True:
        state = market_state(settings)
        if state != "open" and not include_closed:
            console.print(f"Market is {state}; run with --include-closed to paper trade anyway.")
            if once:
                return
            time.sleep(interval)
            continue

        console.clear()
        console.print(f"Market state: {state}. Paper bot refresh interval: {interval}s.")
        data = download_history(analysis_symbols(symbols), period="1y", interval="1d")
        data = overlay_latest_closes(data, latest_prices(analysis_symbols(symbols)))
        candidate_data = MarketData(symbols, data.history)
        candidates = score_candidates(candidate_data, settings, budget)
        bot_state = load_bot_state(starting_cash=budget)
        positions = {
            ticker: PositionSnapshot(ticker=ticker, shares=position.shares, average_cost=position.avg_cost)
            for ticker, position in bot_state.positions.items()
        }
        evaluations = {item.ticker: item for item in evaluate_market_data(data, settings, positions=positions)}
        snapshot = run_bot_once(
            candidates=candidates,
            settings=settings,
            starting_cash=budget,
            entry_score=entry_score,
            exit_score=exit_score,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            trade_dollars=trade_dollars,
            evaluations=evaluations,
            dry_run=dry_run,
        )
        render_bot_snapshot(snapshot, limit)
        ticket = build_trade_ticket(
            snapshot,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            stale_minutes=ticket_stale_minutes,
        )
        render_trade_ticket(ticket)
        write_markdown_report(candidates, settings, budget)
        ticket_path = write_ticket_markdown(ticket)
        console.print(f"Wrote copilot ticket: {ticket_path}")
        if notify_telegram:
            message = format_ticket_update(ticket, snapshot, market_state=state)
            should_send, signature = should_send_update(
                ticket,
                snapshot,
                market_state=state,
                always=telegram_always,
            )
            if should_send:
                try:
                    send_telegram_message(message)
                except TelegramConfigError as exc:
                    console.print(f"Telegram not configured: {exc}")
                except RuntimeError as exc:
                    console.print(str(exc))
                else:
                    save_last_signature(signature)
                    console.print("Sent Telegram copilot update.")
            else:
                console.print("Skipped Telegram update: no useful change.")
        if once:
            return
        time.sleep(interval)


if __name__ == "__main__":
    app()
