from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
import pandas as pd
from typer.testing import CliRunner

from stock_guru.cli import app
from stock_guru.config import Settings
from stock_guru.data import MarketData, frame_from_chart_payload
from stock_guru.evaluator import (
    REJECT,
    VALID_BUY_SETUP,
    VALID_SELL_SIGNAL,
    WATCH_ONLY,
    IndicatorSnapshot,
    PositionSnapshot,
    QuoteSnapshot,
    build_indicator_snapshot,
    detect_setup,
    evaluate_market_data,
    evaluation_sort_key,
    evaluate_ticker,
    market_condition,
    risk_plan,
    write_evaluations_json,
)
from stock_guru.notifier import format_evaluation_update
from stock_guru.market_data_quality import DataQualityIssue, assess_market_data, build_provenance


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
        "volume": 1_500_000,
        "average_volume": 1_000_000,
        "relative_volume": 1.5,
        "dollar_volume": 100_000_000,
        "vwap": 99.5,
        "ema9": 99.0,
        "ema20": 98.0,
        "sma50": 95.0,
        "sma200": 90.0,
        "rsi": 55.0,
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


def market_frame(tickers: list[str], direction: str = "up", vix_price: float = 15) -> MarketData:
    dates = pd.date_range(end=pd.Timestamp.now().normalize(), periods=260)
    columns = pd.MultiIndex.from_product([["Open", "High", "Low", "Close", "Volume"], tickers])
    frame = pd.DataFrame(index=dates, columns=columns, dtype=float)
    for ticker in tickers:
        if ticker == "^VIX":
            close = pd.Series([vix_price] * len(dates), index=dates)
        elif direction == "down":
            close = pd.Series(range(360, 100, -1), index=dates, dtype=float)
        else:
            close = pd.Series(range(100, 360), index=dates, dtype=float)
        frame[("Close", ticker)] = close
        frame[("Open", ticker)] = close - 0.25
        frame[("High", ticker)] = close + 1
        frame[("Low", ticker)] = close - 1
        frame[("Volume", ticker)] = 2_000_000
    return MarketData(tickers, frame)


def test_detects_each_setup_type() -> None:
    assert detect_setup(indicator(previous_close=98, vwap=99.5), "weak bullish trend") == "VWAP Reclaim"
    assert detect_setup(indicator(current_price=97, previous_close=97, support=96, vwap=90), "weak bullish trend") == "Pullback to Support"
    assert detect_setup(indicator(current_price=104, previous_close=103, resistance=104.5, vwap=90), "weak bullish trend") == "Breakout + Retest"
    assert detect_setup(indicator(current_price=110, previous_close=109, support=90, resistance=130, vwap=100), "weak bullish trend") == "Trend Continuation"
    assert (
        detect_setup(
            indicator(current_price=97, previous_close=97, support=96, vwap=110, trend_direction="downtrend", rsi=35, macd=0.2, macd_signal=0.1),
            "sideways / choppy",
        )
        == "Reversal Near Support"
    )


def test_market_condition_classifies_bullish_and_high_volatility() -> None:
    bullish = market_condition(market_frame(["SPY", "QQQ", "^VIX"], direction="up", vix_price=15))
    dangerous = market_condition(market_frame(["SPY", "QQQ", "^VIX"], direction="up", vix_price=35))

    assert bullish == "strong bullish trend"
    assert dangerous == "high volatility danger"


def test_market_data_quality_is_a_hard_execution_gate() -> None:
    base = market_frame(["AAPL", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)
    at = datetime.now(timezone.utc) + timedelta(days=10)
    quality = assess_market_data(base.history, base.tickers, interval="1d", now=at)
    provenance = build_provenance(
        provider="CACHE",
        history=base.history,
        symbols=base.tickers,
        period="1y",
        interval="1d",
        received_at=at,
        latency_ms=0,
        quality=quality,
    )

    result = evaluate_market_data(MarketData(base.tickers, base.history, provenance, quality), settings(), now=at)
    aapl = next(item for item in result if item.ticker == "AAPL")

    assert aapl.decision == REJECT
    assert aapl.hard_rejection_triggered is True
    assert aapl.data_fresh is False
    assert aapl.data_provider == "CACHE"
    assert aapl.data_health_state == "STALE"
    assert aapl.data_quality_score == quality.score


def test_unrelated_batch_defects_do_not_reject_a_coherent_symbol() -> None:
    base = market_frame(["AAPL", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)
    at = datetime.now(timezone.utc)
    quality = assess_market_data(
        base.history,
        base.tickers,
        interval="1d",
        now=at,
        external_issues=(
            DataQualityIssue("UNRELATED_BAD_FIELD", "critical", "Bad field on another ticker.", symbol="BROKEN"),
            DataQualityIssue("UNRELATED_BAD_VOLUME", "critical", "Bad volume on another ticker.", symbol="BROKEN"),
        ),
    )
    assert quality.is_usable is False
    provenance = build_provenance(
        provider="YFINANCE",
        history=base.history,
        symbols=base.tickers,
        period="1y",
        interval="1d",
        received_at=at,
        latency_ms=10,
        quality=quality,
    )

    result = evaluate_market_data(MarketData(base.tickers, base.history, provenance, quality), settings(), now=at)
    aapl = next(item for item in result if item.ticker == "AAPL")

    assert aapl.data_fresh is True
    assert aapl.data_health_state == "HEALTHY"
    assert aapl.data_quality_score == 100
    assert aapl.rejection_reason != "market data health is offline"


def test_market_evaluator_reports_the_exact_ticker_progress() -> None:
    data = market_frame(["AAPL", "MSFT", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)
    events: list[tuple[str, int, int]] = []

    evaluate_market_data(data, settings(), progress_callback=lambda ticker, completed, total: events.append((ticker, completed, total)))

    assert events[0] == ("AAPL", 0, 2)
    assert events[1] == ("MSFT", 1, 2)
    assert events[-1] == ("MSFT", 2, 2)


def test_hard_rejects_low_liquidity() -> None:
    evaluation = evaluate_ticker(
        indicator(dollar_volume=10_000),
        settings(),
        market="weak bullish trend",
        quote=QuoteSnapshot("TEST", bid=99.9, ask=100.0),
    )

    assert evaluation.decision == REJECT
    assert evaluation.hard_rejection_triggered is True
    assert evaluation.rejection_reason == "volume/liquidity below minimum"


def test_valid_buy_outputs_schema_and_risk_plan() -> None:
    stop, target_1, target_2, ratio = risk_plan(indicator())
    evaluation = evaluate_ticker(indicator(), settings(), market="strong bullish trend")

    assert stop < target_1 < target_2
    assert ratio >= 2
    assert evaluation.decision == VALID_BUY_SETUP
    assert evaluation.to_dict()["ticker"] == "TEST"
    assert evaluation.to_dict()["invalidation_rule"]


def test_held_position_sells_when_profit_target_weakens() -> None:
    evaluation = evaluate_ticker(
        indicator(current_price=103.5, vwap=104.0, rsi=48.0),
        settings(),
        market="weak bullish trend",
        position=PositionSnapshot("TEST", shares=1, average_cost=100),
    )

    assert evaluation.decision == VALID_SELL_SIGNAL
    assert "profit target" in evaluation.main_reason_valid


def test_held_position_without_exit_is_watch_only_not_buy() -> None:
    evaluation = evaluate_ticker(
        indicator(current_price=101.0),
        settings(),
        market="strong bullish trend",
        position=PositionSnapshot("TEST", shares=1, average_cost=100),
    )

    assert evaluation.decision == WATCH_ONLY
    assert evaluation.main_reason_valid == "hold existing position; no exit rule triggered"


def test_sell_signals_sort_before_new_buy_setups() -> None:
    buy = evaluate_ticker(indicator(ticker="AAPL"), settings(), market="strong bullish trend")
    sell = evaluate_ticker(
        indicator(ticker="MSFT", current_price=103.5, vwap=104.0, rsi=48.0),
        settings(),
        market="weak bullish trend",
        position=PositionSnapshot("MSFT", shares=1, average_cost=100),
    )

    assert [item.ticker for item in sorted([buy, sell], key=evaluation_sort_key)] == ["MSFT", "AAPL"]


def test_evaluation_json_report(tmp_path) -> None:
    evaluation = evaluate_ticker(indicator(), settings(), market="strong bullish trend")
    path = write_evaluations_json([evaluation], tmp_path / "evaluations.json")

    assert '"decision": "VALID_BUY_SETUP"' in path.read_text()


def test_telegram_evaluation_summary_is_simple() -> None:
    evaluation = evaluate_ticker(indicator(), settings(), market="strong bullish trend")
    message = format_evaluation_update(evaluation, principal_dollars=25, buy_amount=10)

    assert "Money Maker Update: TEST Buy Alert." in message
    assert "VALID_BUY_SETUP" not in message
    assert "Buy: $10.00" in message
    assert "Risk:" in message
    assert "Robinhood Guardrail" not in message


def test_cli_evaluate_dry_run(monkeypatch, tmp_path) -> None:
    data = market_frame(["AAPL", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)
    progress_path = tmp_path / "argentum-research-progress.json"

    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: data)
    monkeypatch.setenv("STOCK_GURU_PROGRESS_FILE", str(progress_path))
    monkeypatch.setenv("STOCK_GURU_PROGRESS_RUN_ID", "stock-refresh-test")

    result = CliRunner().invoke(app, ["evaluate", "--tickers", "AAPL", "--dry-run"])

    assert result.exit_code == 0
    assert "Trade Evaluator" in result.output
    progress = json.loads(progress_path.read_text())
    assert progress["run_id"] == "stock-refresh-test"
    assert progress["phase"] == "complete"
    assert progress["current_ticker"] == "AAPL"
    assert progress["completed"] == 1
    assert progress["total"] == 1


def test_frame_from_chart_payload_builds_multiindex_frame() -> None:
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1704067200, 1704153600],
                    "indicators": {
                        "quote": [
                            {
                                "open": [100.0, 101.0],
                                "high": [101.0, 102.0],
                                "low": [99.0, 100.0],
                                "close": [100.5, 101.5],
                                "volume": [1_000_000, 1_100_000],
                            }
                        ],
                        "adjclose": [{"adjclose": [100.25, 101.25]}],
                    },
                }
            ]
        }
    }

    frame = frame_from_chart_payload("AAPL", payload)

    assert ("Close", "AAPL") in frame.columns
    assert ("Volume", "AAPL") in frame.columns
    assert frame[("Close", "AAPL")].iloc[-1] == 101.25


def test_cli_evaluate_keeps_last_report_when_market_data_unavailable(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("No market data returned. Check tickers or network access.")))
    monkeypatch.setattr("stock_guru.cli.EVALUATIONS_PATH", tmp_path / "evaluations.json")
    monkeypatch.setattr("stock_guru.evaluator.EVALUATIONS_PATH", tmp_path / "evaluations.json")
    (tmp_path / "evaluations.json").write_text("[]\n")

    result = CliRunner().invoke(app, ["evaluate", "--tickers", "AAPL"])

    assert result.exit_code == 0
    assert "Evaluation skipped: No market data returned. Check tickers or network access." in result.output
    assert "Keeping last evaluations:" in result.output
    assert "evaluations.json" in result.output


def test_cli_evaluate_accepts_quote_overrides(monkeypatch, tmp_path) -> None:
    data = market_frame(["AAPL", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)
    quotes_path = tmp_path / "quotes.json"
    quotes_path.write_text(json.dumps({"AAPL": {"last": 400.0, "bid": 399.5, "ask": 400.5, "data_fresh": True}}))

    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: data)

    result = CliRunner().invoke(app, ["evaluate", "--tickers", "AAPL", "--quotes-json", str(quotes_path), "--dry-run"])

    assert result.exit_code == 0
    assert "$400.00" in result.output


def test_doctor_reports_history_failures(monkeypatch) -> None:
    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("history unavailable")))

    result = CliRunner().invoke(app, ["doctor", "--tickers", "AAPL"])

    assert result.exit_code == 1
    assert "History status: FAIL - history unavailable" in result.output


def test_live_agent_once_uses_expanded_universe(monkeypatch, tmp_path) -> None:
    data = market_frame(["AAPL", "MSFT", "SPY", "QQQ", "^VIX"], direction="up", vix_price=15)

    monkeypatch.setattr("stock_guru.cli.market_state", lambda *_args, **_kwargs: "open")
    monkeypatch.setattr("stock_guru.cli.resolve_live_symbols", lambda *args, **kwargs: (["AAPL", "MSFT"], None))
    monkeypatch.setattr("stock_guru.cli.download_history", lambda *args, **kwargs: data)
    monkeypatch.setattr("stock_guru.cli.latest_prices", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("stock_guru.cli.write_evaluations_json", lambda evaluations, path=tmp_path / "evaluations.json": path)

    result = CliRunner().invoke(app, ["live-agent", "--once"])

    assert result.exit_code == 0
    assert "Live agent cycle: market open; symbols 2" in result.output
    assert "Wrote evaluations:" in result.output
