from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from .backtest import BacktestMetrics, SimulatedTrade, metrics_for_trades
from .config import Settings
from .data import MarketData
from .evaluator import QuoteSnapshot, build_indicator_snapshot, market_condition
from .intraday import (
    AUTO_ORDER_READY,
    LARGE_AUTO_ORDER_READY,
    IntradayMarketContext,
    evaluate_intraday_entry,
    evaluate_intraday_exit,
)
from .lifecycle import DailyRiskState, LivePositionPlan


@dataclass(frozen=True)
class ReplayResult:
    trades: list[SimulatedTrade]
    metrics: BacktestMetrics
    symbol_metrics: dict[str, BacktestMetrics]
    eligible_symbols: list[str]
    symbols: list[str]
    bars_processed: int


@dataclass(frozen=True)
class ReplayOptimizationResult:
    settings: Settings
    replay: ReplayResult
    rank_score: float
    reasons: list[str]


@dataclass(frozen=True)
class WalkForwardOptimizationResult:
    settings: Settings
    train_replay: ReplayResult
    validation_replay: ReplayResult
    train_score: float
    validation_score: float
    train_reasons: list[str]
    validation_reasons: list[str]


def _as_datetime(value: object, settings: Settings) -> datetime:
    if hasattr(value, "to_pydatetime"):
        current = value.to_pydatetime()
    elif isinstance(value, datetime):
        current = value
    else:
        current = datetime.now(ZoneInfo(settings.market_timezone))
    if current.tzinfo is None:
        current = current.replace(tzinfo=ZoneInfo(settings.market_timezone))
    return current.astimezone(ZoneInfo(settings.market_timezone))


def synthetic_quote(symbol: str, price: float, settings: Settings) -> QuoteSnapshot:
    spread = max(price * min(settings.intraday_max_spread_pct * 0.5, 0.001), 0.01)
    return QuoteSnapshot(
        ticker=symbol,
        bid=round(price - spread / 2, 4),
        ask=round(price + spread / 2, 4),
        last=round(price, 4),
        data_fresh=True,
    )


def metrics_by_symbol(trades: list[SimulatedTrade], symbols: list[str]) -> dict[str, BacktestMetrics]:
    grouped: dict[str, list[SimulatedTrade]] = {symbol: [] for symbol in symbols}
    for trade in trades:
        grouped.setdefault(trade.symbol, []).append(trade)
    return {symbol: metrics_for_trades(items) for symbol, items in grouped.items()}


def eligible_symbols_from_metrics(metrics: dict[str, BacktestMetrics], settings: Settings) -> list[str]:
    eligible: list[str] = []
    for symbol, item in metrics.items():
        if item.trades < settings.live_min_strategy_trades:
            continue
        if item.expectancy <= settings.live_min_strategy_expectancy:
            continue
        drawdown_pct = item.max_drawdown / max(settings.live_principal_dollars, 1.0)
        if drawdown_pct > settings.live_max_strategy_drawdown_pct:
            continue
        eligible.append(symbol)
    return sorted(eligible)


def replay_intraday_rules(
    data: MarketData,
    settings: Settings,
    *,
    symbols: list[str],
    account_value: float | None = None,
    warmup_bars: int = 60,
) -> ReplayResult:
    trades: list[SimulatedTrade] = []
    open_positions: dict[str, tuple[LivePositionPlan, str]] = {}
    bankroll = account_value if account_value is not None else settings.live_principal_dollars
    bars_processed = 0

    for index in range(warmup_bars, len(data.history)):
        bars_processed += 1
        sliced = MarketData(data.tickers, data.history.iloc[: index + 1])
        when = _as_datetime(sliced.history.index[-1], settings)
        market = market_condition(sliced, now=when)
        spy = build_indicator_snapshot(sliced, "SPY", now=when)
        qqq = build_indicator_snapshot(sliced, "QQQ", now=when)
        context = IntradayMarketContext(
            now=when,
            market_condition=market,
            spy_aligned=bool(spy and spy.current_price > spy.vwap and spy.trend_direction == "uptrend"),
            qqq_aligned=bool(qqq and qqq.current_price > qqq.vwap and qqq.trend_direction == "uptrend"),
            sector_aligned=True,
            news_verified=True,
        )
        risk = DailyRiskState(date=when.date().isoformat())

        for symbol in symbols:
            indicators = build_indicator_snapshot(sliced, symbol, now=when)
            if indicators is None:
                continue
            quote = synthetic_quote(symbol, indicators.current_price, settings)
            existing = open_positions.get(symbol)
            if existing:
                position, entry_reason = existing
                decision = evaluate_intraday_exit(position, indicators, settings, quote=quote, context=context, daily_risk=risk)
                if decision.action == "INTRADAY_EXIT":
                    trades.append(
                        SimulatedTrade(
                            symbol=symbol,
                            entry_price=position.average_cost,
                            exit_price=decision.price,
                            shares=position.shares,
                            entry_reason=entry_reason,
                            exit_reason=decision.reason,
                        )
                    )
                    del open_positions[symbol]
                continue

            intent = evaluate_intraday_entry(
                indicators,
                settings,
                quote=quote,
                context=context,
                daily_risk=risk,
                account_value=bankroll,
                open_order_symbols=set(),
            )
            if intent.status not in {AUTO_ORDER_READY, LARGE_AUTO_ORDER_READY}:
                continue
            shares = min(settings.live_max_order_dollars, bankroll) / max(intent.entry_price, 0.01)
            open_positions[symbol] = (
                LivePositionPlan(
                    symbol=symbol,
                    shares=round(shares, 6),
                    average_cost=intent.entry_price,
                    stop_price=intent.stop_price,
                    target_1=intent.target_1,
                    target_2=intent.target_2,
                    profit_lock_price=round(intent.entry_price * 1.02, 4),
                    thesis=intent.thesis,
                    opened_at=when.isoformat(timespec="seconds"),
                    force_exit_after=when.isoformat(timespec="seconds"),
                ),
                intent.setup_type,
            )

    if data.history.empty:
        empty_metrics = metrics_by_symbol([], symbols)
        return ReplayResult(
            trades=[],
            metrics=metrics_for_trades([]),
            symbol_metrics=empty_metrics,
            eligible_symbols=eligible_symbols_from_metrics(empty_metrics, settings),
            symbols=symbols,
            bars_processed=0,
        )

    final_slice = MarketData(data.tickers, data.history)
    final_when = _as_datetime(final_slice.history.index[-1], settings)
    for symbol, (position, entry_reason) in list(open_positions.items()):
        indicators = build_indicator_snapshot(final_slice, symbol, now=final_when)
        if indicators is None:
            continue
        trades.append(
            SimulatedTrade(
                symbol=symbol,
                entry_price=position.average_cost,
                exit_price=indicators.current_price,
                shares=position.shares,
                entry_reason=entry_reason,
                exit_reason="replay final bar exit",
            )
        )

    symbol_metrics = metrics_by_symbol(trades, symbols)
    return ReplayResult(
        trades=trades,
        metrics=metrics_for_trades(trades),
        symbol_metrics=symbol_metrics,
        eligible_symbols=eligible_symbols_from_metrics(symbol_metrics, settings),
        symbols=symbols,
        bars_processed=bars_processed,
    )


def replay_rank_score(result: ReplayResult, settings: Settings) -> tuple[float, list[str]]:
    reasons: list[str] = []
    metrics = result.metrics
    if metrics.trades < settings.live_min_strategy_trades:
        reasons.append(f"trade sample too small: {metrics.trades} < {settings.live_min_strategy_trades}")
    if metrics.expectancy <= settings.live_min_strategy_expectancy:
        reasons.append(f"expectancy too weak: {metrics.expectancy:.4f}")
    drawdown_pct = metrics.max_drawdown / max(settings.live_principal_dollars, 1.0)
    if drawdown_pct > settings.live_max_strategy_drawdown_pct:
        reasons.append(f"drawdown too high: {drawdown_pct:.4f}")
    score = metrics.expectancy - metrics.max_drawdown * 0.1 + metrics.win_rate * 0.25
    if reasons:
        score -= 10
    return round(score, 6), reasons


def optimize_intraday_replay(
    data: MarketData,
    base_settings: Settings,
    *,
    symbols: list[str],
    min_entry_scores: list[int] | None = None,
    auto_order_scores: list[int] | None = None,
    relative_volumes: list[float] | None = None,
    max_spreads: list[float] | None = None,
    warmup_bars: int = 60,
) -> list[ReplayOptimizationResult]:
    results: list[ReplayOptimizationResult] = []
    for min_score in min_entry_scores or [80, 85, 90]:
        for auto_score in auto_order_scores or [88, 90, 92]:
            if auto_score < min_score:
                continue
            for relative_volume in relative_volumes or [1.0, 1.2, 1.5]:
                for max_spread in max_spreads or [0.003, 0.005, 0.008]:
                    settings = replace(
                        base_settings,
                        intraday_min_entry_score=min_score,
                        intraday_auto_order_score=auto_score,
                        intraday_min_relative_volume=relative_volume,
                        intraday_max_spread_pct=max_spread,
                    )
                    replay = replay_intraday_rules(data, settings, symbols=symbols, warmup_bars=warmup_bars)
                    score, reasons = replay_rank_score(replay, settings)
                    results.append(ReplayOptimizationResult(settings=settings, replay=replay, rank_score=score, reasons=reasons))
    return sorted(
        results,
        key=lambda item: (
            bool(item.reasons),
            -item.rank_score,
            -item.replay.metrics.expectancy,
            item.replay.metrics.max_drawdown,
            -item.replay.metrics.trades,
        ),
    )


def split_market_data(data: MarketData, *, train_fraction: float = 0.6) -> tuple[MarketData, MarketData]:
    if data.history.empty:
        return MarketData(data.tickers, data.history), MarketData(data.tickers, data.history)
    split_at = int(len(data.history) * train_fraction)
    split_at = min(max(split_at, 1), len(data.history) - 1)
    return (
        MarketData(data.tickers, data.history.iloc[:split_at]),
        MarketData(data.tickers, data.history.iloc[split_at:]),
    )


def optimize_intraday_walk_forward(
    data: MarketData,
    base_settings: Settings,
    *,
    symbols: list[str],
    train_fraction: float = 0.6,
    train_top: int = 10,
    min_entry_scores: list[int] | None = None,
    auto_order_scores: list[int] | None = None,
    relative_volumes: list[float] | None = None,
    max_spreads: list[float] | None = None,
    warmup_bars: int = 60,
) -> list[WalkForwardOptimizationResult]:
    train_data, validation_data = split_market_data(data, train_fraction=train_fraction)
    train_results = optimize_intraday_replay(
        train_data,
        base_settings,
        symbols=symbols,
        min_entry_scores=min_entry_scores,
        auto_order_scores=auto_order_scores,
        relative_volumes=relative_volumes,
        max_spreads=max_spreads,
        warmup_bars=warmup_bars,
    )
    walked: list[WalkForwardOptimizationResult] = []
    for train_item in train_results[:train_top]:
        validation = replay_intraday_rules(validation_data, train_item.settings, symbols=symbols, warmup_bars=warmup_bars)
        validation_score, validation_reasons = replay_rank_score(validation, train_item.settings)
        walked.append(
            WalkForwardOptimizationResult(
                settings=train_item.settings,
                train_replay=train_item.replay,
                validation_replay=validation,
                train_score=train_item.rank_score,
                validation_score=validation_score,
                train_reasons=train_item.reasons,
                validation_reasons=validation_reasons,
            )
        )
    return sorted(
        walked,
        key=lambda item: (
            bool(item.validation_reasons),
            -item.validation_score,
            -item.validation_replay.metrics.expectancy,
            item.validation_replay.metrics.max_drawdown,
            -item.validation_replay.metrics.trades,
        ),
    )
