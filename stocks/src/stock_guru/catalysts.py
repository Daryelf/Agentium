from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import re
from typing import Iterable


@dataclass(frozen=True)
class CatalystEvent:
    id: str
    symbol: str
    title: str
    publisher: str
    source_url: str
    published_at: str | None
    received_at: str
    catalyst_type: str
    direction: str
    confidence: float
    freshness: str
    age_minutes: float | None
    duplicate_group: str
    scheduled: bool
    scoring_method: str = "deterministic_headline_rules_v1"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class CatalystSummary:
    score: int | None
    confidence: float
    positive: int
    negative: int
    neutral: int
    conflicts: bool
    newest_at: str | None
    methodology: str = "fresh timestamped directional events only; neutral and stale headlines do not create an edge"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


TYPE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("EARNINGS", ("earnings", "eps", "revenue", "quarterly results", "profit")),
    ("GUIDANCE", ("guidance", "outlook", "forecast")),
    ("REGULATORY", ("fda", "regulator", "regulatory", "approval", "approved", "clinical trial")),
    ("M_AND_A", ("acquire", "acquisition", "merger", "takeover", "buyout")),
    ("CONTRACT", ("contract", "partnership", "customer win", "award")),
    ("ANALYST", ("upgrade", "downgrade", "price target", "initiates coverage")),
    ("CAPITAL", ("offering", "buyback", "repurchase", "dividend", "debt")),
    ("LEGAL", ("lawsuit", "investigation", "settlement", "subpoena")),
    ("MANAGEMENT", ("ceo", "cfo", "resigns", "appoints", "management")),
    ("FILING", ("8-k", "10-k", "10-q", "sec filing", "form 4", "13f")),
)

POSITIVE_RULES = (
    "beats estimates", "beat estimates", "raises guidance", "raised guidance", "guidance raised",
    "wins contract", "contract win", "approved by", "receives approval", "fda approval",
    "record revenue", "record profit", "expands margin", "margin expansion", "buyback",
    "repurchase", "dividend increase", "upgraded", "upgrade to", "positive trial",
)
NEGATIVE_RULES = (
    "misses estimates", "missed estimates", "cuts guidance", "cut guidance", "guidance cut",
    "lowers guidance", "downgraded", "downgrade to", "investigation", "lawsuit", "recall",
    "bankruptcy", "default", "dilution", "secondary offering", "data breach", "resigns",
    "clinical failure", "trial failure", "rejected by", "warning letter",
)


def normalized_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(title or "").lower()).strip()


def catalyst_type(title: str) -> str:
    normalized = normalized_title(title)
    for name, phrases in TYPE_RULES:
        if any(phrase in normalized for phrase in phrases):
            return name
    return "OTHER"


def catalyst_direction(title: str) -> str:
    normalized = normalized_title(title)
    positive = any(phrase in normalized for phrase in POSITIVE_RULES)
    negative = any(phrase in normalized for phrase in NEGATIVE_RULES)
    if positive and not negative:
        return "POSITIVE"
    if negative and not positive:
        return "NEGATIVE"
    return "NEUTRAL"


def freshness_for(published_at: datetime | None, received_at: datetime) -> tuple[str, float | None, float]:
    if published_at is None:
        return "UNKNOWN", None, 0.25
    published = published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    age_minutes = max(0.0, (received_at.astimezone(timezone.utc) - published.astimezone(timezone.utc)).total_seconds() / 60)
    if age_minutes <= 6 * 60:
        return "FRESH", age_minutes, 1.0
    if age_minutes <= 24 * 60:
        return "CURRENT", age_minutes, 0.75
    if age_minutes <= 72 * 60:
        return "AGING", age_minutes, 0.4
    return "STALE", age_minutes, 0.0


def build_catalyst_event(symbol: str, headline, *, received_at: datetime) -> CatalystEvent:
    title = str(getattr(headline, "title", "") or "").strip()
    publisher = str(getattr(headline, "publisher", "") or "").strip()
    link = str(getattr(headline, "link", "") or "").strip()
    published_at = getattr(headline, "published_at", None)
    freshness, age_minutes, freshness_weight = freshness_for(published_at, received_at)
    direction = catalyst_direction(title)
    confidence = 0.35
    if publisher:
        confidence += 0.15
    if link.startswith("https://"):
        confidence += 0.15
    if published_at is not None:
        confidence += 0.15
    if direction != "NEUTRAL":
        confidence += 0.15
    confidence = round(min(1.0, confidence * max(0.25, freshness_weight)), 4)
    group = hashlib.sha256(normalized_title(title).encode("utf-8")).hexdigest()[:20]
    event_id = hashlib.sha256(f"{symbol.upper()}:{group}:{published_at}".encode("utf-8")).hexdigest()[:24]
    return CatalystEvent(
        id=f"catalyst-{event_id}",
        symbol=symbol.upper(),
        title=title,
        publisher=publisher,
        source_url=link,
        published_at=published_at.isoformat() if published_at is not None else None,
        received_at=received_at.isoformat(),
        catalyst_type=catalyst_type(title),
        direction=direction,
        confidence=confidence,
        freshness=freshness,
        age_minutes=round(age_minutes, 2) if age_minutes is not None else None,
        duplicate_group=group,
        scheduled=bool(re.search(r"\b(?:reports?|earnings call|conference)\s+(?:on|after|before)\b", title.lower())),
    )


def build_catalyst_events(symbol: str, headlines: Iterable[object], *, received_at: datetime) -> list[CatalystEvent]:
    unique: dict[str, CatalystEvent] = {}
    for headline in headlines:
        event = build_catalyst_event(symbol, headline, received_at=received_at)
        if not event.title:
            continue
        prior = unique.get(event.duplicate_group)
        if prior is None or event.confidence > prior.confidence:
            unique[event.duplicate_group] = event
    return sorted(unique.values(), key=lambda item: item.published_at or "", reverse=True)


def summarize_catalysts(events: Iterable[CatalystEvent]) -> CatalystSummary:
    values = list(events)
    directional = [item for item in values if item.direction in {"POSITIVE", "NEGATIVE"} and item.freshness != "STALE"]
    positive = sum(item.direction == "POSITIVE" for item in values)
    negative = sum(item.direction == "NEGATIVE" for item in values)
    neutral = sum(item.direction == "NEUTRAL" for item in values)
    signed_weight = sum((1 if item.direction == "POSITIVE" else -1) * item.confidence for item in directional)
    total_weight = sum(item.confidence for item in directional)
    score = round(50 + 40 * signed_weight / total_weight) if total_weight else None
    newest = max((item.published_at for item in values if item.published_at), default=None)
    confidence = round(min(1.0, total_weight / max(1, len(directional))), 4) if directional else 0.0
    conflicts = positive > 0 and negative > 0
    if conflicts:
        confidence = round(confidence * 0.65, 4)
    return CatalystSummary(
        score=max(0, min(100, score)) if score is not None else None,
        confidence=confidence,
        positive=positive,
        negative=negative,
        neutral=neutral,
        conflicts=conflicts,
        newest_at=newest,
    )
