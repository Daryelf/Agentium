from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Mapping

from .backtest import BacktestMetrics, metrics_for_trades, realized_trades_from_order_plans
from .config import DATA_DIR, Settings
from .lifecycle import LIFECYCLE_STATE_PATH, load_lifecycle_state


STRATEGY_HEALTH_PATH = DATA_DIR / "strategy_health.json"


def read_json(path: Path) -> Mapping[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    return payload if isinstance(payload, Mapping) else None


def strategy_metrics_from_json(payload: Mapping[str, object] | None) -> BacktestMetrics | None:
    if payload is None:
        return None
    metrics = payload.get("metrics")
    if isinstance(metrics, Mapping):
        payload = metrics
    try:
        return BacktestMetrics(
            trades=int(payload.get("trades", 0)),
            wins=int(payload.get("wins", 0)),
            losses=int(payload.get("losses", 0)),
            win_rate=float(payload.get("win_rate", 0.0)),
            average_win=float(payload.get("average_win", 0.0)),
            average_loss=float(payload.get("average_loss", 0.0)),
            expectancy=float(payload.get("expectancy", 0.0)),
            max_drawdown=float(payload.get("max_drawdown", 0.0)),
        )
    except (TypeError, ValueError):
        return None


def read_strategy_metrics(path: Path = STRATEGY_HEALTH_PATH) -> BacktestMetrics | None:
    return strategy_metrics_from_json(read_json(path))


def strategy_health_reasons(settings: Settings, *, path: Path = STRATEGY_HEALTH_PATH) -> list[str]:
    metrics = read_strategy_metrics(path)
    if metrics is None:
        return ["strategy health metrics missing"]
    reasons: list[str] = []
    if metrics.trades < settings.live_min_strategy_trades:
        reasons.append(f"strategy trade sample too small: {metrics.trades} < {settings.live_min_strategy_trades}")
    if metrics.expectancy <= settings.live_min_strategy_expectancy:
        reasons.append(f"strategy expectancy too weak: {metrics.expectancy:.4f}")
    drawdown_pct = metrics.max_drawdown / max(settings.live_principal_dollars, 1.0)
    if drawdown_pct > settings.live_max_strategy_drawdown_pct:
        reasons.append(f"strategy drawdown too high: {drawdown_pct:.4f}")
    return reasons


def write_strategy_health(
    metrics: BacktestMetrics,
    *,
    path: Path = STRATEGY_HEALTH_PATH,
    symbol_metrics: Mapping[str, BacktestMetrics] | None = None,
    eligible_symbols: list[str] | None = None,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {"metrics": asdict(metrics)}
    if symbol_metrics is not None:
        payload["symbol_metrics"] = {symbol: asdict(item) for symbol, item in sorted(symbol_metrics.items())}
    if eligible_symbols is not None:
        payload["eligible_symbols"] = sorted(eligible_symbols)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def read_eligible_symbols(path: Path = STRATEGY_HEALTH_PATH) -> list[str] | None:
    payload = read_json(path)
    if payload is None or "eligible_symbols" not in payload:
        return None
    values = payload.get("eligible_symbols")
    if not isinstance(values, list):
        return []
    return sorted(str(item).strip().upper() for item in values if str(item).strip())


def write_strategy_health_from_lifecycle(
    *,
    lifecycle_path: Path = LIFECYCLE_STATE_PATH,
    strategy_health_path: Path = STRATEGY_HEALTH_PATH,
    now: datetime | None = None,
) -> tuple[Path, BacktestMetrics]:
    lifecycle = load_lifecycle_state(lifecycle_path, now=now)
    trades = realized_trades_from_order_plans(lifecycle.order_plans)
    metrics = metrics_for_trades(trades)
    return write_strategy_health(metrics, path=strategy_health_path), metrics
