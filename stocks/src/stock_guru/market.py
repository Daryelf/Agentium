from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from .config import Settings


def parse_hhmm(value: str) -> time:
    hour, minute = value.split(":", maxsplit=1)
    return time(hour=int(hour), minute=int(minute))


def market_state(settings: Settings, now: datetime | None = None) -> str:
    tz = ZoneInfo(settings.market_timezone)
    current = now.astimezone(tz) if now else datetime.now(tz)
    if current.weekday() >= 5:
        return "closed"

    open_at = parse_hhmm(settings.regular_market_open)
    close_at = parse_hhmm(settings.regular_market_close)
    if open_at <= current.time() <= close_at:
        return "open"
    if current.time() < open_at:
        return "pre-market"
    return "after-hours"
