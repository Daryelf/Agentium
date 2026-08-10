from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
from typer.testing import CliRunner

from stock_guru.cli import app
from stock_guru.broker import BrokerAccountState, BrokerGuardrails, build_auto_order_plan, build_exit_order_plan
from stock_guru.config import Settings, TRADING_MODE_INTRADAY
from stock_guru.data import MarketData
from stock_guru.evaluator import IndicatorSnapshot, QuoteSnapshot
from stock_guru.intraday import (
    AUTO_ORDER_READY,
    INTRADAY_EXIT,
    INTRADAY_REJECT,
    IntradayMarketContext,
    evaluate_intraday_entry,
    evaluate_intraday_exit,
)
from stock_guru.lifecycle import BrokerReview, DailyRiskState, LivePositionPlan


def settings() -> Settings:
    return Settings(
        default_budget=25,
        max_positions=5,
        max_position_pct=1.0,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.08,
        min_price=5,
        min_dollar_volume=1_000_000,
        market_timezone="America/New_York",
        regular_market_open="09:30",
        regular_market_close="16:00",
    )


def indicator(**overrides) -> IndicatorSnapshot:
    values = {
        "ticker": "TEST",
        "current_price": 100.0,
        "previous_close": 99.0,
        "daily_high": 101.0,
        "daily_low": 98.0,
        "volume": 2_000_000,
        "average_volume": 1_000_000,
        "relative_volume": 2.0,
        "dollar_volume": 100_000_000,
        "vwap": 99.0,
        "ema9": 99.0,
        "ema20": 98.0,
        "sma50": 95.0,
        "sma200": 90.0,
        "rsi": 60.0,
        "macd": 1.0,
        "macd_signal": 0.5,
        "atr": 2.0,
        "support": 96.0,
        "resistance": 104.0,
        "swing_high": 104.0,
        "swing_low": 96.0,
        "percent_change_today": 0.01,
        "gap_percent": 0.0,
        "trend_direction": "uptrend",
        "data_fresh": True,
    }
    values.update(overrides)
    return IndicatorSnapshot(**values)


def context(hour: int = 10, minute: int = 30, **overrides) -> IntradayMarketContext:
    values = {
        "now": datetime(2026, 6, 8, hour, minute, tzinfo=ZoneInfo("America/New_York")),
        "market_condition": "strong bullish trend",
        "spy_aligned": True,
        "qqq_aligned": True,
        "sector_aligned": True,
        "news_verified": True,
    }
    values.update(overrides)
    return IntradayMarketContext(**values)


def quote(**overrides) -> QuoteSnapshot:
    values = {"ticker": "TEST", "bid": 99.99, "ask": 100.01, "last": 100.0, "data_fresh": True}
    values.update(overrides)
    return QuoteSnapshot(**values)


def test_trading_mode_defaults_to_intraday_same_day() -> None:
    assert settings().trading_mode == TRADING_MODE_INTRADAY


def test_intraday_entry_rejects_missing_quote_and_explains_why() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=None,
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
        account_value=25,
    )

    assert intent.status == INTRADAY_REJECT
    assert "quote data is missing or stale" in intent.rejection_reasons
    assert "bid-ask spread is unsafe" in intent.rejection_reasons


def test_intraday_entry_90_plus_creates_auto_order_plan_after_broker_review() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=quote(),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
        account_value=25,
    )
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25)
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        intent,
        settings=settings(),
        guardrails=BrokerGuardrails.from_settings(settings()),
        account=account,
        broker_review=review,
    )

    assert intent.status == AUTO_ORDER_READY or intent.confidence_score >= settings().intraday_large_size_score
    assert order.status == "READY_TO_PLACE"
    assert order.dollar_amount == 25


def test_affordable_entry_prefers_marketable_limit_order() -> None:
    intent = evaluate_intraday_entry(
        indicator(current_price=10, vwap=9, ema9=9.5, ema20=9, sma50=8, sma200=7, support=9, resistance=10.05, swing_high=10.05, swing_low=9),
        settings(),
        quote=quote(last=10, bid=9.99, ask=10.01),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
        account_value=25,
    )
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25)
    review = BrokerReview(passed=True, quote_last=10, bid=9.99, ask=10.01)

    order = build_auto_order_plan(
        replace(intent, status=AUTO_ORDER_READY, rejection_reasons=[]),
        settings=settings(),
        guardrails=BrokerGuardrails.from_settings(settings()),
        account=account,
        broker_review=review,
    )

    assert order.order_type == "limit"
    assert order.quantity == 2
    assert order.dollar_amount == 0


def test_symbol_exposure_cap_limits_entry_notional() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=quote(),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
        account_value=25,
    )
    capped_settings = replace(settings(), max_symbol_exposure_pct=0.4)
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25)
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        replace(intent, status=AUTO_ORDER_READY, rejection_reasons=[]),
        settings=capped_settings,
        guardrails=BrokerGuardrails.from_settings(capped_settings),
        account=account,
        broker_review=review,
    )

    assert order.status == "READY_TO_PLACE"
    assert order.dollar_amount == 10


def test_existing_symbol_exposure_reduces_entry_capacity() -> None:
    intent = replace(
        evaluate_intraday_entry(
            indicator(),
            settings(),
            quote=quote(),
            context=context(),
            daily_risk=DailyRiskState(date="2026-06-08"),
            account_value=25,
        ),
        status=AUTO_ORDER_READY,
        rejection_reasons=[],
    )
    capped_settings = replace(settings(), max_symbol_exposure_pct=0.8)
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25)
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        intent,
        settings=capped_settings,
        guardrails=BrokerGuardrails.from_settings(capped_settings),
        account=account,
        broker_review=review,
        existing_symbol_exposure=15,
    )

    assert order.status == "READY_TO_PLACE"
    assert order.dollar_amount == 5


def test_existing_symbol_exposure_at_cap_rejects_entry() -> None:
    intent = replace(
        evaluate_intraday_entry(
            indicator(),
            settings(),
            quote=quote(),
            context=context(),
            daily_risk=DailyRiskState(date="2026-06-08"),
            account_value=25,
        ),
        status=AUTO_ORDER_READY,
        rejection_reasons=[],
    )
    capped_settings = replace(settings(), max_symbol_exposure_pct=0.8)
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25)
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        intent,
        settings=capped_settings,
        guardrails=BrokerGuardrails.from_settings(capped_settings),
        account=account,
        broker_review=review,
        existing_symbol_exposure=20,
    )

    assert order.status == "REJECTED"
    assert "symbol exposure cap reached" in order.rejection_reasons


def test_broker_warnings_force_order_rejection() -> None:
    intent = replace(
        evaluate_intraday_entry(
            indicator(),
            settings(),
            quote=quote(),
            context=context(),
            daily_risk=DailyRiskState(date="2026-06-08"),
            account_value=25,
        ),
        status=AUTO_ORDER_READY,
    )
    account = BrokerAccountState(account_number="A123", account_value=25, cash=25, buying_power=25, warnings=["PDT warning"])
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        intent,
        settings=settings(),
        guardrails=BrokerGuardrails.from_settings(settings()),
        account=account,
        broker_review=review,
    )

    assert order.status == "REJECTED"
    assert any("broker warnings" in reason for reason in order.rejection_reasons)


def test_buy_order_rejects_no_buying_power_and_open_orders() -> None:
    intent = replace(
        evaluate_intraday_entry(
            indicator(),
            settings(),
            quote=quote(),
            context=context(),
            daily_risk=DailyRiskState(date="2026-06-08"),
            account_value=25,
        ),
        status=AUTO_ORDER_READY,
        rejection_reasons=[],
    )
    account = BrokerAccountState(
        account_number="A123",
        account_value=25,
        cash=0,
        buying_power=0,
        open_orders=1,
    )
    review = BrokerReview(passed=True, quote_last=100, bid=99.99, ask=100.01)

    order = build_auto_order_plan(
        intent,
        settings=settings(),
        guardrails=BrokerGuardrails.from_settings(settings()),
        account=account,
        broker_review=review,
    )

    assert order.status == "REJECTED"
    assert "buying power unavailable" in order.rejection_reasons
    assert "open broker orders already exist" in order.rejection_reasons


def test_exit_order_allows_zero_buying_power_and_open_orders() -> None:
    position = LivePositionPlan(
        symbol="TEST",
        shares=0.25,
        average_cost=100,
        stop_price=98,
        target_1=104,
        target_2=108,
        profit_lock_price=102,
        thesis="intraday test",
        opened_at="2026-06-08T10:00:00-04:00",
        force_exit_after="2026-06-08T15:45:00-04:00",
    )
    decision = evaluate_intraday_exit(
        position,
        indicator(current_price=97, vwap=99),
        settings(),
        quote=quote(last=97, bid=96.99, ask=97.01),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
    )
    account = BrokerAccountState(
        account_number="A123",
        account_value=25,
        cash=0,
        buying_power=0,
        open_orders=1,
    )
    review = BrokerReview(passed=True, quote_last=97, bid=96.99, ask=97.01)

    order = build_exit_order_plan(decision, account=account, broker_review=review)

    assert decision.action == INTRADAY_EXIT
    assert order.status == "READY_TO_PLACE"
    assert "buying power unavailable" not in order.rejection_reasons
    assert "open broker orders already exist" not in order.rejection_reasons


def test_exit_order_still_rejects_account_restrictions() -> None:
    position = LivePositionPlan(
        symbol="TEST",
        shares=0.25,
        average_cost=100,
        stop_price=98,
        target_1=104,
        target_2=108,
        profit_lock_price=102,
        thesis="intraday test",
        opened_at="2026-06-08T10:00:00-04:00",
        force_exit_after="2026-06-08T15:45:00-04:00",
    )
    decision = evaluate_intraday_exit(
        position,
        indicator(current_price=97, vwap=99),
        settings(),
        quote=quote(last=97, bid=96.99, ask=97.01),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08"),
    )
    account = BrokerAccountState(
        account_number="A123",
        account_value=25,
        cash=0,
        buying_power=0,
        restrictions=["account frozen"],
    )
    review = BrokerReview(passed=True, quote_last=97, bid=96.99, ask=97.01)

    order = build_exit_order_plan(decision, account=account, broker_review=review)

    assert order.status == "REJECTED"
    assert "account restrictions present: account frozen" in order.rejection_reasons


def test_no_new_entries_after_cutoff() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=quote(),
        context=context(hour=15, minute=20),
        daily_risk=DailyRiskState(date="2026-06-08"),
        account_value=25,
    )

    assert intent.status == INTRADAY_REJECT
    assert "new entries are blocked after intraday cutoff" in intent.rejection_reasons


def test_daily_loss_limit_blocks_new_trades() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=quote(),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08", realized_pnl=-1.0),
        account_value=25,
    )

    assert intent.status == INTRADAY_REJECT
    assert "daily loss limit reached" in intent.rejection_reasons


def test_unrealized_daily_loss_limit_blocks_new_trades() -> None:
    intent = evaluate_intraday_entry(
        indicator(),
        settings(),
        quote=quote(),
        context=context(),
        daily_risk=DailyRiskState(date="2026-06-08", unrealized_pnl=-1.0),
        account_value=25,
    )

    assert intent.status == INTRADAY_REJECT
    assert "daily loss limit reached" in intent.rejection_reasons


def test_force_exit_triggers_near_market_close() -> None:
    position = LivePositionPlan(
        symbol="TEST",
        shares=0.25,
        average_cost=100,
        stop_price=96,
        target_1=104,
        target_2=108,
        profit_lock_price=102,
        thesis="intraday test",
        opened_at="2026-06-08T10:00:00-04:00",
        force_exit_after="2026-06-08T15:45:00-04:00",
    )

    decision = evaluate_intraday_exit(
        position,
        indicator(current_price=101),
        settings(),
        quote=quote(last=101, bid=100.99, ask=101.01),
        context=context(hour=15, minute=46),
        daily_risk=DailyRiskState(date="2026-06-08"),
    )

    assert decision.action == INTRADAY_EXIT
    assert decision.reason == "end-of-day close rule"


def intraday_frame() -> MarketData:
    tickers = ["TEST", "SPY", "QQQ", "^VIX"]
    dates = pd.date_range(end=pd.Timestamp("2026-06-08 10:30", tz="UTC"), periods=60, freq="min")
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], tickers])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for ticker in tickers:
        if ticker == "^VIX":
            close = pd.Series([15.0] * len(dates), index=dates)
        else:
            close = pd.Series([100 + idx * 0.2 for idx in range(len(dates))], index=dates)
        frame[("Open", ticker)] = close - 0.05
        frame[("High", ticker)] = close + 0.1
        frame[("Low", ticker)] = close - 0.1
        frame[("Close", ticker)] = close
        frame[("Volume", ticker)] = 2_000_000
    return MarketData(tickers, frame)


def test_intraday_cli_writes_lifecycle_state(monkeypatch, tmp_path) -> None:
    quotes_path = tmp_path / "quotes.json"
    quotes_path.write_text(
        """
{
  "TEST": {"last": 111.8, "bid": 111.79, "ask": 111.81, "data_fresh": true}
}
""".strip()
        + "\n"
    )
    state_path = tmp_path / "lifecycle.json"
    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: intraday_frame())
    monkeypatch.setattr("stock_guru.cli.save_lifecycle_state", lambda state, path=state_path: state_path)

    result = CliRunner().invoke(
        app,
        [
            "intraday-evaluate",
            "--tickers",
            "TEST",
            "--quotes-json",
            str(quotes_path),
            "--account-number",
            "A123",
            "--dry-run",
        ],
    )

    assert result.exit_code == 0
    assert "Intraday Same-Day Engine" in result.output
    assert "TEST" in result.output
