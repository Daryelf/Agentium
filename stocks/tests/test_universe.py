from __future__ import annotations

import json

from stock_guru.universe import build_dynamic_universe


def test_build_dynamic_universe_rotates_symbols(tmp_path) -> None:
    catalog_path = tmp_path / "catalog.json"
    state_path = tmp_path / "state.json"
    catalog_path.write_text(
        json.dumps(
            {
                "generated_at": "2026-06-05T00:00:00+00:00",
                "count": 6,
                "symbols": ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"],
            }
        )
    )

    first = build_dynamic_universe(["AAA", "BBB"], max_symbols=4, rotate_count=2, catalog_path=catalog_path, state_path=state_path)
    second = build_dynamic_universe(["AAA", "BBB"], max_symbols=4, rotate_count=2, catalog_path=catalog_path, state_path=state_path)

    assert first.symbols == ["AAA", "BBB", "CCC", "DDD"]
    assert second.symbols == ["AAA", "BBB", "EEE", "FFF"]


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
