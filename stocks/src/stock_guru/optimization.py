from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Mapping

from .config import DATA_DIR, Settings
from .intraday_replay import ReplayOptimizationResult, WalkForwardOptimizationResult


OPTIMIZATION_REPORT_PATH = DATA_DIR / "replay_optimization.json"
OPTIMIZED_SETTING_KEYS = {
    "intraday_min_entry_score",
    "intraday_auto_order_score",
    "intraday_min_relative_volume",
    "intraday_max_spread_pct",
}


def optimized_settings_payload(settings: Settings) -> dict[str, object]:
    return {
        "intraday_min_entry_score": settings.intraday_min_entry_score,
        "intraday_auto_order_score": settings.intraday_auto_order_score,
        "intraday_min_relative_volume": settings.intraday_min_relative_volume,
        "intraday_max_spread_pct": settings.intraday_max_spread_pct,
    }


def write_optimization_report(
    results: list[ReplayOptimizationResult],
    *,
    symbols: list[str],
    generated_at: datetime,
    path: Path = OPTIMIZATION_REPORT_PATH,
) -> Path:
    best = results[0] if results else None
    payload = {
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "symbols": symbols,
        "best": None
        if best is None
        else {
            "rank_score": best.rank_score,
            "reasons": best.reasons,
            "settings": optimized_settings_payload(best.settings),
            "metrics": asdict(best.replay.metrics),
            "eligible_symbols": best.replay.eligible_symbols,
        },
        "candidates": [
            {
                "rank_score": item.rank_score,
                "reasons": item.reasons,
                "settings": optimized_settings_payload(item.settings),
                "metrics": asdict(item.replay.metrics),
                "eligible_symbols": item.replay.eligible_symbols,
            }
            for item in results[:10]
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def write_walk_forward_optimization_report(
    results: list[WalkForwardOptimizationResult],
    *,
    symbols: list[str],
    generated_at: datetime,
    path: Path = OPTIMIZATION_REPORT_PATH,
) -> Path:
    best = results[0] if results else None
    payload = {
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "report_type": "walk_forward",
        "symbols": symbols,
        "best": None
        if best is None
        else {
            "rank_score": best.validation_score,
            "train_score": best.train_score,
            "validation_score": best.validation_score,
            "reasons": best.validation_reasons,
            "train_reasons": best.train_reasons,
            "validation_reasons": best.validation_reasons,
            "settings": optimized_settings_payload(best.settings),
            "metrics": asdict(best.validation_replay.metrics),
            "train_metrics": asdict(best.train_replay.metrics),
            "validation_metrics": asdict(best.validation_replay.metrics),
            "eligible_symbols": best.validation_replay.eligible_symbols,
        },
        "candidates": [
            {
                "rank_score": item.validation_score,
                "train_score": item.train_score,
                "validation_score": item.validation_score,
                "reasons": item.validation_reasons,
                "train_reasons": item.train_reasons,
                "validation_reasons": item.validation_reasons,
                "settings": optimized_settings_payload(item.settings),
                "metrics": asdict(item.validation_replay.metrics),
                "train_metrics": asdict(item.train_replay.metrics),
                "validation_metrics": asdict(item.validation_replay.metrics),
                "eligible_symbols": item.validation_replay.eligible_symbols,
            }
            for item in results[:10]
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def read_json(path: Path) -> Mapping[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    return payload if isinstance(payload, Mapping) else None


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def optimization_reasons(
    settings: Settings,
    *,
    now: datetime,
    path: Path = OPTIMIZATION_REPORT_PATH,
) -> list[str]:
    payload = read_json(path)
    if payload is None:
        return ["replay optimization report missing"]
    generated_at = parse_timestamp(payload.get("generated_at"))
    if generated_at is None:
        return ["replay optimization timestamp missing"]
    reasons: list[str] = []
    if now - generated_at > timedelta(hours=settings.live_optimization_stale_hours):
        reasons.append("replay optimization report is stale")
    best = payload.get("best")
    if not isinstance(best, Mapping):
        reasons.append("replay optimization has no best candidate")
        return reasons
    if settings.live_require_walk_forward_optimization and payload.get("report_type") != "walk_forward":
        reasons.append("walk-forward optimization report required")
    candidate_reasons = best.get("reasons")
    if isinstance(candidate_reasons, list) and candidate_reasons:
        reasons.extend(str(item) for item in candidate_reasons)
    validation_reasons = best.get("validation_reasons")
    if isinstance(validation_reasons, list) and validation_reasons:
        reasons.extend(str(item) for item in validation_reasons if str(item) not in reasons)
    if settings.live_require_walk_forward_optimization and "validation_metrics" not in best:
        reasons.append("walk-forward validation metrics missing")
    eligible = best.get("eligible_symbols")
    if not isinstance(eligible, list) or not eligible:
        reasons.append("replay optimization has no eligible symbols")
    return reasons


def optimized_settings_from_report(
    settings: Settings,
    *,
    now: datetime,
    path: Path = OPTIMIZATION_REPORT_PATH,
) -> tuple[Settings, list[str]]:
    reasons = optimization_reasons(settings, now=now, path=path)
    if reasons:
        return settings, reasons
    payload = read_json(path)
    best = payload.get("best") if payload else None
    if not isinstance(best, Mapping):
        return settings, ["replay optimization has no best candidate"]
    raw_settings = best.get("settings")
    if not isinstance(raw_settings, Mapping):
        return settings, ["replay optimization settings missing"]
    values: dict[str, object] = {}
    for key in OPTIMIZED_SETTING_KEYS:
        if key in raw_settings:
            values[key] = raw_settings[key]
    try:
        return replace(settings, **values), []
    except TypeError:
        return settings, ["replay optimization settings invalid"]
