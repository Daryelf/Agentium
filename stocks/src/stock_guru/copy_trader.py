from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from .config import CONFIG_DIR, DATA_DIR, LEDGER_PATH, REPORT_DIR
from .paper import PaperTrade, record_trade


COPY_TRADER_CONFIG_PATH = CONFIG_DIR / "copy_trader.json"
COPY_SIGNALS_PATH = DATA_DIR / "copy_signals.json"
COPY_HISTORY_PATH = DATA_DIR / "copy_mirror_history.json"
COPY_PLAN_PATH = REPORT_DIR / "copy_trader_plan.json"
COPY_PLAN_MARKDOWN_PATH = REPORT_DIR / "copy_trader_plan.md"
SAFE_EXECUTION_MODE = "paper_and_human_gate_only"
SUPPORTED_EQUITY_TRANSACTION_CODES = {"P", "S"}


@dataclass(frozen=True)
class CopySource:
    id: str
    name: str
    source_type: str
    enabled: bool
    mirror_eligible: bool
    max_disclosure_lag_hours: float
    notes: str = ""


@dataclass(frozen=True)
class CopyPolicy:
    version: int
    execution_mode: str
    total_budget_dollars: float
    max_trade_dollars: float
    max_daily_notional_dollars: float
    max_source_allocation_pct: float
    min_trade_dollars: float
    minimum_confidence: float
    max_price_drift_pct: float
    max_signal_age_hours: float
    max_current_price_age_hours: float
    allowed_asset_types: tuple[str, ...]
    research_only_asset_types: tuple[str, ...]
    sources: tuple[CopySource, ...]
    knowledge_prior_strength: float = 20.0
    minimum_knowledge_samples: int = 8
    minimum_evidence_score: float = 0.40


@dataclass(frozen=True)
class PublicTradeSignal:
    id: str
    source_id: str
    trader_name: str
    asset_type: str
    symbol: str
    side: str
    transaction_code: str
    transaction_at: datetime
    disclosed_at: datetime
    observed_at: datetime
    source_url: str
    signal_price: float | None
    initial_observed_price: float | None
    current_price: float | None
    current_price_observed_at: datetime
    confidence: float
    current_position_shares: float
    notes: str


@dataclass(frozen=True)
class MirrorCandidate:
    id: str
    fingerprint: str
    source_id: str
    source_name: str
    trader_name: str
    asset_type: str
    symbol: str
    side: str
    transaction_code: str
    transaction_at: str
    disclosed_at: str
    observed_at: str
    source_url: str
    disclosure_lag_hours: float
    signal_age_hours: float
    signal_price: float | None
    current_price: float | None
    current_price_observed_at: str
    current_price_age_hours: float
    price_drift_pct: float | None
    confidence: float
    evidence_score: float
    evidence_status: str
    source_evidence_samples: int
    trader_evidence_samples: int
    ranking_score: float
    status: str
    mirror_notional_dollars: float
    mirror_shares: float
    human_gate_eligible: bool
    broker_position_required: bool
    reasons: tuple[str, ...]
    notes: str


@dataclass(frozen=True)
class MirrorPlan:
    version: int
    generated_at: str
    mode: str
    policy: dict[str, Any]
    sources: tuple[dict[str, Any], ...]
    summary: dict[str, Any]
    candidates: tuple[MirrorCandidate, ...]
    warnings: tuple[str, ...]


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed != parsed or parsed in {float("inf"), float("-inf")}:
        return default
    return parsed


def _bounded_number(value: Any, minimum: float, maximum: float, label: str) -> float:
    parsed = _number(value)
    if parsed is None or parsed < minimum or parsed > maximum:
        raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
    return parsed


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


def _clean_symbol(value: Any) -> str:
    symbol = "".join(character for character in str(value or "").upper().strip() if character.isalnum() or character in ".-_:")
    if not symbol or len(symbol) > 80:
        raise ValueError("symbol is required and must be 80 characters or fewer")
    return symbol


def _safe_public_url(value: Any) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("source_url must be a public HTTPS URL without embedded credentials")
    return url[:1000]


def _source_from_mapping(value: Mapping[str, Any]) -> CopySource:
    source_id = str(value.get("id") or "").strip().lower()
    if not source_id:
        raise ValueError("copy source id is required")
    return CopySource(
        id=source_id,
        name=str(value.get("name") or source_id).strip()[:160],
        source_type=str(value.get("source_type") or "public_signal").strip()[:80],
        enabled=bool(value.get("enabled", False)),
        mirror_eligible=bool(value.get("mirror_eligible", False)),
        max_disclosure_lag_hours=_bounded_number(value.get("max_disclosure_lag_hours", 0), 0, 24 * 365, "source max disclosure lag"),
        notes=str(value.get("notes") or "").strip()[:1000],
    )


def load_copy_policy(path: Path = COPY_TRADER_CONFIG_PATH) -> CopyPolicy:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("copy trader config must be a JSON object")
    execution_mode = str(payload.get("execution_mode") or "")
    if execution_mode != SAFE_EXECUTION_MODE:
        raise ValueError(f"copy trader execution_mode must remain {SAFE_EXECUTION_MODE}")
    sources = tuple(_source_from_mapping(item) for item in payload.get("sources", []) if isinstance(item, Mapping))
    if not sources:
        raise ValueError("copy trader config requires at least one source")
    if len({source.id for source in sources}) != len(sources):
        raise ValueError("copy trader source ids must be unique")
    knowledge = payload.get("knowledge", {})
    if not isinstance(knowledge, Mapping):
        raise ValueError("copy trader knowledge policy must be an object")
    return CopyPolicy(
        version=int(payload.get("version", 1)),
        execution_mode=execution_mode,
        total_budget_dollars=_bounded_number(payload.get("total_budget_dollars"), 1, 1_000_000, "total budget"),
        max_trade_dollars=_bounded_number(payload.get("max_trade_dollars"), 0.01, 1_000_000, "max trade dollars"),
        max_daily_notional_dollars=_bounded_number(payload.get("max_daily_notional_dollars"), 0.01, 1_000_000, "max daily notional"),
        max_source_allocation_pct=_bounded_number(payload.get("max_source_allocation_pct"), 0.001, 1, "max source allocation"),
        min_trade_dollars=_bounded_number(payload.get("min_trade_dollars"), 0.01, 1_000_000, "min trade dollars"),
        minimum_confidence=_bounded_number(payload.get("minimum_confidence"), 0, 1, "minimum confidence"),
        max_price_drift_pct=_bounded_number(payload.get("max_price_drift_pct"), 0, 1, "max price drift"),
        max_signal_age_hours=_bounded_number(payload.get("max_signal_age_hours"), 0.01, 24 * 365, "max signal age"),
        max_current_price_age_hours=_bounded_number(payload.get("max_current_price_age_hours", 24), 0.01, 24 * 30, "max current price age"),
        allowed_asset_types=tuple(str(item).strip().lower() for item in payload.get("allowed_asset_types", []) if str(item).strip()),
        research_only_asset_types=tuple(str(item).strip().lower() for item in payload.get("research_only_asset_types", []) if str(item).strip()),
        sources=sources,
        knowledge_prior_strength=_bounded_number(knowledge.get("prior_strength", 20), 1, 10_000, "knowledge prior strength"),
        minimum_knowledge_samples=int(_bounded_number(knowledge.get("minimum_samples_for_gate", 8), 1, 10_000, "minimum knowledge samples")),
        minimum_evidence_score=_bounded_number(knowledge.get("minimum_evidence_score", 0.40), 0, 1, "minimum evidence score"),
    )


def _signal_from_mapping(value: Mapping[str, Any]) -> PublicTradeSignal:
    asset_type = str(value.get("asset_type") or "equity").strip().lower()
    side = str(value.get("side") or "").strip().upper()
    if side not in {"BUY", "SELL", "YES", "NO"}:
        raise ValueError("side must be BUY, SELL, YES, or NO")
    disclosed_at = _timestamp(value.get("disclosed_at"), "disclosed_at")
    observed_at = _timestamp(value.get("observed_at") or value.get("disclosed_at"), "observed_at")
    current_price_observed_at = _timestamp(
        value.get("current_price_observed_at") or value.get("observed_at") or value.get("disclosed_at"),
        "current_price_observed_at",
    )
    return PublicTradeSignal(
        id=str(value.get("id") or "").strip()[:160],
        source_id=str(value.get("source_id") or "").strip().lower()[:80],
        trader_name=str(value.get("trader_name") or "Unknown public source").strip()[:160],
        asset_type=asset_type,
        symbol=_clean_symbol(value.get("symbol")),
        side=side,
        transaction_code=str(value.get("transaction_code") or "").strip().upper()[:12],
        transaction_at=_timestamp(value.get("transaction_at"), "transaction_at"),
        disclosed_at=disclosed_at,
        observed_at=observed_at,
        source_url=_safe_public_url(value.get("source_url")),
        signal_price=_number(value.get("signal_price")),
        initial_observed_price=_number(value.get("initial_observed_price", value.get("current_price"))),
        current_price=_number(value.get("current_price")),
        current_price_observed_at=current_price_observed_at,
        confidence=_bounded_number(value.get("confidence", 0), 0, 1, "signal confidence"),
        current_position_shares=max(0.0, _number(value.get("current_position_shares"), 0.0) or 0.0),
        notes=str(value.get("notes") or "").strip()[:1000],
    )


def load_public_signals(path: Path = COPY_SIGNALS_PATH) -> tuple[list[PublicTradeSignal], list[str]]:
    if not path.exists():
        return [], ["No signal inbox found. Create local data/copy_signals.json from the example schema or connect an approved public-data importer."]
    payload = json.loads(path.read_text())
    items = payload.get("signals", []) if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ValueError("copy signals JSON must be an array or an object with a signals array")
    signals: list[PublicTradeSignal] = []
    warnings: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            warnings.append(f"Signal {index + 1} was ignored because it is not an object.")
            continue
        try:
            signals.append(_signal_from_mapping(item))
        except ValueError as exc:
            warnings.append(f"Signal {index + 1} was rejected during import: {exc}.")
    return signals, warnings


def signal_fingerprint(signal: PublicTradeSignal) -> str:
    identity = "|".join(
        [
            signal.source_id,
            signal.id,
            signal.trader_name.casefold(),
            signal.asset_type,
            signal.symbol,
            signal.side,
            signal.transaction_code,
            signal.transaction_at.isoformat(),
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def load_copy_history(path: Path = COPY_HISTORY_PATH) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return set()
    items = payload.get("applied", []) if isinstance(payload, dict) else []
    return {str(item.get("fingerprint")) for item in items if isinstance(item, Mapping) and item.get("fingerprint")}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _profile_index(knowledge: Mapping[str, Any] | None, key: str, identity_key: str) -> dict[str, Mapping[str, Any]]:
    if not isinstance(knowledge, Mapping):
        return {}
    profiles = knowledge.get(key, [])
    if not isinstance(profiles, (list, tuple)):
        return {}
    result: dict[str, Mapping[str, Any]] = {}
    for profile in profiles:
        if not isinstance(profile, Mapping):
            continue
        identity = str(profile.get(identity_key) or "").strip().casefold()
        if key == "trader_profiles":
            source_id = str(profile.get("source_id") or "").strip().casefold()
            identity = f"{source_id}|{identity}"
        if identity:
            result[identity] = profile
    return result


def _knowledge_for_signal(
    signal: PublicTradeSignal,
    knowledge: Mapping[str, Any] | None,
    policy: CopyPolicy,
) -> tuple[float, str, int, int]:
    source_profile = _profile_index(knowledge, "source_profiles", "source_id").get(signal.source_id.casefold())
    trader_key = f"{signal.source_id.casefold()}|{signal.trader_name.casefold()}"
    trader_profile = _profile_index(knowledge, "trader_profiles", "trader_name").get(trader_key)
    source_samples = int(_number(source_profile.get("sample_size"), 0) or 0) if source_profile else 0
    trader_samples = int(_number(trader_profile.get("sample_size"), 0) or 0) if trader_profile else 0
    weighted: list[tuple[float, int]] = []
    if source_profile:
        weighted.append((_bounded_profile_score(source_profile.get("evidence_score")), max(1, source_samples)))
    if trader_profile:
        weighted.append((_bounded_profile_score(trader_profile.get("evidence_score")), max(1, trader_samples)))
    evidence_score = (
        sum(score * weight for score, weight in weighted) / sum(weight for _, weight in weighted)
        if weighted
        else 0.5
    )
    total_samples = max(source_samples, trader_samples)
    evidence_status = (
        "unproven"
        if total_samples == 0
        else "measured"
        if total_samples >= policy.minimum_knowledge_samples
        else "small_sample"
    )
    return round(evidence_score, 6), evidence_status, source_samples, trader_samples


def _bounded_profile_score(value: Any) -> float:
    return min(1.0, max(0.0, _number(value, 0.5) or 0.0))


def _candidate_for_signal(
    signal: PublicTradeSignal,
    policy: CopyPolicy,
    sources: Mapping[str, CopySource],
    *,
    now: datetime,
    seen: set[str],
    daily_remaining: float,
    source_allocated: Mapping[str, float],
    knowledge: Mapping[str, Any] | None,
) -> MirrorCandidate:
    fingerprint = signal_fingerprint(signal)
    source = sources.get(signal.source_id)
    disclosure_lag = (signal.disclosed_at - signal.transaction_at).total_seconds() / 3600
    signal_age = (now - signal.disclosed_at).total_seconds() / 3600
    current_price_age = (now - signal.current_price_observed_at).total_seconds() / 3600
    price_drift = None
    if signal.signal_price and signal.signal_price > 0 and signal.current_price and signal.current_price > 0:
        price_drift = abs(signal.current_price - signal.signal_price) / signal.signal_price
    evidence_score, evidence_status, source_evidence_samples, trader_evidence_samples = _knowledge_for_signal(
        signal,
        knowledge,
        policy,
    )
    ranking_score = (signal.confidence * 0.65) + (evidence_score * 0.35)

    reasons: list[str] = []
    status = "paper_ready"
    broker_position_required = False
    if fingerprint in seen:
        status = "duplicate"
        reasons.append("This exact public signal is already in the mirror history or the current batch.")
    elif source is None:
        status = "rejected"
        reasons.append("The signal source is not allowlisted in copy_trader.json.")
    elif not source.enabled:
        status = "research_only"
        reasons.append("The public source is disabled until the operator verifies and enables it.")
    elif signal.disclosed_at < signal.transaction_at:
        status = "rejected"
        reasons.append("Disclosure time is earlier than the reported transaction time.")
    elif signal.transaction_at > now or signal.disclosed_at > now:
        status = "rejected"
        reasons.append("The signal contains a future transaction or disclosure timestamp.")
    elif signal.observed_at < signal.disclosed_at or signal.observed_at > now:
        status = "rejected"
        reasons.append("The signal's first-observed timestamp is outside its valid post-disclosure window.")
    elif signal.current_price_observed_at < signal.disclosed_at or signal.current_price_observed_at > now:
        status = "research_only"
        reasons.append("The current-price timestamp is outside its valid post-disclosure window.")
    elif current_price_age > policy.max_current_price_age_hours:
        status = "research_only"
        reasons.append("The current price is older than the configured freshness window; refresh before sizing.")
    elif signal.asset_type in policy.research_only_asset_types:
        status = "research_only"
        reasons.append("This asset type is research-only; the current broker adapter has no authorized execution path for it.")
    elif signal.asset_type not in policy.allowed_asset_types:
        status = "rejected"
        reasons.append("The asset type is outside the mirror allowlist.")
    elif not source.mirror_eligible:
        status = "research_only"
        reasons.append("The disclosure source is too delayed or imprecise to treat as a copy order.")
    elif disclosure_lag < 0 or disclosure_lag > source.max_disclosure_lag_hours:
        status = "research_only"
        reasons.append("Disclosure delay exceeds this source's mirror limit.")
    elif signal_age < 0 or signal_age > policy.max_signal_age_hours:
        status = "research_only"
        reasons.append("The disclosed signal is outside the configured freshness window.")
    elif signal.confidence < policy.minimum_confidence:
        status = "research_only"
        reasons.append("Signal confidence is below the configured minimum.")
    elif (
        max(source_evidence_samples, trader_evidence_samples) >= policy.minimum_knowledge_samples
        and evidence_score < policy.minimum_evidence_score
    ):
        status = "research_only"
        reasons.append("Measured source/trader outcomes are below the configured evidence-quality floor.")
    elif signal.asset_type == "equity" and signal.transaction_code not in SUPPORTED_EQUITY_TRANSACTION_CODES:
        status = "research_only"
        reasons.append("Only Form 4 open-market purchase/sale codes P and S can become mirror candidates.")
    elif signal.asset_type == "equity" and (
        (signal.transaction_code == "P" and signal.side != "BUY")
        or (signal.transaction_code == "S" and signal.side != "SELL")
    ):
        status = "research_only"
        reasons.append("The reported acquisition/disposition direction conflicts with the Form 4 transaction code.")
    elif signal.current_price is None or signal.current_price <= 0:
        status = "research_only"
        reasons.append("A current positive price is required before position sizing.")
    elif signal.signal_price is None or signal.signal_price <= 0:
        status = "research_only"
        reasons.append("The source did not disclose a usable transaction price.")
    elif price_drift is None or price_drift > policy.max_price_drift_pct:
        status = "research_only"
        reasons.append("Current price moved too far from the disclosed transaction price; chasing is blocked.")
    elif signal.side == "SELL" and signal.current_position_shares <= 0:
        status = "research_only"
        broker_position_required = True
        reasons.append("No paper shares were supplied to reduce. A copy sell cannot create a short position, but Stock Office may review this signal only after a fresh official broker snapshot proves owned shares.")

    mirror_notional = 0.0
    mirror_shares = 0.0
    if status == "paper_ready" and signal.current_price:
        per_source_limit = policy.total_budget_dollars * policy.max_source_allocation_pct
        remaining_source = max(0.0, per_source_limit - float(source_allocated.get(signal.source_id, 0.0)))
        mirror_notional = min(policy.max_trade_dollars, daily_remaining, remaining_source)
        if signal.side == "SELL":
            mirror_notional = min(mirror_notional, signal.current_position_shares * signal.current_price)
        if mirror_notional < policy.min_trade_dollars:
            status = "research_only"
            reasons.append("The remaining daily or per-source budget is below the minimum paper trade size.")
            mirror_notional = 0.0
        else:
            mirror_shares = mirror_notional / signal.current_price
            reasons.append("Passed public-source, delay, freshness, price-drift, and bankroll checks for paper mirroring.")
            if evidence_status == "unproven":
                reasons.append("Source performance is unproven; the evidence score remains neutral until real post-disclosure outcomes mature.")
            elif evidence_status == "small_sample":
                reasons.append("Source performance is based on a small sample and is shrunk toward neutral.")
            else:
                reasons.append(f"Measured source/trader evidence score: {evidence_score:.3f}.")
            reasons.append("Any real broker order remains a separate Human Gate review; this plan cannot submit it.")

    return MirrorCandidate(
        id=signal.id or f"mirror-{fingerprint[:12]}",
        fingerprint=fingerprint,
        source_id=signal.source_id,
        source_name=source.name if source else "Unknown source",
        trader_name=signal.trader_name,
        asset_type=signal.asset_type,
        symbol=signal.symbol,
        side=signal.side,
        transaction_code=signal.transaction_code,
        transaction_at=_iso(signal.transaction_at),
        disclosed_at=_iso(signal.disclosed_at),
        observed_at=_iso(signal.observed_at),
        source_url=signal.source_url,
        disclosure_lag_hours=round(disclosure_lag, 4),
        signal_age_hours=round(signal_age, 4),
        signal_price=signal.signal_price,
        current_price=signal.current_price,
        current_price_observed_at=_iso(signal.current_price_observed_at),
        current_price_age_hours=round(current_price_age, 4),
        price_drift_pct=round(price_drift, 6) if price_drift is not None else None,
        confidence=signal.confidence,
        evidence_score=evidence_score,
        evidence_status=evidence_status,
        source_evidence_samples=source_evidence_samples,
        trader_evidence_samples=trader_evidence_samples,
        ranking_score=round(ranking_score, 6),
        status=status,
        mirror_notional_dollars=round(mirror_notional, 2),
        mirror_shares=round(mirror_shares, 8),
        human_gate_eligible=status == "paper_ready",
        broker_position_required=broker_position_required,
        reasons=tuple(reasons),
        notes=signal.notes,
    )


def build_mirror_plan(
    signals: Iterable[PublicTradeSignal],
    policy: CopyPolicy,
    *,
    now: datetime | None = None,
    history_fingerprints: set[str] | None = None,
    import_warnings: Iterable[str] = (),
    knowledge: Mapping[str, Any] | None = None,
) -> MirrorPlan:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    source_map = {source.id: source for source in policy.sources}
    seen = set(history_fingerprints or set())
    candidates: list[MirrorCandidate] = []
    daily_allocated = 0.0
    source_allocated: dict[str, float] = {}
    ordered_signals = sorted(
        signals,
        key=lambda item: (
            (item.confidence * 0.65) + (_knowledge_for_signal(item, knowledge, policy)[0] * 0.35),
            item.disclosed_at,
        ),
        reverse=True,
    )
    for signal in ordered_signals:
        candidate = _candidate_for_signal(
            signal,
            policy,
            source_map,
            now=current,
            seen=seen,
            daily_remaining=max(0.0, policy.max_daily_notional_dollars - daily_allocated),
            source_allocated=source_allocated,
            knowledge=knowledge,
        )
        candidates.append(candidate)
        seen.add(candidate.fingerprint)
        if candidate.status == "paper_ready":
            daily_allocated += candidate.mirror_notional_dollars
            source_allocated[candidate.source_id] = source_allocated.get(candidate.source_id, 0.0) + candidate.mirror_notional_dollars

    counts = {status: sum(item.status == status for item in candidates) for status in ["paper_ready", "research_only", "rejected", "duplicate"]}
    warnings = list(import_warnings)
    warnings.extend(
        [
            "Copying public disclosures cannot reproduce the original trader's entry price, timing, hedges, exits, taxes, or full portfolio context.",
            "SEC Form 13F and congressional PTR data are deliberately research-only because disclosure can arrive weeks after the transaction.",
            "Robinhood event contracts remain research-only here; the current adapter has no authorized event-contract order interface.",
            "No live order, account action, deposit, or money movement is available from this plan.",
        ]
    )
    return MirrorPlan(
        version=1,
        generated_at=_iso(current),
        mode=policy.execution_mode,
        policy={
            "total_budget_dollars": policy.total_budget_dollars,
            "max_trade_dollars": policy.max_trade_dollars,
            "max_daily_notional_dollars": policy.max_daily_notional_dollars,
            "max_source_allocation_pct": policy.max_source_allocation_pct,
            "min_trade_dollars": policy.min_trade_dollars,
            "minimum_confidence": policy.minimum_confidence,
            "max_price_drift_pct": policy.max_price_drift_pct,
            "max_signal_age_hours": policy.max_signal_age_hours,
            "max_current_price_age_hours": policy.max_current_price_age_hours,
            "allowed_asset_types": list(policy.allowed_asset_types),
            "research_only_asset_types": list(policy.research_only_asset_types),
            "knowledge": {
                "prior_strength": policy.knowledge_prior_strength,
                "minimum_samples_for_gate": policy.minimum_knowledge_samples,
                "minimum_evidence_score": policy.minimum_evidence_score,
            },
        },
        sources=tuple(asdict(source) for source in policy.sources),
        summary={
            "signals_received": len(candidates),
            **counts,
            "planned_paper_notional_dollars": round(daily_allocated, 2),
            "live_orders_placed": 0,
            "human_gate_required_for_live": True,
            "knowledge_profiles_loaded": bool(knowledge),
        },
        candidates=tuple(candidates),
        warnings=tuple(dict.fromkeys(warnings)),
    )


def mirror_plan_dict(plan: MirrorPlan) -> dict[str, Any]:
    return {
        "version": plan.version,
        "generated_at": plan.generated_at,
        "mode": plan.mode,
        "policy": plan.policy,
        "sources": list(plan.sources),
        "summary": plan.summary,
        "candidates": [asdict(candidate) for candidate in plan.candidates],
        "warnings": list(plan.warnings),
    }


def write_mirror_plan(
    plan: MirrorPlan,
    json_path: Path = COPY_PLAN_PATH,
    markdown_path: Path = COPY_PLAN_MARKDOWN_PATH,
) -> tuple[Path, Path]:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(mirror_plan_dict(plan), indent=2, sort_keys=True) + "\n")
    lines = [
        "# Copy Trader Mirror Plan",
        "",
        f"Generated: {plan.generated_at}",
        f"Mode: {plan.mode}",
        "",
        "This report can create paper mirror candidates and Human Gate review packages. It cannot place a live broker order.",
        "",
        "## Summary",
        "",
        f"- Signals received: {plan.summary['signals_received']}",
        f"- Paper-ready: {plan.summary['paper_ready']}",
        f"- Research-only: {plan.summary['research_only']}",
        f"- Rejected: {plan.summary['rejected']}",
        f"- Duplicates: {plan.summary['duplicate']}",
        f"- Planned paper notional: ${plan.summary['planned_paper_notional_dollars']:.2f}",
        "- Live orders placed: 0",
        "",
        "## Candidates",
        "",
    ]
    if not plan.candidates:
        lines.extend(["- No public signals were imported.", ""])
    else:
        for candidate in plan.candidates:
            lines.extend(
                [
                    f"### {candidate.side} {candidate.symbol} - {candidate.status}",
                    "",
                    f"- Public source: {candidate.source_name}",
                    f"- Reported trader: {candidate.trader_name}",
                    f"- Transaction: {candidate.transaction_at}",
                    f"- Disclosed: {candidate.disclosed_at} ({candidate.disclosure_lag_hours:.1f}h lag)",
                    f"- Current price observed: {candidate.current_price_observed_at} ({candidate.current_price_age_hours:.1f}h old)",
                    f"- Evidence: {candidate.evidence_score:.3f} ({candidate.evidence_status}; source samples {candidate.source_evidence_samples}, trader samples {candidate.trader_evidence_samples})",
                    f"- Planned paper notional: ${candidate.mirror_notional_dollars:.2f}",
                    f"- Broker position required for exit review: {'yes' if candidate.broker_position_required else 'no'}",
                    f"- Provenance: {candidate.source_url}",
                    f"- Reasons: {'; '.join(candidate.reasons) or 'none recorded'}",
                    "",
                ]
            )
    lines.extend(["## Warnings", ""])
    lines.extend(f"- {warning}" for warning in plan.warnings)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("\n".join(lines).rstrip() + "\n")
    return json_path, markdown_path


def apply_paper_candidates(
    plan: MirrorPlan,
    *,
    timezone_name: str = "America/New_York",
    ledger_path: Path = LEDGER_PATH,
    history_path: Path = COPY_HISTORY_PATH,
) -> list[PaperTrade]:
    existing_payload: dict[str, Any] = {"applied": []}
    if history_path.exists():
        try:
            loaded = json.loads(history_path.read_text())
            if isinstance(loaded, dict) and isinstance(loaded.get("applied"), list):
                existing_payload = loaded
        except (OSError, json.JSONDecodeError):
            existing_payload = {"applied": []}
    applied_fingerprints = {
        str(item.get("fingerprint"))
        for item in existing_payload["applied"]
        if isinstance(item, Mapping) and item.get("fingerprint")
    }
    trades: list[PaperTrade] = []
    for candidate in plan.candidates:
        if candidate.status != "paper_ready" or candidate.fingerprint in applied_fingerprints:
            continue
        trade = record_trade(
            candidate.side,
            candidate.symbol,
            candidate.mirror_shares,
            candidate.current_price or 0.0,
            f"Copy Mirror paper-only: {candidate.trader_name} via {candidate.source_name}; {candidate.fingerprint[:12]}",
            timezone_name,
            ledger_path,
        )
        trades.append(trade)
        applied_fingerprints.add(candidate.fingerprint)
        existing_payload["applied"].append(
            {
                "fingerprint": candidate.fingerprint,
                "candidate_id": candidate.id,
                "paper_trade_timestamp": trade.timestamp,
                "symbol": candidate.symbol,
                "side": candidate.side,
                "notional": trade.notional,
                "live_order_placed": False,
            }
        )
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(existing_payload, indent=2, sort_keys=True) + "\n")
    return trades
