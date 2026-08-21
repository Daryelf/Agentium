from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from statistics import median
from typing import Mapping, Sequence

import pandas as pd

from ..config import DATA_DIR
from ..data import MarketData, field_for
from ..market_context import build_market_regime
from .context import build_symbol_context
from .engine import build_quant_snapshot
from .indicators import normalize_daily_index
from .scoring import score_symbol


QUANT_BACKTEST_PATH = DATA_DIR / "quant_backtest.json"
FORWARD_HORIZONS: tuple[int, ...] = (1, 5, 10, 20, 60)
SCORE_BUCKETS: tuple[tuple[str, float, float], ...] = (
    ("90-100", 90, 101),
    ("80-89", 80, 90),
    ("70-79", 70, 80),
    ("60-69", 60, 70),
    ("0-59", 0, 60),
)


@dataclass(frozen=True)
class ForwardObservation:
    as_of: str
    symbol: str
    final_score: float
    confidence_score: float
    risk_score: float | None
    action: str
    market_regime: str
    entry_price: float
    liquidity_bucket: str
    per_side_cost_bps: float
    gross_forward_returns: Mapping[str, float | None]
    net_forward_returns: Mapping[str, float | None]
    benchmark_returns: Mapping[str, float | None]
    relative_returns: Mapping[str, float | None]


@dataclass(frozen=True)
class HorizonMetrics:
    sample_size: int
    trusted_sample: bool
    win_rate: float | None
    average_return: float | None
    median_return: float | None
    average_relative_return: float | None
    max_drawdown: float | None


@dataclass(frozen=True)
class QuantBacktestReport:
    version: int
    generated_at: str
    as_of_start: str | None
    as_of_end: str | None
    symbols: tuple[str, ...]
    step_sessions: int
    horizons: tuple[int, ...]
    observations: tuple[ForwardObservation, ...]
    score_buckets: Mapping[str, Mapping[str, HorizonMetrics]]
    regime_metrics: Mapping[str, Mapping[str, HorizonMetrics]]
    provider_costs_bps: Mapping[str, float]
    limitations: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ThresholdMetrics:
    threshold: float
    sample_size: int
    average_net_return_20d: float | None
    average_relative_return_20d: float | None
    trusted_sample: bool


@dataclass(frozen=True)
class WalkForwardReport:
    version: int
    generated_at: str
    train_start: str
    train_end: str
    validation_start: str
    validation_end: str
    selected_threshold: float
    train_candidates: tuple[ThresholdMetrics, ...]
    validation_metrics: ThresholdMetrics
    weights_changed: bool
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def as_of_market_data(data: MarketData, cutoff: pd.Timestamp) -> MarketData:
    end_of_day = pd.Timestamp(cutoff)
    if end_of_day.tzinfo is None:
        end_of_day = end_of_day.tz_localize("UTC")
    else:
        end_of_day = end_of_day.tz_convert("UTC")
    end_of_day = end_of_day.normalize() + pd.Timedelta(days=1) - pd.Timedelta(nanoseconds=1)
    history = data.history.loc[data.history.index <= end_of_day].copy()
    # Current provider health and source timestamps describe the full download,
    # not the historical cutoff. Excluding them prevents future metadata leakage.
    return MarketData(list(data.tickers), history)


def _daily_close(data: MarketData, symbol: str) -> pd.Series:
    try:
        return normalize_daily_index(field_for(data.history, symbol, "Close"))
    except Exception:
        return pd.Series(dtype="float64")


def _forward_return(close: pd.Series, cutoff: pd.Timestamp, horizon: int) -> float | None:
    values = normalize_daily_index(close)
    if values.empty:
        return None
    day = pd.Timestamp(cutoff)
    if day.tzinfo is None:
        day = day.tz_localize("UTC")
    else:
        day = day.tz_convert("UTC")
    day = day.normalize()
    eligible = values.index[values.index <= day]
    if eligible.empty:
        return None
    position = values.index.get_loc(eligible[-1])
    if not isinstance(position, int) or position + horizon >= len(values):
        return None
    start = float(values.iloc[position])
    end = float(values.iloc[position + horizon])
    return end / start - 1.0 if start > 0 else None


def liquidity_cost_bps(average_dollar_volume: float | None) -> tuple[str, float]:
    if average_dollar_volume is None:
        return "UNKNOWN", 20.0
    if average_dollar_volume >= 100_000_000:
        return "HIGH", 5.0
    if average_dollar_volume >= 10_000_000:
        return "MEDIUM", 10.0
    return "LOW", 20.0


def _evaluation_days(data: MarketData, symbols: Sequence[str], minimum_history: int) -> list[pd.Timestamp]:
    benchmark = _daily_close(data, "SPY")
    if benchmark.empty:
        benchmark = next((_daily_close(data, symbol) for symbol in symbols if not _daily_close(data, symbol).empty), pd.Series(dtype="float64"))
    return list(benchmark.index[minimum_history - 1:]) if len(benchmark) >= minimum_history else []


def _score_bucket(score: float) -> str:
    return next(name for name, lower, upper in SCORE_BUCKETS if lower <= score < upper)


def _max_drawdown(returns: Sequence[float]) -> float | None:
    if not returns:
        return None
    equity = 1.0
    peak = 1.0
    worst = 0.0
    for value in returns:
        equity *= 1.0 + value
        peak = max(peak, equity)
        worst = min(worst, equity / peak - 1.0)
    return worst


def _metrics(observations: Sequence[ForwardObservation], horizon: int, *, minimum_sample: int) -> HorizonMetrics:
    key = f"{horizon}d"
    net = [item.net_forward_returns[key] for item in observations if item.net_forward_returns.get(key) is not None]
    relative = [item.relative_returns[key] for item in observations if item.relative_returns.get(key) is not None]
    values = [float(value) for value in net]
    relatives = [float(value) for value in relative]
    return HorizonMetrics(
        sample_size=len(values),
        trusted_sample=len(values) >= minimum_sample,
        win_rate=round(sum(value > 0 for value in values) / len(values), 6) if values else None,
        average_return=round(sum(values) / len(values), 8) if values else None,
        median_return=round(median(values), 8) if values else None,
        average_relative_return=round(sum(relatives) / len(relatives), 8) if relatives else None,
        max_drawdown=round(_max_drawdown(values), 8) if values else None,
    )


def _group_metrics(
    observations: Sequence[ForwardObservation],
    groups: Mapping[str, Sequence[ForwardObservation]],
    horizons: Sequence[int],
    minimum_sample: int,
) -> dict[str, dict[str, HorizonMetrics]]:
    del observations
    return {
        group: {f"{horizon}d": _metrics(items, horizon, minimum_sample=minimum_sample) for horizon in horizons}
        for group, items in groups.items()
    }


def run_quant_backtest(
    data: MarketData,
    symbols: Sequence[str],
    *,
    start: str | datetime | None = None,
    end: str | datetime | None = None,
    step_sessions: int = 20,
    horizons: Sequence[int] = FORWARD_HORIZONS,
    minimum_history: int = 200,
    minimum_sample: int = 30,
    sectors_by_symbol: Mapping[str, str] | None = None,
    generated_at: datetime | None = None,
) -> QuantBacktestReport:
    normalized_symbols = tuple(dict.fromkeys(str(symbol).upper() for symbol in symbols if str(symbol).strip()))
    days = _evaluation_days(data, normalized_symbols, minimum_history)
    if start is not None:
        start_day = pd.Timestamp(start)
        if start_day.tzinfo is None:
            start_day = start_day.tz_localize("UTC")
        days = [day for day in days if day >= start_day.normalize()]
    if end is not None:
        end_day = pd.Timestamp(end)
        if end_day.tzinfo is None:
            end_day = end_day.tz_localize("UTC")
        days = [day for day in days if day <= end_day.normalize()]
    selected_days = days[:: max(1, step_sessions)]
    full_closes = {symbol: _daily_close(data, symbol) for symbol in {*normalized_symbols, "SPY"}}
    observations: list[ForwardObservation] = []
    for day in selected_days:
        historical = as_of_market_data(data, day)
        regime = build_market_regime(historical, historical.tickers, generated_at=day.to_pydatetime(), sectors_by_symbol=sectors_by_symbol)
        for symbol in normalized_symbols:
            snapshot = build_quant_snapshot(
                historical,
                symbol,
                sector_etf=(sectors_by_symbol or {}).get(symbol),
                generated_at=day.to_pydatetime(),
            )
            if snapshot.price is None or snapshot.bars < minimum_history:
                continue
            context = build_symbol_context(snapshot, generated_at=day.to_pydatetime())
            card = score_symbol(snapshot, context, regime, generated_at=day.to_pydatetime())
            if card.final_score is None:
                continue
            dollar_volume = context.liquidity.average_dollar_volume_20
            liquidity_bucket, cost_bps = liquidity_cost_bps(dollar_volume)
            round_trip_cost = 2.0 * cost_bps / 10_000.0
            gross: dict[str, float | None] = {}
            net: dict[str, float | None] = {}
            benchmark: dict[str, float | None] = {}
            relative: dict[str, float | None] = {}
            for horizon in horizons:
                key = f"{horizon}d"
                gross[key] = _forward_return(full_closes[symbol], day, horizon)
                benchmark[key] = _forward_return(full_closes["SPY"], day, horizon)
                net[key] = gross[key] - round_trip_cost if gross[key] is not None else None
                relative[key] = net[key] - benchmark[key] if net[key] is not None and benchmark[key] is not None else None
            observations.append(ForwardObservation(
                as_of=day.date().isoformat(),
                symbol=symbol,
                final_score=card.final_score,
                confidence_score=card.confidence_score,
                risk_score=card.risk_score,
                action=card.action,
                market_regime=regime.regime,
                entry_price=snapshot.price,
                liquidity_bucket=liquidity_bucket,
                per_side_cost_bps=cost_bps,
                gross_forward_returns=gross,
                net_forward_returns=net,
                benchmark_returns=benchmark,
                relative_returns=relative,
            ))
    observations.sort(key=lambda item: (item.as_of, item.symbol))
    buckets = {name: [item for item in observations if name == _score_bucket(item.final_score)] for name, _, _ in SCORE_BUCKETS}
    regimes = {name: [item for item in observations if item.market_regime == name] for name in sorted({item.market_regime for item in observations})}
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return QuantBacktestReport(
        version=1,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        as_of_start=selected_days[0].date().isoformat() if selected_days else None,
        as_of_end=selected_days[-1].date().isoformat() if selected_days else None,
        symbols=normalized_symbols,
        step_sessions=max(1, step_sessions),
        horizons=tuple(int(item) for item in horizons),
        observations=tuple(observations),
        score_buckets=_group_metrics(observations, buckets, horizons, minimum_sample),
        regime_metrics=_group_metrics(observations, regimes, horizons, minimum_sample),
        provider_costs_bps={"HIGH": 5.0, "MEDIUM": 10.0, "LOW": 20.0, "UNKNOWN": 20.0},
        limitations=(
            "Historical scores use only OHLCV rows at or before each as-of date; future rows are used only for measured outcomes.",
            "Historical point-in-time fundamentals, earnings calendars, news, and 13F vintages are not available in this dataset and are excluded rather than backfilled from today.",
            "Using today's symbol universe creates survivorship bias; results must be labeled as survivor-universe research.",
            f"Score buckets with fewer than {minimum_sample} observations are untrusted and are marked trusted_sample=false.",
            "Round-trip spread/slippage costs are applied by average-dollar-volume bucket; commission-free is not cost-free.",
        ),
    )


def _threshold_metrics(observations: Sequence[ForwardObservation], threshold: float, minimum_sample: int) -> ThresholdMetrics:
    selected = [item for item in observations if item.final_score >= threshold and item.net_forward_returns.get("20d") is not None]
    net = [float(item.net_forward_returns["20d"]) for item in selected]
    relative = [float(item.relative_returns["20d"]) for item in selected if item.relative_returns.get("20d") is not None]
    return ThresholdMetrics(
        threshold=float(threshold),
        sample_size=len(net),
        average_net_return_20d=round(sum(net) / len(net), 8) if net else None,
        average_relative_return_20d=round(sum(relative) / len(relative), 8) if relative else None,
        trusted_sample=len(net) >= minimum_sample,
    )


def walk_forward_validate(
    report: QuantBacktestReport,
    *,
    train_fraction: float = 0.6,
    thresholds: Sequence[float] = (60, 65, 70, 75, 80, 85),
    minimum_sample: int = 30,
    generated_at: datetime | None = None,
) -> WalkForwardReport:
    dates = sorted({item.as_of for item in report.observations})
    if len(dates) < 2:
        raise ValueError("walk-forward validation requires at least two distinct as-of dates")
    split_index = min(len(dates) - 1, max(1, int(len(dates) * min(0.9, max(0.1, train_fraction)))))
    train_dates = set(dates[:split_index])
    validation_dates = set(dates[split_index:])
    train = [item for item in report.observations if item.as_of in train_dates]
    validation = [item for item in report.observations if item.as_of in validation_dates]
    candidates = tuple(_threshold_metrics(train, threshold, minimum_sample) for threshold in thresholds)
    eligible = [item for item in candidates if item.average_relative_return_20d is not None]
    selected = max(
        eligible,
        key=lambda item: (
            item.trusted_sample,
            item.average_relative_return_20d if item.average_relative_return_20d is not None else -math.inf,
            item.average_net_return_20d if item.average_net_return_20d is not None else -math.inf,
            item.sample_size,
        ),
    ) if eligible else ThresholdMetrics(75.0, 0, None, None, False)
    validation_metrics = _threshold_metrics(validation, selected.threshold, minimum_sample)
    warnings: list[str] = []
    if not selected.trusted_sample:
        warnings.append("Selected training threshold has fewer than the minimum trusted sample size.")
    if not validation_metrics.trusted_sample:
        warnings.append("Validation threshold has fewer than the minimum trusted sample size.")
    if selected.average_relative_return_20d is not None and validation_metrics.average_relative_return_20d is not None and selected.average_relative_return_20d > 0 >= validation_metrics.average_relative_return_20d:
        warnings.append("Training outperformance did not persist in the unseen validation period.")
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return WalkForwardReport(
        version=1,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        train_start=min(train_dates),
        train_end=max(train_dates),
        validation_start=min(validation_dates),
        validation_end=max(validation_dates),
        selected_threshold=selected.threshold,
        train_candidates=candidates,
        validation_metrics=validation_metrics,
        weights_changed=False,
        warnings=tuple(warnings),
    )


def write_quant_backtest_report(
    report: QuantBacktestReport,
    *,
    walk_forward: WalkForwardReport | None = None,
    path: Path = QUANT_BACKTEST_PATH,
) -> Path:
    payload = report.to_dict()
    payload["walk_forward"] = walk_forward.to_dict() if walk_forward else None
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n")
    os.replace(temporary, path)
    return path
