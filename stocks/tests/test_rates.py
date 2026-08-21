from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import pandas as pd

from stock_guru.provider_budget import ProviderBudgetDecision
from stock_guru.rates import fetch_macro_rate_context, market_regime_rate_values


def fred_payload(series_id: str) -> dict[str, object]:
    dates = pd.date_range(end="2026-08-19", periods=25, freq="B")
    base = {"DGS10": 4.0, "DGS3MO": 4.4, "BAMLH0A0HYM2": 3.2}[series_id]
    return {
        "observations": [
            {"date": day.date().isoformat(), "value": str(base + index * 0.01)}
            for index, day in enumerate(dates)
        ]
    }


def test_fred_rates_feed_the_regime_consumer_with_daily_budget(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "stock_guru.rates.reserve_provider_budget",
        lambda provider, units: ProviderBudgetDecision(provider, "2026-08-20", True, units, units, 20, 20 - units, "test"),
    )

    def fetcher(url: str) -> object:
        series_id = parse_qs(urlparse(url).query)["series_id"][0]
        return fred_payload(series_id)

    context = fetch_macro_rate_context(
        api_key="a" * 32,
        path=tmp_path / "macro_rates.json",
        now=datetime(2026, 8, 20, tzinfo=timezone.utc),
        fetcher=fetcher,
    )

    assert context.status == "DATA_OK"
    assert context.yield_curve_slope == -0.4
    assert context.rate_state == "INVERTED"
    assert context.high_yield_spread is not None
    assert market_regime_rate_values(context)["DGS10"] == context.series["DGS10"].latest_value
    assert "a" * 32 not in (tmp_path / "macro_rates.json").read_text()


def test_missing_fred_key_is_explicit_and_does_not_invent_rates(tmp_path) -> None:
    context = fetch_macro_rate_context(
        api_key="",
        path=tmp_path / "macro_rates.json",
        now=datetime(2026, 8, 20, tzinfo=timezone.utc),
        persist=False,
    )

    assert context.status == "DATA_INSUFFICIENT"
    assert context.yield_curve_slope is None
    assert context.issues == ("FRED_API_KEY_MISSING",)
    assert not (tmp_path / "macro_rates.json").exists()
