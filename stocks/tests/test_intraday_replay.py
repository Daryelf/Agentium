from __future__ import annotations

from stock_guru.backtest import BacktestMetrics
from stock_guru.intraday_replay import (
    eligible_symbols_from_metrics,
    optimize_intraday_replay,
    optimize_intraday_walk_forward,
    replay_intraday_rules,
    split_market_data,
    synthetic_quote,
)
from stock_guru.intraday import spread_pct
from tests.test_intraday_loop import intraday_frame, settings


def test_synthetic_quote_uses_safe_spread() -> None:
    quote = synthetic_quote("TEST", 100, settings())

    assert quote.last == 100
    assert spread_pct(quote, 100) <= settings().intraday_max_spread_pct


def test_replay_intraday_rules_processes_bars_and_returns_metrics() -> None:
    result = replay_intraday_rules(intraday_frame(), settings(), symbols=["TEST"], warmup_bars=60)

    assert result.bars_processed == 20
    assert result.symbols == ["TEST"]
    assert result.metrics.trades == len(result.trades)
    assert "TEST" in result.symbol_metrics


def test_eligible_symbols_require_trade_sample_expectancy_and_drawdown() -> None:
    metrics = {
        "GOOD": BacktestMetrics(20, 12, 8, 0.6, 1.2, -0.4, 0.56, 1.0),
        "BAD": BacktestMetrics(20, 8, 12, 0.4, 0.5, -1.0, -0.4, 1.0),
        "TINY": BacktestMetrics(1, 1, 0, 1.0, 2.0, 0.0, 2.0, 0.0),
    }

    assert eligible_symbols_from_metrics(metrics, settings()) == ["GOOD"]


def test_optimize_intraday_replay_returns_ranked_configurations() -> None:
    results = optimize_intraday_replay(
        intraday_frame(),
        settings(),
        symbols=["TEST"],
        min_entry_scores=[85],
        auto_order_scores=[90],
        relative_volumes=[1.0, 1.2],
        max_spreads=[0.005],
        warmup_bars=60,
    )

    assert len(results) == 2
    assert results == sorted(results, key=lambda item: (bool(item.reasons), -item.rank_score, -item.replay.metrics.expectancy, item.replay.metrics.max_drawdown, -item.replay.metrics.trades))


def test_split_market_data_keeps_train_and_validation_windows() -> None:
    train, validation = split_market_data(intraday_frame(), train_fraction=0.6)

    assert len(train.history) == 48
    assert len(validation.history) == 32


def test_walk_forward_optimizer_ranks_by_validation_metrics() -> None:
    results = optimize_intraday_walk_forward(
        intraday_frame(),
        settings(),
        symbols=["TEST"],
        train_fraction=0.6,
        train_top=2,
        min_entry_scores=[85],
        auto_order_scores=[90],
        relative_volumes=[1.0, 1.2],
        max_spreads=[0.005],
        warmup_bars=20,
    )

    assert len(results) == 2
    assert results == sorted(results, key=lambda item: (bool(item.validation_reasons), -item.validation_score, -item.validation_replay.metrics.expectancy, item.validation_replay.metrics.max_drawdown, -item.validation_replay.metrics.trades))
