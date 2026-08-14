from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Sequence
from zoneinfo import ZoneInfo

from .config import DATA_DIR, load_settings
from .evaluator import (
    EVALUATIONS_PATH,
    HELD_PROFIT_LOCK_PCT,
    HELD_PROFIT_TARGET_PCT,
    HELD_STOP_LOSS_PCT,
    VALID_BUY_SETUP,
    VALID_SELL_SIGNAL,
)
from .notifier import TELEGRAM_APPROVAL_STATE_PATH, TelegramConfigError, send_telegram_message
from .live_autonomy import live_session_gate
from .research import NewsHeadline, fetch_today_headlines


ROOT_DIR = Path(__file__).resolve().parents[2]
STATE_PATH = DATA_DIR / "money_maker_watchdog_state.json"
LOCK_PATH = DATA_DIR / "money_maker_watchdog.lock"
LOG_PATH = DATA_DIR / "money_maker_watchdog.log"
ENV_PATH = DATA_DIR / "money_maker_watchdog.env"
MARKET_TZ = ZoneInfo("America/New_York")
MIN_PROFIT_REVIEW_DOLLARS = 0.005
PROFIT_GIVEBACK_DOLLARS = 0.01
PROFIT_GIVEBACK_RATIO = 0.2
NEWS_CONTEXT_LIMIT = 3


@dataclass(frozen=True)
class CycleSummary:
    total: int
    rows: list[dict[str, object]]
    buys: list[dict[str, object]]
    sells: list[dict[str, object]]
    rejects: int


@dataclass(frozen=True)
class LiveHolding:
    symbol: str
    shares: float | None = None
    average_price: float | None = None
    notional: float | None = None
    stop_price: float | None = None
    take_profit_price: float | None = None


@dataclass(frozen=True)
class HoldingPlan:
    stop_price: float | None
    profit_lock_price: float | None
    target_1: float | None
    target_2: float | None
    risk_dollars: float | None
    risk_pct: float | None
    pnl_dollars: float | None
    pnl_pct: float | None
    peak_pnl_dollars: float | None
    stop_active: bool
    target_active: bool
    profit_capture_active: bool
    profit_giveback_active: bool


def log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(MARKET_TZ).isoformat(timespec="seconds")
    with LOG_PATH.open("a") as handle:
        handle.write(f"{timestamp} {message}\n")


def load_state() -> dict[str, object]:
    if not STATE_PATH.exists():
        return {}
    try:
        payload = json.loads(STATE_PATH.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def load_env_file(path: Path = ENV_PATH) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def save_state(state: dict[str, object]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def is_regular_market_open(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    return time(9, 30) <= now.time() < time(16, 0)


def acquire_lock() -> bool:
    if LOCK_PATH.exists():
        try:
            age = datetime.now().timestamp() - LOCK_PATH.stat().st_mtime
        except OSError:
            age = 0
        if age < 300:
            return False
        LOCK_PATH.unlink(missing_ok=True)
    try:
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w") as handle:
        handle.write(str(os.getpid()))
    return True


def release_lock() -> None:
    LOCK_PATH.unlink(missing_ok=True)


def run_live_agent() -> subprocess.CompletedProcess[str]:
    command = [
        str(ROOT_DIR / "bin" / "stock-guru"),
        "live-agent",
        "--once",
        "--cache-first-history",
        "--history-cache-hours",
        "36",
    ]
    return subprocess.run(
        command,
        cwd=ROOT_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
        check=False,
    )


def summarize_evaluations() -> CycleSummary:
    if not EVALUATIONS_PATH.exists():
        return CycleSummary(total=0, rows=[], buys=[], sells=[], rejects=0)
    payload = json.loads(EVALUATIONS_PATH.read_text())
    rows = payload if isinstance(payload, list) else []
    buys = [item for item in rows if item.get("decision") == VALID_BUY_SETUP]
    sells = [item for item in rows if item.get("decision") == VALID_SELL_SIGNAL]
    rejects = sum(1 for item in rows if item.get("decision") == "REJECT")
    return CycleSummary(total=len(rows), rows=rows, buys=buys, sells=sells, rejects=rejects)


def signal_signature(summary: CycleSummary) -> str:
    tickers = [str(item.get("ticker", "")).upper() for item in summary.buys + summary.sells]
    return ",".join(sorted(ticker for ticker in tickers if ticker))


def send_readiness_if_needed(state: dict[str, object], now: datetime) -> None:
    today = now.date().isoformat()
    if state.get("watchdog_readiness_date") == today:
        return
    settings = load_settings()
    gate = live_session_gate(settings, account_number=settings.live_account_number, now=now)
    action = (
        "Action: Live auto is armed; broker review is the confirmation gate."
        if gate.armed
        else "Action: Live auto is blocked: " + "; ".join(gate.reasons)
    )
    send_telegram_message(
        "\n".join(
            [
                "Money Maker Update: Money Maker Active.",
                "Bot Details: Automatic watchdog is checking Stock Guru every minute during regular market hours.",
                action,
            ]
        )
    )
    state["watchdog_readiness_date"] = today


def latest_executed_holding(path: Path = TELEGRAM_APPROVAL_STATE_PATH) -> LiveHolding | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    pending = payload.get("pending") if isinstance(payload, dict) else None
    if not isinstance(pending, dict):
        return None
    if pending.get("action") != "BUY" or pending.get("status") != "executed":
        return None

    symbol = str(pending.get("symbol", "")).strip().upper()
    if not symbol:
        return None

    shares = None
    average_price = None
    stop_price = None
    take_profit_price = None
    details = pending.get("details")
    if isinstance(details, list):
        for item in details:
            if not isinstance(item, str):
                continue
            match = re.search(r"Filled:\s*([0-9.]+)\s+([A-Z]+)\s+at average price\s+\$([0-9.]+)", item)
            if match and match.group(2).upper() == symbol:
                shares = float(match.group(1))
                average_price = float(match.group(3))
            stop_match = re.search(r"\bStop:\s*\$?([0-9.]+)", item, re.IGNORECASE)
            if stop_match:
                stop_price = float(stop_match.group(1))
            target_match = re.search(r"\b(?:Take profit|Target):\s*\$?([0-9.]+)", item, re.IGNORECASE)
            if target_match:
                take_profit_price = float(target_match.group(1))

    notional = None
    amount = pending.get("dollar_amount")
    if isinstance(amount, (int, float)):
        notional = float(amount)
    elif shares is not None and average_price is not None:
        notional = shares * average_price

    raw_stop = pending.get("stop_price")
    raw_target = pending.get("take_profit_price")
    if isinstance(raw_stop, (int, float)):
        stop_price = float(raw_stop)
    if isinstance(raw_target, (int, float)):
        take_profit_price = float(raw_target)

    return LiveHolding(
        symbol=symbol,
        shares=shares,
        average_price=average_price,
        notional=notional,
        stop_price=stop_price,
        take_profit_price=take_profit_price,
    )


def evaluation_for_symbol(summary: CycleSummary, symbol: str) -> dict[str, object] | None:
    wanted = symbol.upper()
    for item in summary.rows:
        if str(item.get("ticker", "")).upper() == wanted:
            return item
    return None


def money(value: object) -> str:
    try:
        return f"${float(value):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def pct(value: float) -> str:
    return f"{value:+.2%}"


def held_position_plan(
    holding: LiveHolding,
    evaluation: dict[str, object] | None,
    *,
    peak_pnl_dollars: float | None = None,
) -> HoldingPlan:
    average_price = holding.average_price
    if average_price is None or average_price <= 0:
        return HoldingPlan(
            None, None, None, None, None, None, None, None, None, False, False, False, False
        )

    hard_stop = average_price * (1 - HELD_STOP_LOSS_PCT)
    stop_candidates = [hard_stop]
    if holding.stop_price is not None and holding.stop_price > 0:
        stop_candidates.append(holding.stop_price)
    if evaluation:
        try:
            technical_stop = float(evaluation.get("stop_loss", 0) or 0)
        except (TypeError, ValueError):
            technical_stop = 0.0
        if technical_stop > 0:
            stop_candidates.append(technical_stop)
    stop_price = max(stop_candidates)

    profit_lock_price = average_price * (1 + HELD_PROFIT_LOCK_PCT)
    target_1 = (
        holding.take_profit_price
        if holding.take_profit_price is not None and holding.take_profit_price > average_price
        else average_price * (1 + HELD_PROFIT_TARGET_PCT)
    )
    target_2 = average_price * (1 + HELD_PROFIT_TARGET_PCT * 2)

    shares = holding.shares or 0.0
    notional = holding.notional if holding.notional and holding.notional > 0 else average_price * shares
    risk_dollars = max(0.0, average_price - stop_price) * shares if shares > 0 else None
    risk_pct = risk_dollars / notional if risk_dollars is not None and notional > 0 else None

    price = 0.0
    if evaluation:
        try:
            price = float(evaluation.get("current_price", 0) or 0)
        except (TypeError, ValueError):
            price = 0.0
    pnl_dollars = (price - average_price) * shares if price > 0 and shares > 0 else None
    pnl_pct = (price / average_price - 1) if price > 0 else None
    observed_peak = peak_pnl_dollars
    if pnl_dollars is not None:
        observed_peak = max(pnl_dollars, observed_peak if observed_peak is not None else pnl_dollars)
    profit_capture_active = pnl_dollars is not None and pnl_dollars >= MIN_PROFIT_REVIEW_DOLLARS
    giveback_floor = max(
        PROFIT_GIVEBACK_DOLLARS,
        (observed_peak or 0.0) * PROFIT_GIVEBACK_RATIO,
    )
    profit_giveback_active = (
        observed_peak is not None
        and observed_peak >= MIN_PROFIT_REVIEW_DOLLARS
        and pnl_dollars is not None
        and pnl_dollars > 0
        and observed_peak - pnl_dollars >= giveback_floor
    )
    return HoldingPlan(
        stop_price=stop_price,
        profit_lock_price=profit_lock_price,
        target_1=target_1,
        target_2=target_2,
        risk_dollars=risk_dollars,
        risk_pct=risk_pct,
        pnl_dollars=pnl_dollars,
        pnl_pct=pnl_pct,
        peak_pnl_dollars=observed_peak,
        stop_active=price > 0 and price <= stop_price,
        target_active=price > 0 and price >= target_1,
        profit_capture_active=profit_capture_active,
        profit_giveback_active=profit_giveback_active,
    )


def plan_line(plan: HoldingPlan) -> str:
    risk = "risk unavailable"
    if plan.risk_dollars is not None and plan.risk_pct is not None:
        risk = f"risk {money(plan.risk_dollars)} ({plan.risk_pct:.1%} position)"
    return (
        f"Plan: stop {money(plan.stop_price)}; profit lock {money(plan.profit_lock_price)}; "
        f"targets {money(plan.target_1)} / {money(plan.target_2)}; {risk}."
    )


def profit_context_line(plan: HoldingPlan) -> str:
    if plan.peak_pnl_dollars is None:
        return "Peak P/L: tracking; profit-capture review starts when current P/L is positive."
    giveback = ""
    if plan.pnl_dollars is not None:
        giveback_value = max(0.0, plan.peak_pnl_dollars - plan.pnl_dollars)
        giveback = f"; giveback {money(giveback_value)}"
    return (
        f"Peak P/L: {money(plan.peak_pnl_dollars)} max{giveback}; "
        "profit-capture review starts when current P/L is positive."
    )


def news_context_line(symbol: str, news_items: Sequence[NewsHeadline]) -> str:
    if not news_items:
        return f"Today's {symbol} news: no same-day headlines found by the live news feed; verify live news before acting."
    parts: list[str] = []
    for item in news_items[:NEWS_CONTEXT_LIMIT]:
        source = f" ({item.publisher})" if item.publisher else ""
        when = f" {item.published_at.strftime('%H:%M %Z')}" if item.published_at else ""
        parts.append(f"{item.title}{source}{when}")
    return f"Today's {symbol} news: " + " | ".join(parts)


def waiting_status_line(evaluation: dict[str, object] | None) -> str:
    if not evaluation:
        return "Waiting For: latest scan data for the held ticker."
    decision = str(evaluation.get("decision", ""))
    if decision == VALID_SELL_SIGNAL:
        return "Waiting For: nothing; sell signal is active and needs review."
    if evaluation.get("volume_confirmation") is False:
        return "Waiting For: price to keep holding up and volume to confirm the move."
    if evaluation.get("trend_confirmation") is False:
        return "Waiting For: trend to rebuild before adding risk."
    return "Waiting For: price to push toward the profit target while sell rules stay quiet."


def holding_waiting_status_line(evaluation: dict[str, object] | None, plan: HoldingPlan) -> str:
    if plan.stop_active:
        return "Waiting For: nothing; planned stop is crossed and sell review is active."
    if plan.target_active:
        return "Waiting For: nothing; profit target is reached and sell review is active."
    if plan.profit_giveback_active:
        return "Waiting For: nothing; peak profit is giving back and sell review is active."
    if plan.profit_capture_active:
        return "Waiting For: nothing; position is profitable and sell review is active."
    if evaluation and str(evaluation.get("decision", "")) == VALID_SELL_SIGNAL:
        return "Waiting For: nothing; sell signal is active and needs review."
    return waiting_status_line(evaluation)


def format_status_heartbeat(
    summary: CycleSummary,
    holding: LiveHolding | None,
    now: datetime,
    *,
    peak_pnl_dollars: float | None = None,
    news_items: Sequence[NewsHeadline] = (),
) -> str:
    if holding:
        evaluation = evaluation_for_symbol(summary, holding.symbol)
        price = float(evaluation.get("current_price", 0) or 0) if evaluation else 0.0
        plan = held_position_plan(holding, evaluation, peak_pnl_dollars=peak_pnl_dollars)
        pnl_line = "P/L: unavailable until the held ticker appears in the scan."
        if holding.average_price and price > 0:
            per_share = price - holding.average_price
            total = f" / {money(plan.pnl_dollars)} total" if plan.pnl_dollars is not None else ""
            pnl_pct = pct(price / holding.average_price - 1)
            pnl_line = f"P/L: {money(per_share)} per share ({pnl_pct}){total} from avg {money(holding.average_price)}."
        reason = (
            str(evaluation.get("main_reason_valid") or evaluation.get("main_risk") or "scan pending")
            if evaluation
            else "scan pending"
        )
        price_line = f"{holding.symbol} price {money(price)}" if price > 0 else f"{holding.symbol} price unavailable"
        position_line = f"Position: {holding.shares:.6f} sh" if holding.shares is not None else "Position: shares unavailable"
        if holding.notional is not None:
            position_line += f" / {money(holding.notional)}"
        sell_rule_active = (
            plan.stop_active
            or plan.target_active
            or plan.profit_capture_active
            or plan.profit_giveback_active
            or (evaluation and str(evaluation.get("decision", "")) == VALID_SELL_SIGNAL)
        )
        if plan.profit_giveback_active:
            action_line = "Action: No order placed by watchdog; review SELL now because peak profit is giving back."
        elif plan.profit_capture_active:
            action_line = "Action: No order placed by watchdog; review SELL now because the position is profitable."
        elif sell_rule_active:
            action_line = "Action: No order placed by watchdog; review SELL now because a stop/target rule is active."
        else:
            action_line = "Action: No order placed by watchdog; sell only on active sell rule or explicit approval."
        return "\n".join(
            [
                f"Money Maker Status: Hold check {now.strftime('%H:%M %Z')}.",
                f"Bot Details: {position_line}; {price_line}.",
                plan_line(plan),
                pnl_line,
                profit_context_line(plan),
                news_context_line(holding.symbol, news_items),
                holding_waiting_status_line(evaluation, plan),
                f"Reason: {reason}.",
                action_line,
            ]
        )

    lead = summary.buys[0] if summary.buys else None
    if lead:
        return "\n".join(
            [
                f"Money Maker Status: Watch check {now.strftime('%H:%M %Z')}.",
                f"Bot Details: {summary.total} symbols checked; top setup {lead.get('ticker')} score {lead.get('score')} at {money(lead.get('current_price'))}.",
                "Waiting For: explicit approval and available buying power before any new buy.",
                f"Reason: {lead.get('main_reason_valid') or lead.get('main_risk')}.",
                "Action: No order placed by watchdog.",
            ]
        )
    return "\n".join(
        [
            f"Money Maker Status: Watch check {now.strftime('%H:%M %Z')}.",
            f"Bot Details: {summary.total} symbols checked; valid buys 0; sell signals {len(summary.sells)}.",
            "Waiting For: a clean setup with price, trend, volume, liquidity, and risk/reward aligned.",
            "Action: No order placed by watchdog.",
        ]
    )


def holding_signature(holding: LiveHolding) -> str:
    shares = f"{holding.shares:.6f}" if holding.shares is not None else "unknown"
    average = f"{holding.average_price:.4f}" if holding.average_price is not None else "unknown"
    return f"{holding.symbol.upper()}:{shares}:{average}"


def update_holding_peak_profit(
    state: dict[str, object],
    holding: LiveHolding | None,
    summary: CycleSummary,
    now: datetime,
) -> float | None:
    if holding is None:
        return None
    evaluation = evaluation_for_symbol(summary, holding.symbol)
    plan = held_position_plan(holding, evaluation)
    if plan.pnl_dollars is None:
        return None

    raw_peaks = state.get("held_profit_peaks")
    peaks = raw_peaks if isinstance(raw_peaks, dict) else {}
    symbol = holding.symbol.upper()
    signature = holding_signature(holding)
    previous_peak = plan.pnl_dollars
    prior = peaks.get(symbol)
    if isinstance(prior, dict) and prior.get("signature") == signature:
        try:
            previous_peak = float(prior.get("peak_pnl_dollars", previous_peak) or previous_peak)
        except (TypeError, ValueError):
            previous_peak = plan.pnl_dollars

    peak = round(max(previous_peak, plan.pnl_dollars), 4)
    peaks[symbol] = {
        "signature": signature,
        "peak_pnl_dollars": peak,
        "current_pnl_dollars": round(plan.pnl_dollars, 4),
        "updated_at": now.isoformat(timespec="seconds"),
    }
    state["held_profit_peaks"] = peaks
    return peak


def maybe_send_status_heartbeat(state: dict[str, object], summary: CycleSummary, now: datetime) -> None:
    holding = latest_executed_holding()
    peak_pnl_dollars = update_holding_peak_profit(state, holding, summary, now)
    last_sent = state.get("last_status_heartbeat_at")
    should_send = False
    if not isinstance(last_sent, str):
        should_send = True
    else:
        try:
            prior = datetime.fromisoformat(last_sent)
            should_send = now - prior >= timedelta(minutes=2)
        except ValueError:
            should_send = True
    if not should_send:
        return

    news_items: list[NewsHeadline] = []
    if holding:
        try:
            news_items = fetch_today_headlines(
                holding.symbol,
                now=now,
                limit=NEWS_CONTEXT_LIMIT,
                timezone_name=MARKET_TZ.key,
            )
        except Exception as exc:
            log(f"news_context_failed {holding.symbol} {exc}")

    send_telegram_message(
        format_status_heartbeat(
            summary,
            holding,
            now,
            peak_pnl_dollars=peak_pnl_dollars,
            news_items=news_items,
        )
    )
    state["last_status_heartbeat_at"] = now.isoformat(timespec="seconds")


def maybe_send_cycle_update(state: dict[str, object], summary: CycleSummary, now: datetime) -> None:
    signature = signal_signature(summary)
    holding = latest_executed_holding()
    if holding:
        state["last_signal_signature"] = signature
        return

    if signature and signature != state.get("last_signal_signature"):
        settings = load_settings()
        gate = live_session_gate(settings, account_number=settings.live_account_number, now=now)
        action = (
            "Action: Live auto is armed; Codex/MCP may review and place only broker-approved orders."
            if gate.armed
            else "Action: Live auto is blocked: " + "; ".join(gate.reasons)
        )
        lines = [
            "Money Maker Update: Buy/Sell Setup Found.",
            f"Bot Details: {summary.total} symbols checked | valid buys: {len(summary.buys)} | sell signals: {len(summary.sells)}.",
            action,
        ]
        for item in (summary.buys + summary.sells)[:5]:
            lines.append(
                f"Signal: {item.get('ticker')} {item.get('decision')} score {item.get('score')} price ${float(item.get('current_price', 0) or 0):.2f}."
            )
        send_telegram_message("\n".join(lines))
        state["last_signal_signature"] = signature
        return

    last_no_trade = state.get("last_no_trade_notice_at")
    should_send_no_trade = False
    if not isinstance(last_no_trade, str):
        should_send_no_trade = True
    else:
        try:
            prior = datetime.fromisoformat(last_no_trade)
            should_send_no_trade = now - prior >= timedelta(minutes=15)
        except ValueError:
            should_send_no_trade = True

    if not signature and should_send_no_trade:
        send_telegram_message(
            "\n".join(
                [
                    "Money Maker Update: Money Maker Active.",
                    f"Bot Details: Automatic check complete: {summary.total} symbols checked | valid buys: 0 | sell signals: 0.",
                    "Action: No order placed because no current setup passed.",
                ]
            )
        )
        state["last_no_trade_notice_at"] = now.isoformat(timespec="seconds")
    state["last_signal_signature"] = signature


def run_once() -> int:
    load_env_file()
    now = datetime.now(MARKET_TZ)
    state = load_state()
    state["last_watchdog_attempt_at"] = now.isoformat(timespec="seconds")

    if not is_regular_market_open(now):
        state["last_status"] = "market_closed"
        save_state(state)
        log("skip market_closed")
        return 0

    if not acquire_lock():
        state["last_status"] = "locked"
        save_state(state)
        log("skip locked")
        return 0

    try:
        try:
            send_readiness_if_needed(state, now)
        except (TelegramConfigError, RuntimeError) as exc:
            log(f"telegram_readiness_failed {exc}")

        try:
            result = run_live_agent()
        except subprocess.TimeoutExpired:
            state["last_status"] = "live_agent_timeout"
            log("live_agent timeout")
            return 1

        state["last_live_agent_returncode"] = result.returncode
        state["last_live_agent_output_tail"] = result.stdout[-2000:]
        if result.returncode != 0:
            state["last_status"] = "live_agent_failed"
            log(f"live_agent failed rc={result.returncode}")
            return result.returncode

        summary = summarize_evaluations()
        state["last_status"] = "ok"
        state["last_cycle_at"] = now.isoformat(timespec="seconds")
        state["last_total"] = summary.total
        state["last_valid_buys"] = len(summary.buys)
        state["last_sell_signals"] = len(summary.sells)
        state["last_rejects"] = summary.rejects
        try:
            maybe_send_cycle_update(state, summary, now)
        except (TelegramConfigError, RuntimeError) as exc:
            log(f"telegram_cycle_failed {exc}")
        try:
            maybe_send_status_heartbeat(state, summary, now)
        except (TelegramConfigError, RuntimeError) as exc:
            log(f"telegram_heartbeat_failed {exc}")
        log(f"ok total={summary.total} buys={len(summary.buys)} sells={len(summary.sells)}")
        return 0
    finally:
        save_state(state)
        release_lock()


def main() -> None:
    raise SystemExit(run_once())


if __name__ == "__main__":
    main()
