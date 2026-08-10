from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean, pstdev
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from .config import DATA_DIR, REPORT_DIR
from .copy_trader import CopyPolicy, PublicTradeSignal, signal_fingerprint


COPY_PRICE_OBSERVATIONS_PATH = DATA_DIR / "copy_price_observations.json"
COPY_KNOWLEDGE_PATH = DATA_DIR / "copy_knowledge.json"
COPY_KNOWLEDGE_MARKDOWN_PATH = REPORT_DIR / "copy_knowledge.md"
HORIZON_DAYS = (1, 5, 20)
HORIZON_TOLERANCE_DAYS = {1: 3, 5: 3, 20: 5}
ALLOWED_PROVENANCE = {"market_snapshot", "paper_fill", "broker_fill", "signal_payload"}
ALLOWED_REGIMES = {"unknown", "bull", "bear", "sideways", "high_volatility", "low_volatility"}


@dataclass(frozen=True)
class PriceObservation:
    signal_fingerprint: str
    observed_at: datetime
    price: float
    provenance: str
    reference: str
    market_regime: str


@dataclass(frozen=True)
class HorizonOutcome:
    horizon_days: int
    status: str
    target_at: str
    observed_at: str | None
    price: float | None
    directional_return: float | None
    provenance: str | None
    reference: str | None


@dataclass(frozen=True)
class SignalOutcome:
    signal_id: str
    signal_fingerprint: str
    source_id: str
    trader_name: str
    symbol: str
    side: str
    disclosed_at: str
    disclosure_lag_hours: float
    baseline_at: str | None
    baseline_price: float | None
    baseline_provenance: str | None
    market_regime: str
    horizons: tuple[HorizonOutcome, ...]
    selected_horizon_days: int | None
    selected_directional_return: float | None
    maximum_adverse_excursion: float | None
    outcome_provenance: str | None
    status: str
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class EvidenceProfile:
    profile_id: str
    source_id: str
    trader_name: str | None
    source_type: str
    mirror_eligible: bool
    sample_size: int
    wins: int
    losses: int
    hit_rate: float
    mean_directional_return: float
    return_volatility: float
    average_maximum_adverse_excursion: float
    risk_adjusted_return: float
    raw_quality_score: float
    posterior_quality_score: float
    delay_reliability: float
    execution_score_cap: float
    evidence_score: float
    evidence_status: str
    provenance_counts: dict[str, int]
    regime_breakdown: dict[str, dict[str, float | int]]


@dataclass(frozen=True)
class CopyKnowledgeReport:
    version: int
    generated_at: str
    methodology: dict[str, Any]
    summary: dict[str, Any]
    source_profiles: tuple[EvidenceProfile, ...]
    trader_profiles: tuple[EvidenceProfile, ...]
    signal_outcomes: tuple[SignalOutcome, ...]
    warnings: tuple[str, ...]


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamp(value: Any, label: str) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{label} is required")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _positive_number(value: Any, label: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a positive number") from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise ValueError(f"{label} must be a positive number")
    return parsed


def _reference(value: Any, provenance: str) -> str:
    reference = str(value or "").strip()
    if not reference or len(reference) > 1000 or any(character in reference for character in "\r\n"):
        raise ValueError("observation reference is required and must be 1000 characters or fewer")
    if provenance == "market_snapshot":
        parsed = urlparse(reference)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("market_snapshot reference must be a public HTTPS URL")
    return reference


def _observation_from_mapping(value: Mapping[str, Any]) -> PriceObservation:
    fingerprint = str(value.get("signal_fingerprint") or "").strip().lower()
    if len(fingerprint) != 64 or any(character not in "0123456789abcdef" for character in fingerprint):
        raise ValueError("signal_fingerprint must be a 64-character SHA-256 hex value")
    provenance = str(value.get("provenance") or "").strip().lower()
    if provenance not in ALLOWED_PROVENANCE:
        raise ValueError(f"provenance must be one of {', '.join(sorted(ALLOWED_PROVENANCE))}")
    regime = str(value.get("market_regime") or "unknown").strip().lower()
    if regime not in ALLOWED_REGIMES:
        raise ValueError(f"market_regime must be one of {', '.join(sorted(ALLOWED_REGIMES))}")
    return PriceObservation(
        signal_fingerprint=fingerprint,
        observed_at=_timestamp(value.get("observed_at"), "observation observed_at"),
        price=_positive_number(value.get("price"), "observation price"),
        provenance=provenance,
        reference=_reference(value.get("reference"), provenance),
        market_regime=regime,
    )


def load_price_observations(path: Path = COPY_PRICE_OBSERVATIONS_PATH) -> tuple[list[PriceObservation], list[str]]:
    if not path.exists():
        return [], ["No copy-price observation ledger exists yet; outcome scores remain neutral until real observations mature."]
    payload = json.loads(path.read_text())
    items = payload.get("observations", []) if isinstance(payload, Mapping) else payload
    if not isinstance(items, list):
        raise ValueError("copy price observations must be an array or an object with an observations array")
    observations: list[PriceObservation] = []
    warnings: list[str] = []
    seen: set[tuple[str, str, str]] = set()
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            warnings.append(f"Observation {index + 1} was ignored because it is not an object.")
            continue
        try:
            observation = _observation_from_mapping(item)
        except ValueError as exc:
            warnings.append(f"Observation {index + 1} was rejected: {exc}.")
            continue
        key = (observation.signal_fingerprint, _iso(observation.observed_at), observation.provenance)
        if key in seen:
            warnings.append(f"Observation {index + 1} duplicated an existing fingerprint/time/provenance row and was ignored.")
            continue
        seen.add(key)
        observations.append(observation)
    return observations, warnings


def capture_signal_price_observations(
    signals: Iterable[PublicTradeSignal],
    *,
    path: Path = COPY_PRICE_OBSERVATIONS_PATH,
    provenance: str = "market_snapshot",
    reference_template: str = "https://finance.yahoo.com/quote/{symbol}",
    market_regime: str = "unknown",
) -> tuple[int, list[str]]:
    """Append auditable current-price snapshots without rewriting historical rows."""
    if provenance not in ALLOWED_PROVENANCE:
        raise ValueError("unsupported observation provenance")
    existing, warnings = load_price_observations(path)
    if not path.exists():
        warnings = []
    rows = [asdict(item) for item in existing]
    for row in rows:
        row["observed_at"] = _iso(row["observed_at"])
    keys = {(item.signal_fingerprint, _iso(item.observed_at), item.provenance) for item in existing}
    added = 0
    for signal in signals:
        if signal.current_price is None or signal.current_price <= 0:
            continue
        if signal.current_price_observed_at < signal.disclosed_at:
            warnings.append(f"{signal.id}: current-price timestamp predates disclosure and was not captured.")
            continue
        key = (signal_fingerprint(signal), _iso(signal.current_price_observed_at), provenance)
        if key in keys:
            continue
        reference = reference_template.format(symbol=signal.symbol)
        observation = PriceObservation(
            signal_fingerprint=key[0],
            observed_at=signal.current_price_observed_at,
            price=signal.current_price,
            provenance=provenance,
            reference=_reference(reference, provenance),
            market_regime=market_regime if market_regime in ALLOWED_REGIMES else "unknown",
        )
        row = asdict(observation)
        row["observed_at"] = _iso(observation.observed_at)
        rows.append(row)
        keys.add(key)
        added += 1
    rows.sort(key=lambda item: (str(item["signal_fingerprint"]), str(item["observed_at"])))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "observations": rows}, indent=2, sort_keys=True) + "\n")
    return added, warnings


def _directional_return(side: str, baseline: float, later: float) -> float:
    raw = (later / baseline) - 1
    return raw if side == "BUY" else -raw if side == "SELL" else 0.0


def _baseline_for_signal(signal: PublicTradeSignal, observations: list[PriceObservation], now: datetime) -> PriceObservation | None:
    candidates = [
        item
        for item in observations
        if signal.disclosed_at <= item.observed_at <= now
    ]
    if (
        signal.initial_observed_price is not None
        and signal.initial_observed_price > 0
        and signal.disclosed_at <= signal.observed_at <= now
    ):
        candidates.append(
            PriceObservation(
                signal_fingerprint=signal_fingerprint(signal),
                observed_at=signal.observed_at,
                price=signal.initial_observed_price,
                provenance="signal_payload",
                reference=signal.source_url,
                market_regime="unknown",
            )
        )
    return min(candidates, key=lambda item: item.observed_at) if candidates else None


def _horizon_outcome(
    signal: PublicTradeSignal,
    baseline: PriceObservation,
    observations: list[PriceObservation],
    horizon_days: int,
    now: datetime,
) -> HorizonOutcome:
    target = baseline.observed_at + timedelta(days=horizon_days)
    if now < target:
        return HorizonOutcome(horizon_days, "not_mature", _iso(target), None, None, None, None, None)
    limit = target + timedelta(days=HORIZON_TOLERANCE_DAYS[horizon_days])
    candidates = [item for item in observations if target <= item.observed_at <= min(limit, now)]
    if not candidates:
        return HorizonOutcome(horizon_days, "missing_observation", _iso(target), None, None, None, None, None)
    observation = min(candidates, key=lambda item: item.observed_at)
    return HorizonOutcome(
        horizon_days=horizon_days,
        status="measured",
        target_at=_iso(target),
        observed_at=_iso(observation.observed_at),
        price=round(observation.price, 8),
        directional_return=round(_directional_return(signal.side, baseline.price, observation.price), 8),
        provenance=observation.provenance,
        reference=observation.reference,
    )


def _signal_outcome(
    signal: PublicTradeSignal,
    observations: list[PriceObservation],
    now: datetime,
) -> SignalOutcome:
    fingerprint = signal_fingerprint(signal)
    matching = sorted(
        [item for item in observations if item.signal_fingerprint == fingerprint and item.observed_at <= now],
        key=lambda item: item.observed_at,
    )
    warnings: list[str] = []
    future_count = sum(item.signal_fingerprint == fingerprint and item.observed_at > now for item in observations)
    if future_count:
        warnings.append(f"Ignored {future_count} observation(s) timestamped after the report's as-of time.")
    baseline = _baseline_for_signal(signal, matching, now)
    disclosure_lag = (signal.disclosed_at - signal.transaction_at).total_seconds() / 3600
    if baseline is None:
        return SignalOutcome(
            signal_id=signal.id,
            signal_fingerprint=fingerprint,
            source_id=signal.source_id,
            trader_name=signal.trader_name,
            symbol=signal.symbol,
            side=signal.side,
            disclosed_at=_iso(signal.disclosed_at),
            disclosure_lag_hours=round(disclosure_lag, 4),
            baseline_at=None,
            baseline_price=None,
            baseline_provenance=None,
            market_regime="unknown",
            horizons=tuple(),
            selected_horizon_days=None,
            selected_directional_return=None,
            maximum_adverse_excursion=None,
            outcome_provenance=None,
            status="missing_baseline",
            warnings=tuple(warnings + ["No real post-disclosure baseline price was available."]),
        )
    future = [item for item in matching if item.observed_at > baseline.observed_at]
    horizons = tuple(_horizon_outcome(signal, baseline, future, days, now) for days in HORIZON_DAYS)
    measured = [item for item in horizons if item.status == "measured" and item.directional_return is not None]
    selected = max(measured, key=lambda item: item.horizon_days) if measured else None
    observed_returns = [_directional_return(signal.side, baseline.price, item.price) for item in future]
    adverse = min([0.0, *observed_returns]) if observed_returns else None
    return SignalOutcome(
        signal_id=signal.id,
        signal_fingerprint=fingerprint,
        source_id=signal.source_id,
        trader_name=signal.trader_name,
        symbol=signal.symbol,
        side=signal.side,
        disclosed_at=_iso(signal.disclosed_at),
        disclosure_lag_hours=round(disclosure_lag, 4),
        baseline_at=_iso(baseline.observed_at),
        baseline_price=round(baseline.price, 8),
        baseline_provenance=baseline.provenance,
        market_regime=baseline.market_regime,
        horizons=horizons,
        selected_horizon_days=selected.horizon_days if selected else None,
        selected_directional_return=selected.directional_return if selected else None,
        maximum_adverse_excursion=round(adverse, 8) if adverse is not None else None,
        outcome_provenance=selected.provenance if selected else None,
        status="measured" if selected else "pending",
        warnings=tuple(warnings),
    )


def _source_metadata(policy: CopyPolicy, source_id: str) -> tuple[str, bool, float]:
    source = next((item for item in policy.sources if item.id == source_id), None)
    if source is None:
        return "unknown", False, 1.0
    return source.source_type, source.mirror_eligible, max(source.max_disclosure_lag_hours, 1.0)


def _regime_breakdown(outcomes: list[SignalOutcome]) -> dict[str, dict[str, float | int]]:
    result: dict[str, dict[str, float | int]] = {}
    for regime in sorted({item.market_regime for item in outcomes}):
        returns = [
            float(item.selected_directional_return)
            for item in outcomes
            if item.market_regime == regime and item.selected_directional_return is not None
        ]
        if returns:
            result[regime] = {
                "sample_size": len(returns),
                "hit_rate": round(sum(value > 0 for value in returns) / len(returns), 6),
                "mean_directional_return": round(fmean(returns), 8),
            }
    return result


def _profile(
    *,
    profile_id: str,
    source_id: str,
    trader_name: str | None,
    outcomes: list[SignalOutcome],
    policy: CopyPolicy,
) -> EvidenceProfile:
    source_type, mirror_eligible, max_lag = _source_metadata(policy, source_id)
    measured = [item for item in outcomes if item.selected_directional_return is not None]
    returns = [float(item.selected_directional_return) for item in measured]
    adverse = [float(item.maximum_adverse_excursion or 0.0) for item in measured]
    sample_size = len(returns)
    wins = sum(value > 0 for value in returns)
    losses = sum(value <= 0 for value in returns)
    hit_rate = wins / sample_size if sample_size else 0.5
    mean_return = fmean(returns) if returns else 0.0
    volatility = pstdev(returns) if len(returns) > 1 else 0.0
    average_adverse = fmean(adverse) if adverse else 0.0
    denominator = max(volatility, abs(average_adverse), 0.02)
    risk_adjusted = mean_return / denominator if sample_size else 0.0
    raw_score = max(
        0.0,
        min(
            1.0,
            0.5
            + (2.0 * mean_return)
            + (0.2 * (hit_rate - 0.5))
            + (0.1 * math.tanh(risk_adjusted))
            - (0.4 * min(abs(average_adverse), 0.25)),
        ),
    )
    sample_weight = sample_size / (sample_size + policy.knowledge_prior_strength)
    posterior = 0.5 + ((raw_score - 0.5) * sample_weight)
    delay_reliabilities = [
        max(0.5, 1.0 - (0.5 * min(max(item.disclosure_lag_hours, 0.0) / max_lag, 1.0)))
        for item in measured
    ]
    delay_reliability = fmean(delay_reliabilities) if delay_reliabilities else 1.0
    delay_adjusted = 0.5 + ((posterior - 0.5) * delay_reliability)
    execution_cap = 1.0 if mirror_eligible else 0.45
    evidence_score = min(delay_adjusted, execution_cap)
    provenance_counts: dict[str, int] = {}
    for item in measured:
        provenance = item.outcome_provenance or "unknown"
        provenance_counts[provenance] = provenance_counts.get(provenance, 0) + 1
    status = "unproven" if sample_size == 0 else "measured" if sample_size >= policy.minimum_knowledge_samples else "small_sample"
    return EvidenceProfile(
        profile_id=profile_id,
        source_id=source_id,
        trader_name=trader_name,
        source_type=source_type,
        mirror_eligible=mirror_eligible,
        sample_size=sample_size,
        wins=wins,
        losses=losses,
        hit_rate=round(hit_rate, 6),
        mean_directional_return=round(mean_return, 8),
        return_volatility=round(volatility, 8),
        average_maximum_adverse_excursion=round(average_adverse, 8),
        risk_adjusted_return=round(risk_adjusted, 6),
        raw_quality_score=round(raw_score, 6),
        posterior_quality_score=round(posterior, 6),
        delay_reliability=round(delay_reliability, 6),
        execution_score_cap=execution_cap,
        evidence_score=round(evidence_score, 6),
        evidence_status=status,
        provenance_counts=provenance_counts,
        regime_breakdown=_regime_breakdown(measured),
    )


def build_copy_knowledge(
    signals: Iterable[PublicTradeSignal],
    observations: Iterable[PriceObservation],
    policy: CopyPolicy,
    *,
    now: datetime | None = None,
    import_warnings: Iterable[str] = (),
) -> CopyKnowledgeReport:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    signal_list = list(signals)
    observation_list = list(observations)
    outcomes = tuple(_signal_outcome(signal, observation_list, current) for signal in signal_list)
    source_ids = sorted({signal.source_id for signal in signal_list} | {source.id for source in policy.sources})
    source_profiles = tuple(
        _profile(
            profile_id=f"source:{source_id}",
            source_id=source_id,
            trader_name=None,
            outcomes=[item for item in outcomes if item.source_id == source_id],
            policy=policy,
        )
        for source_id in source_ids
    )
    trader_keys = sorted({(signal.source_id, signal.trader_name) for signal in signal_list})
    trader_profiles = tuple(
        _profile(
            profile_id=f"trader:{source_id}:{trader_name.casefold()}",
            source_id=source_id,
            trader_name=trader_name,
            outcomes=[item for item in outcomes if item.source_id == source_id and item.trader_name == trader_name],
            policy=policy,
        )
        for source_id, trader_name in trader_keys
    )
    measured = [item for item in outcomes if item.status == "measured"]
    pending = [item for item in outcomes if item.status == "pending"]
    missing = [item for item in outcomes if item.status == "missing_baseline"]
    warnings = list(import_warnings)
    warnings.extend(
        [
            "Scores use only prices observed after public disclosure; transaction-date hindsight is prohibited.",
            "One-, five-, and twenty-day outcomes do not prove a repeatable edge or future profit.",
            "Small samples are shrunk toward a neutral 0.500 score using the configured prior strength.",
            "Delayed or imprecise sources remain research-only even if their historical score is high.",
            "Broker-fill provenance records an observed fill; it does not mean this module placed the order.",
        ]
    )
    return CopyKnowledgeReport(
        version=1,
        generated_at=_iso(current),
        methodology={
            "outcome_clock": "first real price observed at or after public disclosure",
            "horizon_days": list(HORIZON_DAYS),
            "sample_prior_strength": policy.knowledge_prior_strength,
            "minimum_samples_for_gate": policy.minimum_knowledge_samples,
            "minimum_evidence_score": policy.minimum_evidence_score,
            "score_neutral": 0.5,
            "allowed_provenance": sorted(ALLOWED_PROVENANCE),
            "look_ahead_allowed": False,
            "profit_guarantee": False,
        },
        summary={
            "signals_seen": len(signal_list),
            "observations_seen": len(observation_list),
            "measured_outcomes": len(measured),
            "pending_outcomes": len(pending),
            "missing_baselines": len(missing),
            "source_profiles": len(source_profiles),
            "trader_profiles": len(trader_profiles),
            "live_orders_placed": 0,
        },
        source_profiles=source_profiles,
        trader_profiles=trader_profiles,
        signal_outcomes=outcomes,
        warnings=tuple(dict.fromkeys(warnings)),
    )


def copy_knowledge_dict(report: CopyKnowledgeReport) -> dict[str, Any]:
    return asdict(report)


def write_copy_knowledge(
    report: CopyKnowledgeReport,
    json_path: Path = COPY_KNOWLEDGE_PATH,
    markdown_path: Path = COPY_KNOWLEDGE_MARKDOWN_PATH,
) -> tuple[Path, Path]:
    payload = copy_knowledge_dict(report)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    lines = [
        "# Copy Trader Knowledge Ledger",
        "",
        f"Generated: {report.generated_at}",
        "",
        "This ledger measures post-disclosure outcomes. It does not claim that copying a public trader will be profitable.",
        "",
        "## Summary",
        "",
        f"- Signals: {report.summary['signals_seen']}",
        f"- Real price observations: {report.summary['observations_seen']}",
        f"- Measured outcomes: {report.summary['measured_outcomes']}",
        f"- Pending outcomes: {report.summary['pending_outcomes']}",
        f"- Missing baselines: {report.summary['missing_baselines']}",
        "- Live orders placed: 0",
        "",
        "## Source profiles",
        "",
        "| Source | Samples | Hit rate | Mean return | Risk adjusted | Evidence | Status |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for profile in report.source_profiles:
        lines.append(
            f"| {profile.source_id} | {profile.sample_size} | {profile.hit_rate:.1%} | "
            f"{profile.mean_directional_return:.2%} | {profile.risk_adjusted_return:.3f} | "
            f"{profile.evidence_score:.3f} | {profile.evidence_status} |"
        )
    lines.extend(["", "## Warnings", ""])
    lines.extend(f"- {warning}" for warning in report.warnings)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("\n".join(lines).rstrip() + "\n")
    return json_path, markdown_path


def load_copy_knowledge(path: Path = COPY_KNOWLEDGE_PATH) -> Mapping[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, Mapping) else None
