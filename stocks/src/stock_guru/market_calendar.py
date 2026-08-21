from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import Enum
from functools import lru_cache
from zoneinfo import ZoneInfo


MARKET_TIMEZONE = "America/New_York"
EASTERN = ZoneInfo(MARKET_TIMEZONE)


class MarketSession(str, Enum):
    PRE_MARKET = "PRE_MARKET"
    REGULAR = "REGULAR"
    AFTER_HOURS = "AFTER_HOURS"
    OVERNIGHT = "OVERNIGHT"
    WEEKEND_HOLIDAY = "WEEKEND_HOLIDAY"


@dataclass(frozen=True)
class TradingDay:
    market_date: date
    is_trading_day: bool
    holiday: str | None
    regular_open: time | None
    regular_close: time | None
    early_close: bool = False


@dataclass(frozen=True)
class MarketClock:
    observed_at: str
    market_date: str
    session: MarketSession
    is_trading_day: bool
    holiday: str | None
    early_close: bool
    regular_open: str | None
    regular_close: str | None


def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    current = date(year, month, 1)
    offset = (weekday - current.weekday()) % 7
    return current + timedelta(days=offset + (occurrence - 1) * 7)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        current = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        current = date(year, month + 1, 1) - timedelta(days=1)
    return current - timedelta(days=(current.weekday() - weekday) % 7)


def _observed(day: date) -> date:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


def _western_easter(year: int) -> date:
    # Anonymous Gregorian algorithm. Good Friday is an NYSE holiday.
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month = (h + ell - 7 * m + 114) // 31
    day = ((h + ell - 7 * m + 114) % 31) + 1
    return date(year, month, day)


SPECIAL_CLOSURES: dict[date, str] = {
    date(2001, 9, 11): "September 11 closure",
    date(2001, 9, 12): "September 11 closure",
    date(2001, 9, 13): "September 11 closure",
    date(2001, 9, 14): "September 11 closure",
    date(2004, 6, 11): "President Reagan national day of mourning",
    date(2007, 1, 2): "President Ford national day of mourning",
    date(2012, 10, 29): "Hurricane Sandy closure",
    date(2012, 10, 30): "Hurricane Sandy closure",
    date(2018, 12, 5): "President George H.W. Bush national day of mourning",
}


@lru_cache(maxsize=64)
def nyse_holidays(year: int) -> dict[date, str]:
    holidays: dict[date, str] = {
        _observed(date(year, 1, 1)): "New Year's Day",
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Washington's Birthday",
        _western_easter(year) - timedelta(days=2): "Good Friday",
        _last_weekday(year, 5, 0): "Memorial Day",
        _observed(date(year, 7, 4)): "Independence Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving Day",
        _observed(date(year, 12, 25)): "Christmas Day",
    }
    if year >= 2022:
        holidays[_observed(date(year, 6, 19))] = "Juneteenth National Independence Day"
    # The observed New Year's holiday can land in the prior calendar year.
    next_new_year = _observed(date(year + 1, 1, 1))
    if next_new_year.year == year:
        holidays[next_new_year] = "New Year's Day"
    holidays.update({day: name for day, name in SPECIAL_CLOSURES.items() if day.year == year})
    return holidays


@lru_cache(maxsize=64)
def nyse_early_closes(year: int) -> dict[date, str]:
    closes: dict[date, str] = {}
    thanksgiving = _nth_weekday(year, 11, 3, 4)
    friday_after = thanksgiving + timedelta(days=1)
    if friday_after.weekday() < 5 and friday_after not in nyse_holidays(year):
        closes[friday_after] = "Day after Thanksgiving"

    july_fourth = date(year, 7, 4)
    before_independence = july_fourth - timedelta(days=1)
    if before_independence.weekday() < 5 and before_independence not in nyse_holidays(year):
        closes[before_independence] = "Day before Independence Day"

    christmas_eve = date(year, 12, 24)
    if christmas_eve.weekday() < 5 and christmas_eve not in nyse_holidays(year):
        closes[christmas_eve] = "Christmas Eve"
    return closes


def trading_day(day: date) -> TradingDay:
    holiday = nyse_holidays(day.year).get(day)
    is_open = day.weekday() < 5 and holiday is None
    early_close = is_open and day in nyse_early_closes(day.year)
    return TradingDay(
        market_date=day,
        is_trading_day=is_open,
        holiday=holiday if holiday else "Weekend" if day.weekday() >= 5 else None,
        regular_open=time(9, 30) if is_open else None,
        regular_close=time(13, 0) if early_close else time(16, 0) if is_open else None,
        early_close=early_close,
    )


def market_clock(at: datetime | None = None) -> MarketClock:
    current = at or datetime.now(EASTERN)
    if current.tzinfo is None:
        current = current.replace(tzinfo=EASTERN)
    local = current.astimezone(EASTERN)
    schedule = trading_day(local.date())
    if not schedule.is_trading_day:
        session = MarketSession.WEEKEND_HOLIDAY
    elif time(4, 0) <= local.time() < time(9, 30):
        session = MarketSession.PRE_MARKET
    elif schedule.regular_close and time(9, 30) <= local.time() < schedule.regular_close:
        session = MarketSession.REGULAR
    elif schedule.regular_close and schedule.regular_close <= local.time() < time(20, 0):
        session = MarketSession.AFTER_HOURS
    else:
        session = MarketSession.OVERNIGHT
    return MarketClock(
        observed_at=local.isoformat(),
        market_date=local.date().isoformat(),
        session=session,
        is_trading_day=schedule.is_trading_day,
        holiday=schedule.holiday,
        early_close=schedule.early_close,
        regular_open=schedule.regular_open.isoformat(timespec="minutes") if schedule.regular_open else None,
        regular_close=schedule.regular_close.isoformat(timespec="minutes") if schedule.regular_close else None,
    )


def is_trading_day(day: date) -> bool:
    return trading_day(day).is_trading_day


def trading_days(start: date, end: date) -> tuple[date, ...]:
    if end < start:
        start, end = end, start
    days: list[date] = []
    current = start
    while current <= end:
        if is_trading_day(current):
            days.append(current)
        current += timedelta(days=1)
    return tuple(days)


def previous_trading_day(day: date) -> date:
    current = day - timedelta(days=1)
    while not is_trading_day(current):
        current -= timedelta(days=1)
    return current
