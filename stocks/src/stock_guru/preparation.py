from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .config import Settings
from .data import MarketData, download_history
from .evidence_bundle import EvidenceBundleReport, build_local_evidence_bundle
from .broker_client import BrokerClient
from .intraday_replay import ReplayResult, WalkForwardOptimizationResult, optimize_intraday_walk_forward, replay_intraday_rules
from .optimization import OPTIMIZATION_REPORT_PATH, write_walk_forward_optimization_report
from .readiness import ReadinessReport, build_readiness_report
from .strategy_health import STRATEGY_HEALTH_PATH, write_strategy_health


@dataclass(frozen=True)
class LiveAutoPreparationReport:
    replay: ReplayResult
    walk_forward: list[WalkForwardOptimizationResult]
    strategy_health_path: Path
    optimization_report_path: Path
    readiness: ReadinessReport
    evidence_bundle: EvidenceBundleReport | None = None


def analysis_symbols(symbols: list[str]) -> list[str]:
    expanded = list(symbols)
    for symbol in ["SPY", "QQQ", "^VIX"]:
        if symbol not in expanded:
            expanded.append(symbol)
    return expanded


def prepare_live_auto(
    *,
    symbols: list[str],
    settings: Settings,
    account_number: str,
    now: datetime,
    period: str = "5d",
    interval: str = "1m",
    train_fraction: float = 0.6,
    data: MarketData | None = None,
    broker: BrokerClient | None = None,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    optimization_report_path: Path = OPTIMIZATION_REPORT_PATH,
    require_broker_tool_status: bool = True,
) -> LiveAutoPreparationReport:
    market_data = data or download_history(analysis_symbols(symbols), period=period, interval=interval, prefer_cache=False)
    replay = replay_intraday_rules(market_data, settings, symbols=symbols)
    saved_strategy = write_strategy_health(
        replay.metrics,
        path=strategy_health_path,
        symbol_metrics=replay.symbol_metrics,
        eligible_symbols=replay.eligible_symbols,
    )
    walk_forward = optimize_intraday_walk_forward(
        market_data,
        settings,
        symbols=symbols,
        train_fraction=train_fraction,
    )
    saved_optimization = write_walk_forward_optimization_report(
        walk_forward,
        symbols=symbols,
        generated_at=now,
        path=optimization_report_path,
    )
    readiness = build_readiness_report(
        settings,
        account_number=account_number,
        now=now,
        strategy_health_path=saved_strategy,
        optimization_report_path=saved_optimization,
    )
    evidence_bundle = (
        build_local_evidence_bundle(
            settings=settings,
            account_number=account_number,
            symbols=symbols,
            broker=broker,
            now=now,
            require_broker_tool_status=require_broker_tool_status,
            output_dir=strategy_health_path.parent if strategy_health_path != STRATEGY_HEALTH_PATH else None,
        )
        if broker is not None
        else None
    )
    return LiveAutoPreparationReport(
        replay=replay,
        walk_forward=walk_forward,
        strategy_health_path=saved_strategy,
        optimization_report_path=saved_optimization,
        readiness=readiness,
        evidence_bundle=evidence_bundle,
    )
