from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stock_guru.catalysts import build_catalyst_events, summarize_catalysts
from stock_guru.research import NewsHeadline


def test_fresh_directional_headlines_create_structured_catalyst_score() -> None:
    now = datetime(2026, 8, 14, 15, 0, tzinfo=timezone.utc)
    events = build_catalyst_events("NET", [
        NewsHeadline(
            title="Cloudflare raises guidance after earnings beat estimates",
            publisher="Reuters",
            published_at=now - timedelta(minutes=20),
            link="https://example.com/net",
        ),
    ], received_at=now)
    summary = summarize_catalysts(events)

    assert len(events) == 1
    assert events[0].catalyst_type == "EARNINGS"
    assert events[0].direction == "POSITIVE"
    assert events[0].freshness == "FRESH"
    assert summary.score == 90
    assert summary.positive == 1


def test_duplicate_headlines_are_collapsed_and_conflicts_reduce_confidence() -> None:
    now = datetime(2026, 8, 14, 15, 0, tzinfo=timezone.utc)
    events = build_catalyst_events("XYZ", [
        NewsHeadline("XYZ wins contract", "Wire A", now - timedelta(minutes=10), "https://example.com/a"),
        NewsHeadline("XYZ wins contract", "Wire B", now - timedelta(minutes=9), "https://example.com/b"),
        NewsHeadline("XYZ cuts guidance", "Reuters", now - timedelta(minutes=5), "https://example.com/c"),
    ], received_at=now)
    summary = summarize_catalysts(events)

    assert len(events) == 2
    assert summary.conflicts is True
    assert summary.confidence < 1


def test_stale_directional_headline_does_not_create_score() -> None:
    now = datetime(2026, 8, 14, 15, 0, tzinfo=timezone.utc)
    events = build_catalyst_events("XYZ", [
        NewsHeadline("XYZ raises guidance", "Old Wire", now - timedelta(days=5), "https://example.com/old"),
    ], received_at=now)
    summary = summarize_catalysts(events)

    assert events[0].freshness == "STALE"
    assert summary.score is None
