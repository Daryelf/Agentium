from __future__ import annotations

import pandas as pd

from stock_guru.data import (
    default_cache_ttl_seconds,
    download_history,
    download_twelve_data_history,
    history_cache_key,
    latest_prices_from_twelve_data,
    load_history_cache,
    load_provider_keys,
    save_history_cache,
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
        '{"twelve_data_api_key":"file-twelve","fmp_api_key":"file-fmp","alpha_vantage_api_key":"file-alpha"}'
    )

    keys = load_provider_keys(
        path,
        env={
            "STOCK_GURU_TWELVE_DATA_API_KEY": "env-twelve",
            "STOCK_GURU_FMP_API_KEY": "",
            "STOCK_GURU_ALPHA_VANTAGE_API_KEY": "env-alpha",
        },
    )

    assert keys.twelve_data_api_key == "env-twelve"
    assert keys.fmp_api_key == "file-fmp"
    assert keys.alpha_vantage_api_key == "env-alpha"


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
