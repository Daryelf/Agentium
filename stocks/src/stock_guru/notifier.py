from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Mapping

from .bot import BotSnapshot
from .config import DATA_DIR
from .copilot import TradeTicket
from .evaluator import (
    HELD_PROFIT_TARGET_PCT,
    HELD_STOP_LOSS_PCT,
    TradeEvaluation,
    VALID_BUY_SETUP,
    VALID_SELL_SIGNAL,
)


LAST_TELEGRAM_STATUS_PATH = DATA_DIR / "telegram_last_status.json"
TELEGRAM_APPROVAL_STATE_PATH = DATA_DIR / "telegram_approval_state.json"
TELEGRAM_TOKEN_ENV = "STOCK_GURU_TELEGRAM_BOT_TOKEN"
TELEGRAM_CHAT_ID_ENV = "STOCK_GURU_TELEGRAM_CHAT_ID"


class TelegramConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class TelegramConfig:
    bot_token: str
    chat_id: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "TelegramConfig":
        values = os.environ if env is None else env
        bot_token = values.get(TELEGRAM_TOKEN_ENV, "").strip()
        chat_id = values.get(TELEGRAM_CHAT_ID_ENV, "").strip()
        missing = []
        if not bot_token:
            missing.append(TELEGRAM_TOKEN_ENV)
        if not chat_id:
            missing.append(TELEGRAM_CHAT_ID_ENV)
        if missing:
            raise TelegramConfigError(f"missing Telegram setting(s): {', '.join(missing)}")
        return cls(bot_token=bot_token, chat_id=chat_id)


@dataclass(frozen=True)
class TelegramUpdate:
    update_id: int
    chat_id: str
    text: str


def format_money(value: float) -> str:
    return f"${value:,.2f}"


def format_manual_notification(
    title: str,
    lines: list[str] | None = None,
    *,
    robinhood_guard: bool = True,
    guardrail_summary: str | None = None,
) -> str:
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("notification title is required")

    clean_lines = [line.strip() for line in lines or [] if line.strip()]
    message = [f"Money Maker Update: {clean_title}."]
    if clean_lines:
        message.append("Bot Details: " + " | ".join(clean_lines))
    if robinhood_guard:
        summary = guardrail_summary or "Agentic account only; long equities only; $25 principal bankroll; profits above principal locked."
        message.extend(
            [
                f"Robinhood Guardrail: {summary}",
                "Action: No real Robinhood order or cancellation has been placed. Awaiting explicit approval.",
            ]
        )
    return "\n".join(message)


def format_market_status_update(*, is_open: bool) -> str:
    if is_open:
        return "\n".join(
            [
                "Money Maker Update: 🟢 Money Maker Active.",
                "Bot Details: Market open | Watching for buy/sell setups",
            ]
        )
    return "\n".join(
        [
            "Money Maker Update: 🔴 Money Maker Out.",
            "Bot Details: Market closed | No new buy/sell alerts",
        ]
    )


def format_ticket_update(
    ticket: TradeTicket,
    snapshot: BotSnapshot,
    *,
    market_state: str,
    robinhood_context: str = "Not checked by the local bot. Use the Codex Chrome automation for visible Robinhood context.",
) -> str:
    ticker = ticket.ticker or "N/A"
    signal = f"{ticket.action} {ticker}; {ticket.reason}"
    if ticket.shares > 0:
        signal += f"; {ticket.shares:.6f} sh @ {format_money(ticket.estimated_price)}"
    if ticket.notional > 0:
        signal += f"; ticket {format_money(ticket.notional)}"

    if ticket.action in {"BUY", "SELL"}:
        manual_action = "Review Robinhood manually and click only if you approve. No real order was placed."
    else:
        manual_action = "No real Robinhood action to take from this check. No order was placed."

    expires = ticket.expires_at.isoformat(timespec="seconds") if ticket.expires_at else "N/A"
    generated = ticket.generated_at.isoformat(timespec="seconds") if ticket.generated_at else "N/A"

    return "\n".join(
        [
            f"Money Maker Update: Market {market_state}.",
            f"Bot Details: equity {format_money(snapshot.equity)}; cash {format_money(snapshot.state.cash)}; unrealized P/L {format_money(snapshot.unrealized_pnl)}.",
            f"Signal: {signal}.",
            f"Robinhood Context: {robinhood_context}",
            f"Action: {manual_action}",
            f"Refresh: Generated {generated}; refresh after {expires}.",
        ]
    )


def format_evaluation_update(
    evaluation: TradeEvaluation,
    *,
    principal_dollars: float = 25.0,
    buy_amount: float | None = None,
) -> str:
    amount = principal_dollars if buy_amount is None else min(buy_amount, principal_dollars)
    title = f"{evaluation.ticker} Buy Alert" if evaluation.decision == VALID_BUY_SETUP else f"{evaluation.ticker} Sell Alert"
    lines = [
        f"Setup: {evaluation.setup_type}",
        f"Score: {evaluation.score}/{evaluation.confidence}",
        f"Price: {format_money(evaluation.current_price)}",
    ]
    if evaluation.decision == VALID_BUY_SETUP and evaluation.current_price > 0:
        shares = amount / evaluation.current_price
        effective_stop = max(evaluation.stop_loss, evaluation.current_price * (1 - HELD_STOP_LOSS_PCT))
        tactical_target = min(evaluation.target_1, evaluation.current_price * (1 + HELD_PROFIT_TARGET_PCT))
        risk_per_share = max(0.0, evaluation.current_price - effective_stop)
        risk_dollars = risk_per_share * shares
        risk_pct = risk_dollars / principal_dollars * 100 if principal_dollars > 0 else 0.0
        lines.extend(
            [
                f"Buy: {format_money(amount)} / {shares:.6f} shares",
                f"Risk: {format_money(risk_dollars)} / {risk_pct:.1f}% bankroll",
                f"Stop: {format_money(effective_stop)}",
                f"Target: {format_money(tactical_target)}",
            ]
        )
    if evaluation.decision == VALID_SELL_SIGNAL:
        lines.append("Sell: exit signal active")
    if evaluation.decision != VALID_BUY_SETUP:
        lines.append(f"Stop: {format_money(evaluation.stop_loss)}")
    lines.extend(
        [
            f"Scan targets: {format_money(evaluation.target_1)} / {format_money(evaluation.target_2)}",
            f"Reason: {evaluation.main_reason_valid or evaluation.rejection_reason}",
            f"Risk note: {evaluation.main_risk}",
        ]
    )
    return format_manual_notification(
        title,
        lines,
        robinhood_guard=False,
    )


def ticket_signature(ticket: TradeTicket, snapshot: BotSnapshot, *, market_state: str) -> dict[str, object]:
    return {
        "market_state": market_state,
        "action": ticket.action,
        "ticker": ticket.ticker,
        "reason": ticket.reason,
        "shares": round(ticket.shares, 8),
        "estimated_price": round(ticket.estimated_price, 4),
        "notional": round(ticket.notional, 2),
        "cash_now": round(ticket.cash_now, 2),
        "equity": round(snapshot.equity, 2),
        "unrealized_pnl": round(snapshot.unrealized_pnl, 2),
        "stop_price": round(ticket.stop_price, 4) if ticket.stop_price is not None else None,
        "take_profit_price": round(ticket.take_profit_price, 4) if ticket.take_profit_price is not None else None,
    }


def load_last_signature(path: Path = LAST_TELEGRAM_STATUS_PATH) -> dict[str, object] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_last_signature(signature: dict[str, object], path: Path = LAST_TELEGRAM_STATUS_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(signature, indent=2, sort_keys=True) + "\n")
    return path


def should_send_update(
    ticket: TradeTicket,
    snapshot: BotSnapshot,
    *,
    market_state: str,
    always: bool = False,
    path: Path = LAST_TELEGRAM_STATUS_PATH,
) -> tuple[bool, dict[str, object]]:
    signature = ticket_signature(ticket, snapshot, market_state=market_state)
    if always:
        return True, signature
    return signature != load_last_signature(path), signature


def telegram_api_request(
    method: str,
    payload: dict[str, object],
    config: TelegramConfig | None = None,
    *,
    timeout: float = 10.0,
) -> dict[str, object]:
    telegram = config or TelegramConfig.from_env()
    encoded_payload = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{telegram.bot_token}/{method}",
        data=encoded_payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Telegram {method} failed: {exc}") from exc

    result = json.loads(body)
    if not result.get("ok"):
        raise RuntimeError(f"Telegram {method} failed")
    return result


def send_telegram_message(message: str, config: TelegramConfig | None = None, *, timeout: float = 10.0) -> dict[str, object]:
    telegram = config or TelegramConfig.from_env()
    return telegram_api_request(
        "sendMessage",
        {
            "chat_id": telegram.chat_id,
            "text": message,
            "disable_web_page_preview": True,
        },
        config=telegram,
        timeout=timeout,
    )


def get_telegram_updates(
    *,
    offset: int | None = None,
    poll_timeout: int = 0,
    config: TelegramConfig | None = None,
    timeout: float = 10.0,
) -> list[TelegramUpdate]:
    payload: dict[str, object] = {"timeout": poll_timeout, "allowed_updates": ["message"]}
    if offset is not None:
        payload["offset"] = offset
    result = telegram_api_request("getUpdates", payload, config=config, timeout=timeout)
    updates: list[TelegramUpdate] = []
    for item in result.get("result", []):
        if not isinstance(item, dict):
            continue
        message = item.get("message")
        if not isinstance(message, dict):
            continue
        text = message.get("text")
        chat = message.get("chat")
        if not isinstance(text, str) or not isinstance(chat, dict):
            continue
        chat_id = chat.get("id")
        update_id = item.get("update_id")
        if chat_id is None or not isinstance(update_id, int):
            continue
        updates.append(TelegramUpdate(update_id=update_id, chat_id=str(chat_id), text=text.strip()))
    return updates


def load_telegram_approval_state(path: Path = TELEGRAM_APPROVAL_STATE_PATH) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def save_telegram_approval_state(state: dict[str, object], path: Path = TELEGRAM_APPROVAL_STATE_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    return path


def normalize_approval_response(text: str) -> str | None:
    normalized = text.strip().lower()
    if normalized in {"yes", "y"}:
        return "approved"
    if normalized in {"no", "n"}:
        return "rejected"
    return None


def create_telegram_approval_request(
    *,
    action: str,
    symbol: str,
    dollar_amount: float,
    details: list[str] | None = None,
    stop_price: float | None = None,
    take_profit_price: float | None = None,
    replace: bool = False,
    path: Path = TELEGRAM_APPROVAL_STATE_PATH,
) -> dict[str, object]:
    clean_action = action.strip().upper()
    clean_symbol = symbol.strip().upper()
    if clean_action not in {"BUY", "SELL"}:
        raise ValueError("approval action must be BUY or SELL")
    if not clean_symbol:
        raise ValueError("approval symbol is required")
    if dollar_amount <= 0:
        raise ValueError("approval dollar amount must be positive")

    state = load_telegram_approval_state(path)
    pending = state.get("pending")
    if isinstance(pending, dict) and pending.get("status") == "pending" and not replace:
        raise RuntimeError(f"pending approval already exists: {pending.get('id', 'unknown')}")

    created_at = datetime.now().astimezone().isoformat(timespec="seconds")
    request_id = f"{clean_action}-{clean_symbol}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    request: dict[str, object] = {
        "id": request_id,
        "action": clean_action,
        "symbol": clean_symbol,
        "dollar_amount": round(float(dollar_amount), 2),
        "details": [item.strip() for item in details or [] if item.strip()],
        "stop_price": round(float(stop_price), 4) if stop_price is not None else None,
        "take_profit_price": round(float(take_profit_price), 4) if take_profit_price is not None else None,
        "status": "pending",
        "created_at": created_at,
        "response": None,
        "responded_at": None,
        "source_update_id": None,
    }
    state["pending"] = request
    save_telegram_approval_state(state, path)
    return request


def format_telegram_approval_request(request: Mapping[str, object]) -> str:
    action = str(request.get("action", "")).upper()
    symbol = str(request.get("symbol", "")).upper()
    amount = float(request.get("dollar_amount", 0) or 0)
    lines = [
        f"Money Maker Update: {action.title()} Alert.",
        f"Bot Details: Review: {action} {symbol} {format_money(amount)} market notional.",
        "Action: Reply YES to approve or NO to reject.",
        "Guardrail: Agentic account only; long equities only; $25 principal cap.",
    ]
    details = request.get("details")
    if isinstance(details, list) and details:
        lines.insert(2, "Review Details: " + " | ".join(str(item) for item in details if str(item).strip()))
    stop_price = request.get("stop_price")
    take_profit_price = request.get("take_profit_price")
    plan_parts = []
    if isinstance(stop_price, (int, float)):
        plan_parts.append(f"stop {format_money(float(stop_price))}")
    if isinstance(take_profit_price, (int, float)):
        plan_parts.append(f"target {format_money(float(take_profit_price))}")
    if plan_parts:
        lines.insert(2, "Trade Plan: " + "; ".join(plan_parts) + ".")
    return "\n".join(lines)


def poll_telegram_approval(
    *,
    config: TelegramConfig | None = None,
    path: Path = TELEGRAM_APPROVAL_STATE_PATH,
    poll_timeout: int = 0,
) -> dict[str, object]:
    telegram = config or TelegramConfig.from_env()
    state = load_telegram_approval_state(path)
    pending = state.get("pending")
    offset_value = state.get("last_update_id")
    offset = int(offset_value) + 1 if isinstance(offset_value, int) else None
    updates = get_telegram_updates(offset=offset, poll_timeout=poll_timeout, config=telegram)

    for update in updates:
        state["last_update_id"] = update.update_id
        if update.chat_id != str(telegram.chat_id):
            continue
        if not isinstance(pending, dict) or pending.get("status") != "pending":
            continue
        response = normalize_approval_response(update.text)
        if response is None:
            continue
        pending["status"] = response
        pending["response"] = update.text.strip().upper()
        pending["responded_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        pending["source_update_id"] = update.update_id
        state["pending"] = pending

    save_telegram_approval_state(state, path)
    return state
