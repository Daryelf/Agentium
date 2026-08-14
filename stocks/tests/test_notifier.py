from __future__ import annotations

from stock_guru.bot import BotDecision, BotSnapshot, BotState
from stock_guru.copilot import build_trade_ticket
from stock_guru.evaluator import TradeEvaluation
from stock_guru.notifier import (
    TelegramConfig,
    TelegramConfigError,
    TelegramUpdate,
    create_telegram_approval_request,
    format_evaluation_update,
    format_manual_notification,
    format_market_status_update,
    format_telegram_approval_request,
    format_ticket_update,
    normalize_approval_response,
    poll_telegram_approval,
    should_send_update,
)


def snapshot() -> BotSnapshot:
    return BotSnapshot(
        state=BotState(starting_cash=20, cash=20, positions={}),
        equity=20,
        unrealized_pnl=0,
        decision=BotDecision("BUY", "AAPL", "paper bot entry score 80.0", shares=0.025, price=200, notional=5),
        candidates=[],
    )


def test_telegram_config_requires_token_and_chat_id() -> None:
    try:
        TelegramConfig.from_env({})
    except TelegramConfigError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected missing config error")

    assert "STOCK_GURU_TELEGRAM_BOT_TOKEN" in message
    assert "STOCK_GURU_TELEGRAM_CHAT_ID" in message


def test_telegram_config_loads_from_env_mapping() -> None:
    config = TelegramConfig.from_env(
        {
            "STOCK_GURU_TELEGRAM_BOT_TOKEN": "token",
            "STOCK_GURU_TELEGRAM_CHAT_ID": "12345",
        }
    )

    assert config.bot_token == "token"
    assert config.chat_id == "12345"


def test_ticket_update_uses_expected_status_sections() -> None:
    bot_snapshot = snapshot()
    ticket = build_trade_ticket(bot_snapshot, stop_loss_pct=0.02, take_profit_pct=0.03)

    message = format_ticket_update(ticket, bot_snapshot, market_state="open", robinhood_context="MSFT visible; account restricted.")

    assert "Money Maker Update: Market open" in message
    assert "Signal: BUY AAPL" in message
    assert "Robinhood Context: MSFT visible; account restricted." in message
    assert "Action: Review Robinhood manually" in message
    assert "Refresh:" in message


def test_manual_notification_includes_robinhood_guardrails() -> None:
    message = format_manual_notification(
        "Robinhood action review ready",
        ["Account: Agentic", "Action: review_equity_order BUY AAPL $5"],
    )

    assert "Money Maker Update: Robinhood action review ready." in message
    assert "Bot Details: Account: Agentic | Action: review_equity_order BUY AAPL $5" in message
    assert "Robinhood Guardrail: Agentic account only" in message
    assert "No real Robinhood order or cancellation has been placed" in message


def test_manual_notification_can_omit_robinhood_guardrails() -> None:
    message = format_manual_notification("Goal reached", ["Portfolio crossed $21"], robinhood_guard=False)

    assert "Money Maker Update: Goal reached." in message
    assert "Bot Details: Portfolio crossed $21" in message
    assert "Robinhood Guardrail" not in message


def test_market_status_update_uses_money_maker_dots() -> None:
    open_message = format_market_status_update(is_open=True)
    closed_message = format_market_status_update(is_open=False)

    assert "Money Maker Update: 🟢 Money Maker Active." in open_message
    assert "Market open" in open_message
    assert "Money Maker Update: 🔴 Money Maker Out." in closed_message
    assert "Market closed" in closed_message


def evaluation(decision: str = "VALID_BUY_SETUP") -> TradeEvaluation:
    return TradeEvaluation(
        ticker="NVDA",
        decision=decision,
        setup_type="Trend Continuation",
        score=82,
        confidence="medium",
        current_price=100.0,
        entry_zone="99.50-100.50",
        stop_loss=98.0,
        target_1=104.0,
        target_2=106.0,
        risk_reward="1:2.0",
        market_condition="strong bullish trend",
        volume_confirmation=True,
        trend_confirmation=True,
        liquidity_passed=True,
        spread_passed=True,
        data_fresh=True,
        hard_rejection_triggered=False,
        rejection_reason="",
        main_reason_valid="trend and volume aligned",
        main_risk="setup fails below support",
        invalidation_rule="Invalid below 98.0.",
    )


def test_evaluation_update_hides_engine_decision_label() -> None:
    buy_message = format_evaluation_update(evaluation(), principal_dollars=25, buy_amount=10)
    sell_message = format_evaluation_update(evaluation("VALID_SELL_SIGNAL"), principal_dollars=25, buy_amount=10)

    assert "Money Maker Update: NVDA Buy Alert." in buy_message
    assert "VALID_BUY_SETUP" not in buy_message
    assert "Money Maker Update: NVDA Sell Alert." in sell_message
    assert "VALID_SELL_SIGNAL" not in sell_message


def test_should_send_update_suppresses_unchanged_ticket(tmp_path) -> None:
    bot_snapshot = snapshot()
    ticket = build_trade_ticket(bot_snapshot, stop_loss_pct=0.02, take_profit_pct=0.03)
    path = tmp_path / "last.json"

    first_send, signature = should_send_update(ticket, bot_snapshot, market_state="open", path=path)
    assert first_send is True
    path.write_text(__import__("json").dumps(signature))

    second_send, _ = should_send_update(ticket, bot_snapshot, market_state="open", path=path)
    assert second_send is False

    forced_send, _ = should_send_update(ticket, bot_snapshot, market_state="open", path=path, always=True)
    assert forced_send is True


def test_normalize_approval_response_accepts_simple_yes_no() -> None:
    assert normalize_approval_response("YES") == "approved"
    assert normalize_approval_response("y") == "approved"
    assert normalize_approval_response("NO") == "rejected"
    assert normalize_approval_response("n") == "rejected"
    assert normalize_approval_response("buy it") is None


def test_telegram_approval_request_message_uses_yes_no(tmp_path) -> None:
    request = create_telegram_approval_request(
        action="BUY",
        symbol="BAC",
        dollar_amount=25,
        details=["Broker review passed"],
        stop_price=52.61,
        take_profit_price=55.29,
        path=tmp_path / "approval.json",
    )

    message = format_telegram_approval_request(request)

    assert "Buy Alert" in message
    assert "BUY BAC $25.00" in message
    assert "Trade Plan: stop $52.61; target $55.29." in message
    assert "Reply YES to approve or NO to reject" in message


def test_poll_telegram_approval_accepts_configured_chat(monkeypatch, tmp_path) -> None:
    path = tmp_path / "approval.json"
    create_telegram_approval_request(action="BUY", symbol="BAC", dollar_amount=25, path=path)

    def fake_updates(**kwargs):
        return [TelegramUpdate(update_id=100, chat_id="12345", text="YES")]

    monkeypatch.setattr("stock_guru.notifier.get_telegram_updates", fake_updates)
    config = TelegramConfig(bot_token="token", chat_id="12345")

    state = poll_telegram_approval(config=config, path=path)

    pending = state["pending"]
    assert pending["status"] == "approved"
    assert pending["response"] == "YES"
    assert pending["source_update_id"] == 100


def test_poll_telegram_approval_ignores_other_chat(monkeypatch, tmp_path) -> None:
    path = tmp_path / "approval.json"
    create_telegram_approval_request(action="BUY", symbol="BAC", dollar_amount=25, path=path)

    def fake_updates(**kwargs):
        return [TelegramUpdate(update_id=100, chat_id="99999", text="YES")]

    monkeypatch.setattr("stock_guru.notifier.get_telegram_updates", fake_updates)
    config = TelegramConfig(bot_token="token", chat_id="12345")

    state = poll_telegram_approval(config=config, path=path)

    pending = state["pending"]
    assert pending["status"] == "pending"
    assert state["last_update_id"] == 100
