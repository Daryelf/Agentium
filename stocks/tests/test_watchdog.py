from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from stock_guru.research import NewsHeadline
from stock_guru.watchdog import (
    CycleSummary,
    LiveHolding,
    format_status_heartbeat,
    held_position_plan,
    latest_executed_holding,
    update_holding_peak_profit,
)


def evaluation() -> dict[str, object]:
    return {
        "ticker": "BAC",
        "decision": "VALID_BUY_SETUP",
        "score": 75,
        "current_price": 53.68,
        "stop_loss": 49.1316,
        "target_1": 62.8518,
        "target_2": 67.4251,
        "volume_confirmation": False,
        "trend_confirmation": True,
        "main_reason_valid": "Trend Continuation with trend/volume/risk structure aligned",
        "main_risk": "volume has not confirmed the move",
    }


def test_latest_executed_holding_reads_filled_buy(tmp_path) -> None:
    path = tmp_path / "approval.json"
    path.write_text(
        json.dumps(
            {
                "pending": {
                    "action": "BUY",
                    "status": "executed",
                    "symbol": "BAC",
                    "dollar_amount": 25.0,
                    "details": ["Filled: 0.465722 BAC at average price $53.680", "Stop: $52.61", "Target: $55.29"],
                }
            }
        )
    )

    holding = latest_executed_holding(path)

    assert holding == LiveHolding(
        symbol="BAC",
        shares=0.465722,
        average_price=53.68,
        notional=25.0,
        stop_price=52.61,
        take_profit_price=55.29,
    )


def test_status_heartbeat_explains_what_held_position_is_waiting_for() -> None:
    now = datetime(2026, 6, 5, 13, 50, tzinfo=ZoneInfo("America/New_York"))
    summary = CycleSummary(total=80, rows=[evaluation()], buys=[evaluation()], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)

    message = format_status_heartbeat(summary, holding, now)

    assert "Money Maker Status: Hold check" in message
    assert "Position: 0.465722 sh / $25.00" in message
    assert "BAC price $53.68" in message
    assert "Plan: stop $52.61" in message
    assert "Waiting For: price to keep holding up and volume to confirm the move." in message
    assert "Action: No order placed by watchdog" in message


def test_status_heartbeat_escalates_when_planned_stop_is_crossed() -> None:
    now = datetime(2026, 6, 5, 13, 50, tzinfo=ZoneInfo("America/New_York"))
    row = evaluation()
    row["current_price"] = 52.50
    summary = CycleSummary(total=80, rows=[row], buys=[], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)

    message = format_status_heartbeat(summary, holding, now)
    plan = held_position_plan(holding, row)

    assert plan.stop_active is True
    assert "Waiting For: nothing; planned stop is crossed and sell review is active." in message
    assert "review SELL now" in message


def test_status_heartbeat_escalates_when_any_profit_is_available() -> None:
    now = datetime(2026, 6, 5, 13, 50, tzinfo=ZoneInfo("America/New_York"))
    row = evaluation()
    row["current_price"] = 53.71
    summary = CycleSummary(total=80, rows=[row], buys=[row], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)

    message = format_status_heartbeat(summary, holding, now)
    plan = held_position_plan(holding, row)

    assert plan.profit_capture_active is True
    assert "Peak P/L: $0.01 max" in message
    assert "position is profitable" in message
    assert "review SELL now because the position is profitable" in message


def test_status_heartbeat_escalates_when_peak_profit_gives_back() -> None:
    now = datetime(2026, 6, 5, 13, 52, tzinfo=ZoneInfo("America/New_York"))
    row = evaluation()
    row["current_price"] = 54.07
    summary = CycleSummary(total=80, rows=[row], buys=[row], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)

    message = format_status_heartbeat(summary, holding, now, peak_pnl_dollars=0.30)
    plan = held_position_plan(holding, row, peak_pnl_dollars=0.30)

    assert plan.profit_capture_active is True
    assert plan.profit_giveback_active is True
    assert "Peak P/L: $0.30 max; giveback $0.12" in message
    assert "peak profit is giving back" in message
    assert "review SELL now because peak profit is giving back" in message


def test_status_heartbeat_includes_same_day_news_context() -> None:
    now = datetime(2026, 6, 9, 13, 52, tzinfo=ZoneInfo("America/New_York"))
    row = evaluation()
    summary = CycleSummary(total=80, rows=[row], buys=[row], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)
    news = [
        NewsHeadline(
            title="Bank of America says trading revenue could beat forecast",
            publisher="Reuters",
            published_at=datetime(2026, 6, 9, 12, 30, tzinfo=ZoneInfo("America/New_York")),
        )
    ]

    message = format_status_heartbeat(summary, holding, now, news_items=news)

    assert "Today's BAC news:" in message
    assert "Bank of America says trading revenue could beat forecast" in message
    assert "(Reuters) 12:30 EDT" in message


def test_update_holding_peak_profit_tracks_best_unrealized_profit() -> None:
    now = datetime(2026, 6, 5, 13, 50, tzinfo=ZoneInfo("America/New_York"))
    row = evaluation()
    row["current_price"] = 54.25
    summary = CycleSummary(total=80, rows=[row], buys=[row], sells=[], rejects=75)
    holding = LiveHolding(symbol="BAC", shares=0.465722, average_price=53.68, notional=25.0)
    state: dict[str, object] = {}

    first_peak = update_holding_peak_profit(state, holding, summary, now)
    row["current_price"] = 54.00
    second_peak = update_holding_peak_profit(state, holding, summary, now)

    assert first_peak == second_peak
    assert state["held_profit_peaks"]["BAC"]["peak_pnl_dollars"] == round(first_peak, 4)
    assert state["held_profit_peaks"]["BAC"]["current_pnl_dollars"] < state["held_profit_peaks"]["BAC"]["peak_pnl_dollars"]
