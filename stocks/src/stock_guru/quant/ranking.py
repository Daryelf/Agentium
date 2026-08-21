from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from typing import Mapping, Sequence

from ..config import DATA_DIR
from ..market_calendar import EASTERN
from ..market_context import MarketRegimeReport
from .context import SymbolContextSnapshot
from .models import PriceZone, QuantFeatureSnapshot
from .portfolio import PositionSizeSuggestion
from .scoring import ArgentumScoreCard, clamp


ANALYSIS_LATEST_PATH = DATA_DIR / "analysis_latest.json"
ANALYSIS_HISTORY_DIR = DATA_DIR / "analysis_snapshots"


@dataclass(frozen=True)
class StandardAnalysisObject:
    version: int
    generated_at: str
    symbol: str
    price: float | None
    scores: Mapping[str, float | None]
    percentiles: Mapping[str, float | None]
    rankings: Mapping[str, int | None]
    timeframes: Mapping[str, str]
    market_regime: str
    action: str
    entry_setup: str
    positive_factors: tuple[str, ...]
    negative_factors: tuple[str, ...]
    red_flags: tuple[str, ...]
    support: tuple[PriceZone, ...]
    resistance: tuple[PriceZone, ...]
    earnings: Mapping[str, object]
    portfolio_impact: Mapping[str, object]
    position_sizing: Mapping[str, object]
    data_quality: Mapping[str, object]
    methodology: Mapping[str, object]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class UniverseRankingReport:
    version: int
    generated_at: str
    universe_size: int
    views: Mapping[str, tuple[str, ...]]
    analyses: Mapping[str, StandardAnalysisObject]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def risk_adjusted_opportunity(final_score: float | None, confidence: float | None, risk: float | None) -> float | None:
    if final_score is None or confidence is None or risk is None:
        return None
    quality = clamp(final_score) / 100.0
    evidence = clamp(confidence) / 100.0
    safety = max(0.0, 1.0 - clamp(risk) / 125.0)
    return round(clamp(quality * evidence * safety * 100.0), 2)


def build_analysis_object(
    snapshot: QuantFeatureSnapshot,
    context: SymbolContextSnapshot,
    score: ArgentumScoreCard,
    regime: MarketRegimeReport,
    *,
    position: PositionSizeSuggestion | None = None,
) -> StandardAnalysisObject:
    component_scores = asdict(score.components)
    scores = {
        **component_scores,
        "risk": score.risk_score,
        "quant": score.quant_score,
        "confidence": score.confidence_score,
        "market_regime": score.market_regime_score,
        "final": score.final_score,
        "risk_adjusted_opportunity": risk_adjusted_opportunity(score.final_score, score.confidence_score, score.risk_score),
    }
    sizing = position.to_dict() if position else {}
    return StandardAnalysisObject(
        version=1,
        generated_at=score.generated_at,
        symbol=snapshot.symbol,
        price=snapshot.price,
        scores=scores,
        percentiles={},
        rankings={},
        timeframes={
            "short": context.timeframes.short,
            "medium": context.timeframes.medium,
            "long": context.timeframes.long,
            "alignment": context.timeframes.alignment,
        },
        market_regime=regime.regime,
        action=score.action,
        entry_setup=score.entry_setup,
        positive_factors=score.positive_factors,
        negative_factors=score.negative_factors,
        red_flags=score.red_flags,
        support=snapshot.support_zones,
        resistance=snapshot.resistance_zones,
        earnings=asdict(context.earnings),
        portfolio_impact=asdict(position.portfolio_impact) if position else {},
        position_sizing={
            "suggested_position_pct": sizing.get("suggested_position_pct"),
            "suggested_dollars": sizing.get("suggested_dollars"),
            "suggested_shares": sizing.get("suggested_shares"),
            "max_risk_pct": sizing.get("max_risk_pct"),
            "stop_price": sizing.get("stop_price"),
            "blockers": sizing.get("blockers", []),
        } if position else {},
        data_quality={
            "status": snapshot.feature_status,
            "source_status": snapshot.source_data_status,
            "provider": snapshot.source_provider,
            "quality_score": snapshot.source_quality_score,
            "last_updated": snapshot.source_updated_at or snapshot.as_of,
            "bars": snapshot.bars,
            "warnings": snapshot.warnings,
        },
        methodology={
            **score.methodology,
            "risk_adjusted_opportunity": "final_score x confidence x bounded safety factor; no division by zero or near-zero risk",
            "recommendation": "analytical output only; accepted broker trades still require exact Human Gate approval and independent reconciliation",
        },
    )


def _percentile_map(values: Mapping[str, float | None], *, lower_is_better: bool = False) -> dict[str, float | None]:
    available = {symbol: float(value) for symbol, value in values.items() if value is not None and math.isfinite(float(value))}
    if not available:
        return {symbol: None for symbol in values}
    if len(available) == 1:
        only = next(iter(available))
        return {symbol: 100.0 if symbol == only else None for symbol in values}
    sorted_values = sorted(set(available.values()), reverse=lower_is_better)
    positions = {value: index for index, value in enumerate(sorted_values)}
    denominator = max(1, len(sorted_values) - 1)
    result: dict[str, float | None] = {}
    for symbol in values:
        value = available.get(symbol)
        result[symbol] = round(positions[value] / denominator * 100.0, 2) if value is not None else None
    return result


def _ordered(
    analyses: Mapping[str, StandardAnalysisObject],
    score_name: str,
    *,
    ascending: bool = False,
    eligible: Sequence[str] | None = None,
) -> tuple[str, ...]:
    allowed = set(eligible) if eligible is not None else set(analyses)
    pairs = [
        (symbol, item.scores.get(score_name))
        for symbol, item in analyses.items()
        if symbol in allowed and item.scores.get(score_name) is not None
    ]
    pairs.sort(key=lambda item: (float(item[1]), item[0]), reverse=not ascending)
    return tuple(symbol for symbol, _ in pairs)


def rank_analysis_objects(
    analyses: Mapping[str, StandardAnalysisObject],
    *,
    generated_at: datetime | None = None,
) -> UniverseRankingReport:
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    numeric_names = sorted({name for item in analyses.values() for name, value in item.scores.items() if value is not None})
    percentile_by_score = {
        name: _percentile_map({symbol: item.scores.get(name) for symbol, item in analyses.items()}, lower_is_better=name == "risk")
        for name in numeric_names
    }
    breakout_symbols = [symbol for symbol, item in analyses.items() if "BREAKOUT" in item.entry_setup]
    reversal_symbols = [symbol for symbol, item in analyses.items() if "REVERSAL" in item.entry_setup]
    views = {
        "best_overall": _ordered(analyses, "final"),
        "best_momentum": _ordered(analyses, "momentum"),
        "best_value": _ordered(analyses, "fundamentals"),
        "best_relative_strength": _ordered(analyses, "relative_strength"),
        "best_breakout": _ordered(analyses, "entry_quality", eligible=breakout_symbols),
        "best_reversal": _ordered(analyses, "entry_quality", eligible=reversal_symbols),
        "lowest_risk": _ordered(analyses, "risk", ascending=True),
        "best_risk_adjusted_opportunity": _ordered(analyses, "risk_adjusted_opportunity"),
    }
    ranking_positions = {
        view: {symbol: index + 1 for index, symbol in enumerate(symbols)}
        for view, symbols in views.items()
    }
    enriched: dict[str, StandardAnalysisObject] = {}
    for symbol, item in analyses.items():
        enriched[symbol] = replace(
            item,
            percentiles={name: values.get(symbol) for name, values in percentile_by_score.items()},
            rankings={view: positions.get(symbol) for view, positions in ranking_positions.items()},
        )
    return UniverseRankingReport(
        version=1,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        universe_size=len(enriched),
        views=views,
        analyses=enriched,
    )


def _write_json(payload: Mapping[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n")
    os.replace(temporary, path)


def write_analysis_report(
    report: UniverseRankingReport,
    *,
    latest_path: Path = ANALYSIS_LATEST_PATH,
    history_dir: Path = ANALYSIS_HISTORY_DIR,
) -> tuple[Path, Path]:
    payload = report.to_dict()
    generated = datetime.fromisoformat(report.generated_at)
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)
    daily_path = history_dir / f"{generated.astimezone(EASTERN).date().isoformat()}.json"
    _write_json(payload, daily_path)
    _write_json(payload, latest_path)
    return latest_path, daily_path
