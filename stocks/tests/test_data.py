from __future__ import annotations

import pandas as pd
import pytest

from stock_guru.provider_budget import ProviderBudgetDecision

from stock_guru.data import (
    ProviderErrors,
    ProviderKeys,
    PRICE_ADJUSTMENT_POLICY,
    cache_telemetry_path,
    default_cache_ttl_seconds,
    download_history,
    download_massive_history,
    download_provider_history,
    download_stooq_history,
    download_twelve_data_history,
    latest_prices_from_massive,
    frame_from_chart_payload,
    history_cache_key,
    latest_prices_from_twelve_data,
    load_history_cache,
    load_provider_keys,
    save_history_cache,
    spot_verify_provider_history,
)


@pytest.fixture(autouse=True)
def allow_provider_budgets(monkeypatch) -> None:
    monkeypatch.setattr(
        "stock_guru.data.reserve_provider_budget",
        lambda provider, units=1: ProviderBudgetDecision(provider, "2026-08-20", True, units, units, 10_000, 10_000 - units, "test"),
    )


def sample_frame(symbol: str = "AAPL") -> pd.DataFrame:
    dates = pd.date_range("2026-06-05", periods=3, tz="UTC")
    frame = pd.DataFrame(
        {
            ("Open", symbol): [100.0, 101.0, 102.0],
            ("High", symbol): [101.0, 102.0, 103.0],
            ("Low", symbol): [99.0, 100.0, 101.0],
            ("Close", symbol): [100.5, 101.5, 102.5],
            ("Volume", symbol): [1_000_000, 1_100_000, 1_200_000],
        },
        index=dates,
    )
    frame.columns = pd.MultiIndex.from_tuples(frame.columns, names=["Price", "Ticker"])
    return frame


def test_history_cache_round_trip(tmp_path) -> None:
    frame = sample_frame()

    save_history_cache(frame, ["AAPL"], period="1y", interval="1d", cache_dir=tmp_path)
    restored = load_history_cache(["AAPL"], period="1y", interval="1d", cache_dir=tmp_path, max_age_seconds=60)

    assert restored.equals(frame)
    telemetry = __import__("json").loads(cache_telemetry_path(tmp_path).read_text())
    assert telemetry["hits"] == 1
    assert telemetry["writes"] == 1
    assert telemetry["hit_rate"] == 1.0


def test_yahoo_chart_adjusts_all_price_fields_with_adjusted_close() -> None:
    payload = {
        "chart": {"result": [{
            "timestamp": [1_700_000_000],
            "indicators": {
                "quote": [{"open": [100.0], "high": [110.0], "low": [90.0], "close": [100.0], "volume": [1_000]}],
                "adjclose": [{"adjclose": [50.0]}],
            },
        }]},
    }
    adjusted = frame_from_chart_payload("AAPL", payload)
    assert adjusted[("Open", "AAPL")].iloc[-1] == 50.0
    assert adjusted[("High", "AAPL")].iloc[-1] == 55.0
    assert adjusted[("Low", "AAPL")].iloc[-1] == 45.0
    assert adjusted[("Close", "AAPL")].iloc[-1] == 50.0


def test_stooq_parser_is_a_keyless_daily_deep_fallback(monkeypatch) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b"Date,Open,High,Low,Close,Volume\n2026-08-19,100,103,99,102,1000000\n"

    monkeypatch.setattr("stock_guru.data.urllib.request.urlopen", lambda *_args, **_kwargs: Response())
    history = download_stooq_history(["AAPL"], period="1y", interval="1d")
    assert history[("Close", "AAPL")].iloc[-1] == 102


def test_provenance_documents_adjusted_price_policy(monkeypatch, tmp_path) -> None:
    frame = sample_frame()
    errors = ProviderErrors()
    errors.selected_provider = "FMP"
    monkeypatch.setattr("stock_guru.data.MARKET_CACHE_DIR", tmp_path)
    monkeypatch.setattr("stock_guru.data.download_provider_history", lambda *args, **kwargs: (frame, errors))
    monkeypatch.setattr("stock_guru.data.retry_missing_symbols", lambda history, *_args, **_kwargs: history)
    data = download_history(["AAPL"], period="1y", interval="1d")
    assert data.provenance is not None
    assert data.provenance.metadata["price_adjustment_policy"] == PRICE_ADJUSTMENT_POLICY


def test_spot_verification_records_conflicts_without_checking_every_symbol(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("STOCK_GURU_PROVIDER_VALIDATION_DAILY_SYMBOLS", "2")
    monkeypatch.setenv("STOCK_GURU_PROVIDER_VALIDATION_PER_BATCH", "1")
    primary = pd.concat([sample_frame("AAPL"), sample_frame("MSFT")], axis=1)

    def conflicting(selected):
        result = sample_frame(selected[0])
        result.loc[result.index[-1], ("Close", selected[0])] *= 1.02
        return result

    issues, summary = spot_verify_provider_history(
        primary,
        ["AAPL", "MSFT"],
        selected_provider="TWELVE_DATA",
        period="1y",
        interval="1d",
        path=tmp_path / "provider_validation.json",
        fetcher=conflicting,
    )
    assert summary["validation_provider"] == "YAHOO_CHART"
    assert len(summary["symbols"]) == 1
    assert {issue.code for issue in issues} == {"PROVIDER_PRICE_CONFLICT"}


def test_download_history_uses_fresh_cache_when_sources_fail(monkeypatch, tmp_path) -> None:
    frame = sample_frame()
    save_history_cache(frame, ["AAPL"], period="1y", interval="1d", cache_dir=tmp_path)

    monkeypatch.setattr("stock_guru.data.MARKET_CACHE_DIR", tmp_path)
    monkeypatch.setattr("stock_guru.data.download_provider_history", lambda *args, **kwargs: (pd.DataFrame(), []))
    monkeypatch.setattr("stock_guru.data.download_yahoo_chart_history", lambda *args, **kwargs: pd.DataFrame())
    monkeypatch.setattr("stock_guru.data.download_with_yfinance", lambda *args, **kwargs: pd.DataFrame())
    monkeypatch.setattr("stock_guru.data.retry_missing_symbols", lambda history, *_args, **_kwargs: history)

    data = download_history(["AAPL"], period="1y", interval="1d")

    assert data.tickers == ["AAPL"]
    assert data.history.equals(frame)
    assert data.provenance is not None
    assert data.provenance.provider == "CACHE"
    assert data.quality is not None


def test_download_history_exposes_selected_provider_and_fallback(monkeypatch, tmp_path) -> None:
    frame = sample_frame()
    errors = ProviderErrors()
    errors.selected_provider = "FMP"
    errors.extend(["Twelve Data returned no data"])

    monkeypatch.setattr("stock_guru.data.MARKET_CACHE_DIR", tmp_path)
    monkeypatch.setattr("stock_guru.data.download_provider_history", lambda *args, **kwargs: (frame, errors))
    monkeypatch.setattr("stock_guru.data.retry_missing_symbols", lambda history, *_args, **_kwargs: history)

    data = download_history(["AAPL"], period="1y", interval="1d")

    assert data.provenance is not None
    assert data.provenance.provider == "FMP"
    assert data.provenance.errors == ("Twelve Data returned no data",)
    assert data.quality is not None
    assert data.provenance.quality_score == data.quality.score


def test_download_history_raises_clear_error_when_no_sources_or_cache(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.data.MARKET_CACHE_DIR", tmp_path)
    monkeypatch.setattr("stock_guru.data.download_provider_history", lambda *args, **kwargs: (pd.DataFrame(), []))
    monkeypatch.setattr("stock_guru.data.download_yahoo_chart_history", lambda *args, **kwargs: pd.DataFrame())
    monkeypatch.setattr("stock_guru.data.download_with_yfinance", lambda *args, **kwargs: pd.DataFrame())

    try:
        download_history(["AAPL"], period="1y", interval="1d")
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("Expected RuntimeError")

    assert "No fresh market data returned." in message
    assert "Yahoo chart returned no data after retries" in message
    assert "yfinance fallback returned no data" in message


def test_cache_ttl_defaults_are_interval_aware() -> None:
    assert default_cache_ttl_seconds("1m") == 600
    assert default_cache_ttl_seconds("1h") == 3600
    assert default_cache_ttl_seconds("1d") == 21600


def test_history_cache_key_is_stable_for_symbol_order() -> None:
    assert history_cache_key(["AAPL", "MSFT"], period="1y", interval="1d") == history_cache_key(
        ["MSFT", "AAPL"],
        period="1y",
        interval="1d",
    )


def test_load_provider_keys_prefers_env_over_file(tmp_path) -> None:
    path = tmp_path / "provider_keys.json"
    path.write_text(
        '{"massive_api_key":"file-massive","twelve_data_api_key":"file-twelve","fmp_api_key":"file-fmp","alpha_vantage_api_key":"file-alpha","fred_api_key":"file-fred"}'
    )

    keys = load_provider_keys(
        path,
        env={
            "MASSIVE_API_KEY": "env-massive",
            "STOCK_GURU_TWELVE_DATA_API_KEY": "env-twelve",
            "STOCK_GURU_FMP_API_KEY": "",
            "STOCK_GURU_ALPHA_VANTAGE_API_KEY": "env-alpha",
            "STOCK_GURU_FRED_API_KEY": "env-fred",
        },
    )

    assert keys.massive_api_key == "env-massive"
    assert keys.twelve_data_api_key == "env-twelve"
    assert keys.fmp_api_key == "file-fmp"
    assert keys.alpha_vantage_api_key == "env-alpha"
    assert keys.fred_api_key == "env-fred"


def test_load_provider_keys_uses_argentum_keychain_for_massive_when_local_sources_are_empty(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("stock_guru.data.read_argentum_keychain_secret", lambda provider: "keychain-massive" if provider == "stock_guru_massive_api_key" else "")

    keys = load_provider_keys(tmp_path / "missing.json")

    assert keys.massive_api_key == "keychain-massive"


def test_download_twelve_data_history_parses_batch_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        "stock_guru.data.fetch_json",
        lambda *_args, **_kwargs: {
            "AAPL": {
                "status": "ok",
                "values": [
                    {"datetime": "2026-06-05", "open": "100", "high": "101", "low": "99", "close": "100.5", "volume": "1000"}
                ],
            },
            "MSFT": {
                "status": "ok",
                "values": [
                    {"datetime": "2026-06-05", "open": "200", "high": "201", "low": "199", "close": "200.5", "volume": "2000"}
                ],
            },
        },
    )

    frame = download_twelve_data_history(["AAPL", "MSFT"], period="1mo", interval="1d", api_key="token")

    assert ("Close", "AAPL") in frame.columns
    assert ("Volume", "MSFT") in frame.columns
    assert frame[("Close", "MSFT")].iloc[-1] == 200.5


def test_download_massive_history_parses_adjusted_aggregate_bars(monkeypatch) -> None:
    observed_urls = []

    def fake_fetch(url, **_kwargs):
        observed_urls.append(url)
        return {
            "status": "OK",
            "ticker": "AAPL",
            "results": [
                {"t": 1_780_272_000_000, "o": 100, "h": 103, "l": 99, "c": 102, "v": 1_250_000},
            ],
        }

    monkeypatch.setattr("stock_guru.data.fetch_json", fake_fetch)
    frame = download_massive_history(["AAPL"], period="1mo", interval="1d", api_key="massive-token")

    assert frame[("Close", "AAPL")].iloc[-1] == 102
    assert frame[("Volume", "AAPL")].iloc[-1] == 1_250_000
    assert "/v2/aggs/ticker/AAPL/range/1/day/" in observed_urls[0]
    assert "adjusted=true" in observed_urls[0]


def test_configured_massive_is_the_first_daily_history_provider(monkeypatch) -> None:
    frame = sample_frame()
    monkeypatch.setattr("stock_guru.data.load_provider_keys", lambda: ProviderKeys(massive_api_key="massive-token", twelve_data_api_key="twelve-token"))
    monkeypatch.setattr("stock_guru.data.download_massive_history", lambda *_args, **_kwargs: frame)
    monkeypatch.setattr(
        "stock_guru.data.download_twelve_data_history",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Massive success should stop the fallback chain.")),
    )

    history, errors = download_provider_history(["AAPL"], period="1mo", interval="1d")

    assert history.equals(frame)
    assert errors.selected_provider == "MASSIVE"
    assert [attempt.provider for attempt in errors.attempts] == ["MASSIVE"]


def test_latest_prices_from_massive_uses_current_snapshot_not_previous_day(monkeypatch) -> None:
    observed_urls = []

    def fake_fetch(url, **_kwargs):
        observed_urls.append(url)
        return {
            "status": "OK",
            "tickers": [{
                "ticker": "AAPL",
                "lastTrade": {"p": "123.45"},
                "day": {"c": 123.40},
                "prevDay": {"c": 119.00},
            }],
        }

    monkeypatch.setattr(
        "stock_guru.data.fetch_json",
        fake_fetch,
    )

    assert latest_prices_from_massive(["AAPL"], api_key="massive-token") == {"AAPL": 123.45}
    assert len(observed_urls) == 1
    assert "/v2/snapshot/locale/us/markets/stocks/tickers?" in observed_urls[0]
    assert "tickers=AAPL" in observed_urls[0]


def test_latest_prices_from_twelve_data_reads_batch_quotes(monkeypatch) -> None:
    monkeypatch.setattr(
        "stock_guru.data.fetch_json",
        lambda *_args, **_kwargs: {
            "AAPL": {"close": "123.45"},
            "MSFT": {"close": "234.56"},
        },
    )

    prices = latest_prices_from_twelve_data(["AAPL", "MSFT"], api_key="token")

    assert prices == {"AAPL": 123.45, "MSFT": 234.56}
