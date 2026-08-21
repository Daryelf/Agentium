from __future__ import annotations

import json

from stock_guru.universe import build_dynamic_universe, commit_dynamic_universe


def test_build_dynamic_universe_rotates_symbols(tmp_path) -> None:
    catalog_path = tmp_path / "catalog.json"
    state_path = tmp_path / "state.json"
    catalog_path.write_text(
        json.dumps(
            {
                "catalog_version": 2,
                "generated_at": "2026-08-18T00:00:00+00:00",
                "count": 6,
                "exchanges": ["NASDAQ", "NYSE"],
                "symbols": ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"],
            }
        )
    )

    first = build_dynamic_universe(["AAA", "BBB"], max_symbols=4, rotate_count=2, catalog_path=catalog_path, state_path=state_path)
    retry = build_dynamic_universe(["AAA", "BBB"], max_symbols=4, rotate_count=2, catalog_path=catalog_path, state_path=state_path)
    commit_dynamic_universe(first, state_path)
    second = build_dynamic_universe(["AAA", "BBB"], max_symbols=4, rotate_count=2, catalog_path=catalog_path, state_path=state_path)

    assert first.symbols == ["AAA", "BBB", "CCC", "DDD"]
    assert retry.symbols == first.symbols
    assert second.symbols == ["AAA", "BBB", "EEE", "FFF"]


def test_exchange_wide_mode_uses_every_batch_slot_for_catalog_rotation(tmp_path) -> None:
    catalog_path = tmp_path / "catalog.json"
    state_path = tmp_path / "state.json"
    catalog_path.write_text(
        json.dumps(
            {
                "catalog_version": 2,
                "generated_at": "2026-08-18T00:00:00+00:00",
                "count": 6,
                "exchanges": ["NASDAQ", "NYSE"],
                "symbols": ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"],
            }
        )
    )

    first = build_dynamic_universe(["AAA", "BBB"], max_symbols=3, rotate_count=3, catalog_path=catalog_path, state_path=state_path)
    commit_dynamic_universe(first, state_path)
    second = build_dynamic_universe(["AAA", "BBB"], max_symbols=3, rotate_count=3, catalog_path=catalog_path, state_path=state_path)

    assert first.symbols == ["AAA", "BBB", "CCC"]
    assert second.symbols == ["DDD", "EEE", "FFF"]
    assert first.seed_count == 0
    assert first.universe_total == 6
    assert second.cursor_end == 6


def test_build_dynamic_universe_falls_back_to_seed_when_catalog_missing(tmp_path) -> None:
    from stock_guru import universe as universe_module

    original_refresh = universe_module.refresh_us_stocks_catalog
    universe_module.refresh_us_stocks_catalog = lambda path: []
    try:
        result = build_dynamic_universe(["AAPL", "MSFT"], max_symbols=4, rotate_count=2, catalog_path=tmp_path / "missing.json", state_path=tmp_path / "state.json")
    finally:
        universe_module.refresh_us_stocks_catalog = original_refresh

    assert result.symbols == ["AAPL", "MSFT"]
    assert result.source_catalog_count == 0
