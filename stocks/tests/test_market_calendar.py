from datetime import date, datetime, timezone

from stock_guru.market_calendar import MarketSession, market_clock, trading_day, trading_days


def test_regular_and_extended_sessions_use_new_york_time() -> None:
    assert market_clock(datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)).session == MarketSession.PRE_MARKET
    assert market_clock(datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc)).session == MarketSession.REGULAR
    assert market_clock(datetime(2026, 8, 12, 21, 0, tzinfo=timezone.utc)).session == MarketSession.AFTER_HOURS
    assert market_clock(datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)).session == MarketSession.OVERNIGHT


def test_holidays_are_not_treated_as_missing_market_days() -> None:
    christmas = trading_day(date(2026, 12, 25))
    assert christmas.is_trading_day is False
    assert christmas.holiday == "Christmas Day"
    assert market_clock(datetime(2026, 12, 25, 15, 0, tzinfo=timezone.utc)).session == MarketSession.WEEKEND_HOLIDAY
    days = trading_days(date(2026, 12, 24), date(2026, 12, 28))
    assert days == (date(2026, 12, 24), date(2026, 12, 28))


def test_early_close_uses_one_pm_regular_close() -> None:
    schedule = trading_day(date(2026, 11, 27))
    assert schedule.early_close is True
    assert schedule.regular_close is not None
    assert schedule.regular_close.isoformat(timespec="minutes") == "13:00"
    assert market_clock(datetime(2026, 11, 27, 17, 30, tzinfo=timezone.utc)).session == MarketSession.REGULAR
    assert market_clock(datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc)).session == MarketSession.AFTER_HOURS
