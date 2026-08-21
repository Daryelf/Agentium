from datetime import datetime, timezone

from stock_guru.provider_budget import provider_budget, provider_session_budget, read_provider_budgets, reserve_provider_budget


def test_provider_budget_is_daily_bounded_and_never_logs_a_key(tmp_path) -> None:
    path = tmp_path / "provider_budgets.json"
    env = {"STOCK_GURU_PROVIDER_FMP_DAILY_BUDGET": "3", "STOCK_GURU_FMP_API_KEY": "must-not-appear"}
    at = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    first = reserve_provider_budget("FMP", 2, path=path, env=env, now=at)
    blocked = reserve_provider_budget("FMP", 2, path=path, env=env, now=at)
    final = reserve_provider_budget("FMP", 1, path=path, env=env, now=at)
    assert first.allowed is True
    assert blocked.allowed is False
    assert final.allowed is True
    assert final.used_units == 3
    assert "must-not-appear" not in path.read_text()


def test_provider_budget_resets_on_new_utc_day(tmp_path) -> None:
    path = tmp_path / "provider_budgets.json"
    env = {"STOCK_GURU_PROVIDER_TWELVE_DATA_DAILY_BUDGET": "1"}
    reserve_provider_budget("TWELVE_DATA", 1, path=path, env=env, now=datetime(2026, 8, 20, tzinfo=timezone.utc))
    next_day = reserve_provider_budget("TWELVE_DATA", 1, path=path, env=env, now=datetime(2026, 8, 21, tzinfo=timezone.utc))
    assert next_day.allowed is True
    assert read_provider_budgets(path)["day"] == "2026-08-21"
    assert provider_budget("TWELVE_DATA", env) == 1


def test_fred_has_a_small_daily_macro_refresh_budget() -> None:
    assert provider_budget("FRED", {}) == 20


def test_massive_has_a_conservative_overridable_request_budget() -> None:
    assert provider_budget("MASSIVE", {}) == 500
    assert provider_budget("MASSIVE", {"STOCK_GURU_PROVIDER_MASSIVE_DAILY_BUDGET": "2500"}) == 2500


def test_provider_budget_tracks_and_enforces_market_session_caps(tmp_path) -> None:
    path = tmp_path / "provider_budgets.json"
    env = {
        "STOCK_GURU_PROVIDER_YAHOO_CHART_DAILY_BUDGET": "10",
        "STOCK_GURU_PROVIDER_YAHOO_CHART_REGULAR_BUDGET": "2",
    }
    regular = datetime(2026, 8, 20, 14, 0, tzinfo=timezone.utc)
    allowed = reserve_provider_budget("YAHOO_CHART", 2, path=path, env=env, now=regular)
    blocked = reserve_provider_budget("YAHOO_CHART", 1, path=path, env=env, now=regular)

    assert provider_session_budget("YAHOO_CHART", "REGULAR", env) == 2
    assert allowed.market_session == "REGULAR"
    assert allowed.session_remaining_units == 0
    assert blocked.allowed is False
    assert "REGULAR provider budget exhausted" in blocked.reason
    assert read_provider_budgets(path)["providers"]["YAHOO_CHART"]["sessions"]["REGULAR"]["used_units"] == 2
