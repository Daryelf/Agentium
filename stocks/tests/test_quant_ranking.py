from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import json

from stock_guru.market_context import build_market_regime
from stock_guru.quant.context import build_symbol_context
from stock_guru.quant.engine import build_quant_snapshot
from stock_guru.quant.ranking import build_analysis_object, rank_analysis_objects, risk_adjusted_opportunity, write_analysis_report
from stock_guru.quant.scoring import score_symbol
from tests.test_quant_scoring import research, scoring_market


def ranking_report():
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    data = scoring_market()
    regime = build_market_regime(data, data.tickers, generated_at=now)
    analyses = {}
    for symbol in ("AAPL", "SPY", "QQQ"):
        snapshot = build_quant_snapshot(data, symbol, generated_at=now)
        context = build_symbol_context(snapshot, research=research(now), generated_at=now)
        score = score_symbol(snapshot, context, regime, generated_at=now)
        analyses[symbol] = build_analysis_object(snapshot, context, score, regime)
    return rank_analysis_objects(analyses, generated_at=now)


def test_risk_adjusted_opportunity_is_bounded_and_has_no_division_edge() -> None:
    assert risk_adjusted_opportunity(80, 90, 0) == 72.0
    assert risk_adjusted_opportunity(80, 90, 100) == 14.4
    assert risk_adjusted_opportunity(None, 90, 20) is None


def test_universe_ranking_builds_percentiles_and_specialized_views() -> None:
    report = ranking_report()

    assert report.universe_size == 3
    assert set(report.views["best_overall"]) == {"AAPL", "SPY", "QQQ"}
    assert set(report.views["lowest_risk"]) == {"AAPL", "SPY", "QQQ"}
    assert set(report.analyses) == {"AAPL", "SPY", "QQQ"}
    for item in report.analyses.values():
        assert item.scores["final"] is not None
        assert item.scores["risk_adjusted_opportunity"] is not None
        assert item.percentiles["final"] is not None
        assert 0 <= item.percentiles["final"] <= 100
        assert item.rankings["best_overall"] is not None
        assert item.data_quality["status"] in {"DATA_OK", "DATA_PARTIAL"}


def test_standard_analysis_report_persists_daily_and_latest_snapshots_without_nan(tmp_path) -> None:
    report = ranking_report()
    latest, daily = write_analysis_report(
        report,
        latest_path=tmp_path / "analysis_latest.json",
        history_dir=tmp_path / "analysis_snapshots",
    )
    latest_payload = json.loads(latest.read_text())
    daily_payload = json.loads(daily.read_text())

    assert daily.name == "2026-08-20.json"
    assert latest_payload == daily_payload
    assert latest_payload["universe_size"] == 3
    assert latest_payload["analyses"]["AAPL"]["scores"]["confidence"] is not None
    assert "NaN" not in latest.read_text()
    assert latest_payload["analyses"]["AAPL"]["methodology"]["recommendation"].startswith("analytical output only")


def test_daily_snapshot_uses_new_york_market_date_not_utc_rollover(tmp_path) -> None:
    report = replace(ranking_report(), generated_at="2026-08-21T00:30:00+00:00")
    _, daily = write_analysis_report(
        report,
        latest_path=tmp_path / "analysis_latest.json",
        history_dir=tmp_path / "analysis_snapshots",
    )
    assert daily.name == "2026-08-20.json"
