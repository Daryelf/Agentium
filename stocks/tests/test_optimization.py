from __future__ import annotations

import json
from datetime import timedelta

from dataclasses import replace

from stock_guru.intraday_replay import optimize_intraday_replay, optimize_intraday_walk_forward
from stock_guru.optimization import (
    optimization_reasons,
    optimized_settings_from_report,
    write_optimization_report,
    write_walk_forward_optimization_report,
)
from tests.test_intraday_loop import intraday_frame, now, settings


def test_write_optimization_report_records_best_candidate(tmp_path) -> None:
    results = optimize_intraday_replay(
        intraday_frame(),
        settings(),
        symbols=["TEST"],
        min_entry_scores=[85],
        auto_order_scores=[90],
        relative_volumes=[1.0],
        max_spreads=[0.005],
        warmup_bars=60,
    )
    path = write_optimization_report(results, symbols=["TEST"], generated_at=now(), path=tmp_path / "opt.json")
    payload = json.loads(path.read_text())

    assert payload["best"]["settings"]["intraday_auto_order_score"] == 90
    assert payload["symbols"] == ["TEST"]
    assert "walk-forward optimization report required" in optimization_reasons(settings(), now=now(), path=path)


def test_write_walk_forward_report_records_validation_metrics(tmp_path) -> None:
    results = optimize_intraday_walk_forward(
        intraday_frame(),
        settings(),
        symbols=["TEST"],
        min_entry_scores=[85],
        auto_order_scores=[90],
        relative_volumes=[1.0],
        max_spreads=[0.005],
        warmup_bars=20,
    )
    path = write_walk_forward_optimization_report(results, symbols=["TEST"], generated_at=now(), path=tmp_path / "wf.json")
    payload = json.loads(path.read_text())

    assert payload["report_type"] == "walk_forward"
    assert "validation_metrics" in payload["best"]


def test_optimization_reasons_blocks_stale_report(tmp_path) -> None:
    results = optimize_intraday_replay(
        intraday_frame(),
        settings(),
        symbols=["TEST"],
        min_entry_scores=[85],
        auto_order_scores=[90],
        relative_volumes=[1.0],
        max_spreads=[0.005],
        warmup_bars=60,
    )
    path = write_optimization_report(
        results,
        symbols=["TEST"],
        generated_at=now() - timedelta(hours=settings().live_optimization_stale_hours + 1),
        path=tmp_path / "opt.json",
    )

    assert "replay optimization report is stale" in optimization_reasons(settings(), now=now(), path=path)


def test_optimized_settings_from_report_applies_allowed_intraday_knobs(tmp_path) -> None:
    path = tmp_path / "opt.json"
    path.write_text(
        json.dumps(
            {
                "generated_at": now().isoformat(timespec="seconds"),
                "best": {
                    "reasons": [],
                    "eligible_symbols": ["TEST"],
                    "settings": {
                        "intraday_min_entry_score": 90,
                        "intraday_auto_order_score": 92,
                        "intraday_min_relative_volume": 1.5,
                        "intraday_max_spread_pct": 0.003,
                        "live_max_order_dollars": 999,
                    },
                },
            }
        )
        + "\n"
    )

    optimized, reasons = optimized_settings_from_report(
        replace(settings(), live_require_walk_forward_optimization=False),
        now=now(),
        path=path,
    )

    assert not reasons
    assert optimized.intraday_min_entry_score == 90
    assert optimized.intraday_auto_order_score == 92
    assert optimized.intraday_min_relative_volume == 1.5
    assert optimized.intraday_max_spread_pct == 0.003
    assert optimized.live_max_order_dollars == settings().live_max_order_dollars
