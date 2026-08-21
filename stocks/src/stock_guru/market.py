from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from .config import Settings
from .market_calendar import MarketSession, market_clock


def parse_hhmm(value: str) -> time:
    hour, minute = value.split(":", maxsplit=1)
    return time(hour=int(hour), minute=int(minute))


def market_state(settings: Settings, now: datetime | None = None) -> str:
    # Preserve the existing public labels while making the canonical NYSE
    # calendar (holidays and early closes included) the source of truth.
    clock = market_clock(now)
    if clock.session == MarketSession.REGULAR:
        return "open"
    if clock.session == MarketSession.PRE_MARKET:
        return "pre-market"
    if clock.session == MarketSession.AFTER_HOURS:
        return "after-hours"
    return "closed"
