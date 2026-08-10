from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence
import re
import urllib.parse
from zoneinfo import ZoneInfo

import yfinance as yf

from .config import REPORT_DIR, normalize_tickers
from .data import ALPHA_VANTAGE_URL, FMP_URL, fetch_json, load_provider_keys


RESEARCH_REPORT_PATH = REPORT_DIR / "research.md"
COMPANY_NEWS_ALIASES = {
    "BAC": ("Bank of America",),
}


@dataclass(frozen=True)
class EquityResearch:
    ticker: str
    company_name: str = ""
    sector: str = ""
    market_cap: float | None = None
    trailing_pe: float | None = None
    forward_pe: float | None = None
    revenue_growth: float | None = None
    recommendation: str = ""
    headlines: tuple[str, ...] = ()
    source_note: str = "yfinance company profile/news; verify with broker quote before trading"


@dataclass(frozen=True)
class NewsHeadline:
    title: str
    publisher: str = ""
    published_at: datetime | None = None
    link: str = ""


def fetch_equity_research(tickers: Iterable[str], *, news_limit: int = 3) -> list[EquityResearch]:
    items: list[EquityResearch] = []
    for ticker in normalize_tickers(tickers):
        stock = yf.Ticker(ticker)
        info = safe_info(stock)
        headlines = safe_headlines(stock, limit=news_limit)
        items.append(
            EquityResearch(
                ticker=ticker,
                company_name=str(info.get("longName") or info.get("shortName") or ""),
                sector=str(info.get("sector") or ""),
                market_cap=number_or_none(info.get("marketCap")),
                trailing_pe=number_or_none(info.get("trailingPE")),
                forward_pe=number_or_none(info.get("forwardPE")),
                revenue_growth=number_or_none(info.get("revenueGrowth")),
                recommendation=str(info.get("recommendationKey") or ""),
                headlines=tuple(headlines),
            )
        )
    return items


def safe_info(stock: yf.Ticker) -> Mapping[str, object]:
    try:
        return stock.get_info() or {}
    except Exception:
        return {}


def safe_headlines(stock: yf.Ticker, *, limit: int) -> list[str]:
    try:
        news = stock.news or []
    except Exception:
        return []
    headlines: list[str] = []
    for item in news:
        title = title_from_news_item(item)
        if title:
            headlines.append(title)
        if len(headlines) >= limit:
            break
    return headlines


def fetch_today_headlines(
    ticker: str,
    *,
    now: datetime,
    limit: int = 3,
    timezone_name: str = "America/New_York",
) -> list[NewsHeadline]:
    provider_headlines = fetch_provider_today_headlines(
        ticker,
        now=now,
        limit=limit,
        timezone_name=timezone_name,
    )
    if provider_headlines:
        return provider_headlines

    stock = yf.Ticker(ticker)
    try:
        news = stock.news or []
    except Exception:
        return []
    return same_day_headlines(news, now=now, limit=limit, timezone_name=timezone_name, ticker=ticker)


def fetch_provider_today_headlines(
    ticker: str,
    *,
    now: datetime,
    limit: int = 3,
    timezone_name: str = "America/New_York",
) -> list[NewsHeadline]:
    keys = load_provider_keys()
    headlines: list[NewsHeadline] = []
    if keys.fmp_api_key:
        headlines.extend(
            fetch_fmp_today_headlines(
                ticker,
                now=now,
                limit=limit,
                api_key=keys.fmp_api_key,
                timezone_name=timezone_name,
            )
        )
    if keys.alpha_vantage_api_key:
        headlines.extend(
            fetch_alpha_vantage_today_headlines(
                ticker,
                now=now,
                limit=limit,
                api_key=keys.alpha_vantage_api_key,
                timezone_name=timezone_name,
            )
        )
    return sorted(
        dedupe_headlines(headlines),
        key=lambda item: item.published_at or datetime.min.replace(tzinfo=ZoneInfo(timezone_name)),
        reverse=True,
    )[:limit]


def fetch_fmp_today_headlines(
    ticker: str,
    *,
    now: datetime,
    api_key: str,
    limit: int = 3,
    timezone_name: str = "America/New_York",
) -> list[NewsHeadline]:
    if not api_key:
        return []
    query = urllib.parse.urlencode({"symbols": ticker.upper(), "limit": max(limit * 4, limit), "apikey": api_key})
    try:
        payload = fetch_json(f"{FMP_URL}/news/stock?{query}")
    except Exception:
        return []
    return same_day_headlines(
        payload if isinstance(payload, list) else [],
        now=now,
        limit=limit,
        timezone_name=timezone_name,
        ticker=ticker,
    )


def fetch_alpha_vantage_today_headlines(
    ticker: str,
    *,
    now: datetime,
    api_key: str,
    limit: int = 3,
    timezone_name: str = "America/New_York",
) -> list[NewsHeadline]:
    if not api_key:
        return []
    query = urllib.parse.urlencode(
        {
            "function": "NEWS_SENTIMENT",
            "tickers": ticker.upper(),
            "limit": max(limit * 4, limit),
            "apikey": api_key,
        }
    )
    try:
        payload = fetch_json(f"{ALPHA_VANTAGE_URL}?{query}")
    except Exception:
        return []
    if not isinstance(payload, Mapping):
        return []
    feed = payload.get("feed")
    return same_day_headlines(
        feed if isinstance(feed, list) else [],
        now=now,
        limit=limit,
        timezone_name=timezone_name,
        ticker=ticker,
    )


def same_day_headlines(
    news: Iterable[Mapping[str, object]],
    *,
    now: datetime,
    limit: int,
    timezone_name: str,
    ticker: str = "",
) -> list[NewsHeadline]:
    tz = ZoneInfo(timezone_name)
    today = now.astimezone(tz).date()
    headlines: list[NewsHeadline] = []
    for item in news:
        if not isinstance(item, Mapping):
            continue
        if ticker and not news_item_matches_ticker(item, ticker):
            continue
        headline = headline_from_news_item(item, timezone_name=timezone_name)
        if not headline.title:
            continue
        if headline.published_at is None or headline.published_at.astimezone(tz).date() != today:
            continue
        headlines.append(headline)
        if len(headlines) >= limit:
            break
    return headlines


def dedupe_headlines(headlines: Iterable[NewsHeadline]) -> list[NewsHeadline]:
    seen: set[str] = set()
    unique: list[NewsHeadline] = []
    for item in headlines:
        key = item.title.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def news_item_matches_ticker(item: Mapping[str, object], ticker: str) -> bool:
    wanted = ticker.upper()
    for key in ("symbol", "ticker"):
        value = item.get(key)
        if isinstance(value, str) and value.strip().upper() == wanted:
            return True
    for key in ("symbols", "tickers"):
        value = item.get(key)
        if isinstance(value, str) and any(part.strip().upper() == wanted for part in value.replace(";", ",").split(",")):
            return True
        if isinstance(value, list) and any(str(part).strip().upper() == wanted for part in value):
            return True

    title = title_from_news_item(item).lower()
    if not title:
        return False
    if re_contains_ticker(title, wanted):
        return True
    return any(alias.lower() in title for alias in COMPANY_NEWS_ALIASES.get(wanted, ()))


def re_contains_ticker(text: str, ticker: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(ticker.lower())}(?![a-z0-9])", text) is not None


def headline_from_news_item(item: Mapping[str, object], *, timezone_name: str = "America/New_York") -> NewsHeadline:
    title = title_from_news_item(item)
    return NewsHeadline(
        title=title,
        publisher=publisher_from_news_item(item),
        published_at=published_at_from_news_item(item, timezone_name=timezone_name),
        link=link_from_news_item(item),
    )


def title_from_news_item(item: Mapping[str, object]) -> str:
    content = item.get("content")
    if isinstance(content, Mapping):
        title = content.get("title")
        return str(title or "").strip()
    title = item.get("title")
    return str(title or "").strip()


def publisher_from_news_item(item: Mapping[str, object]) -> str:
    content = item.get("content")
    if isinstance(content, Mapping):
        provider = content.get("provider")
        if isinstance(provider, Mapping):
            name = provider.get("displayName") or provider.get("name")
            if name:
                return str(name).strip()
        for key in ("providerName", "publisher", "site", "source"):
            value = content.get(key)
            if value:
                return str(value).strip()
    value = item.get("publisher") or item.get("site") or item.get("source")
    return str(value or "").strip()


def published_at_from_news_item(item: Mapping[str, object], *, timezone_name: str = "America/New_York") -> datetime | None:
    content = item.get("content")
    candidates: list[object] = []
    if isinstance(content, Mapping):
        candidates.extend(
            [
                content.get("pubDate"),
                content.get("displayTime"),
                content.get("providerPublishTime"),
                content.get("publishedDate"),
                content.get("time_published"),
            ]
        )
    candidates.extend(
        [
            item.get("providerPublishTime"),
            item.get("pubDate"),
            item.get("displayTime"),
            item.get("publishedDate"),
            item.get("published_at"),
            item.get("date"),
            item.get("time_published"),
        ]
    )

    tz = ZoneInfo(timezone_name)
    for value in candidates:
        if isinstance(value, (int, float)):
            try:
                return datetime.fromtimestamp(float(value), tz=tz)
            except (OverflowError, OSError, ValueError):
                continue
        if isinstance(value, str) and value.strip():
            raw = value.strip().replace("Z", "+00:00")
            if len(raw) == 15 and raw[8] == "T":
                try:
                    parsed = datetime.strptime(raw, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                    return parsed.astimezone(tz)
                except ValueError:
                    pass
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=tz)
            return parsed.astimezone(tz)
    return None


def link_from_news_item(item: Mapping[str, object]) -> str:
    content = item.get("content")
    if isinstance(content, Mapping):
        canonical = content.get("canonicalUrl")
        if isinstance(canonical, Mapping):
            url = canonical.get("url")
            if url:
                return str(url).strip()
        click_through = content.get("clickThroughUrl")
        if isinstance(click_through, Mapping):
            url = click_through.get("url")
            if url:
                return str(url).strip()
        url = content.get("url")
        if url:
            return str(url).strip()
    url = item.get("link")
    return str(url or "").strip()


def number_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def money(value: float | None) -> str:
    if value is None:
        return "N/A"
    if value >= 1_000_000_000_000:
        return f"${value / 1_000_000_000_000:.2f}T"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def ratio(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.1f}"


def pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.1f}%"


def write_research_report(
    items: Sequence[EquityResearch],
    *,
    path: Path = RESEARCH_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Equity Research Context",
        "",
        "This report adds company/profile/news context. It is not a broker quote and does not place orders.",
        "",
        "| Ticker | Company | Sector | Market Cap | TTM P/E | Forward P/E | Revenue Growth | Recommendation |",
        "|---|---|---|---:|---:|---:|---:|---|",
    ]
    for item in items:
        lines.append(
            "| "
            f"{item.ticker} | {item.company_name or 'N/A'} | {item.sector or 'N/A'} | "
            f"{money(item.market_cap)} | {ratio(item.trailing_pe)} | {ratio(item.forward_pe)} | "
            f"{pct(item.revenue_growth)} | {item.recommendation or 'N/A'} |"
        )
    for item in items:
        if not item.headlines:
            continue
        lines.extend(["", f"## {item.ticker} Headlines", ""])
        lines.extend(f"- {headline}" for headline in item.headlines)
    lines.append("")
    path.write_text("\n".join(lines))
    return path
