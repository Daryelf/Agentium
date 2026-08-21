from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence
import json
import re
import urllib.parse
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from .config import REPORT_DIR, normalize_tickers
from .data import ALPHA_VANTAGE_URL, FMP_URL, fetch_json, load_provider_keys
from .catalysts import build_catalyst_events, summarize_catalysts
from .provider_budget import reserve_provider_budget


RESEARCH_REPORT_PATH = REPORT_DIR / "research.md"
RESEARCH_JSON_PATH = REPORT_DIR / "research.json"
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
    earnings_growth: float | None = None
    eps_growth: float | None = None
    profit_margins: float | None = None
    operating_margins: float | None = None
    free_cash_flow: float | None = None
    total_debt: float | None = None
    debt_to_equity: float | None = None
    peg_ratio: float | None = None
    price_to_sales: float | None = None
    enterprise_to_revenue: float | None = None
    trailing_eps: float | None = None
    forward_eps: float | None = None
    next_earnings_at: datetime | None = None
    earnings_source: str = "UNKNOWN"
    earnings_conflict: bool = False
    recommendation: str = ""
    headlines: tuple[str, ...] = ()
    news_items: tuple[NewsHeadline, ...] = ()
    source_note: str = "yfinance company profile/news; verify with broker quote before trading"


@dataclass(frozen=True)
class NewsHeadline:
    title: str
    publisher: str = ""
    published_at: datetime | None = None
    link: str = ""


def fetch_equity_research(tickers: Iterable[str], *, news_limit: int = 3) -> list[EquityResearch]:
    items: list[EquityResearch] = []
    keys = load_provider_keys()
    now = datetime.now(timezone.utc)
    for ticker in normalize_tickers(tickers):
        yahoo_budget = reserve_provider_budget("YFINANCE", 1)
        stock = yf.Ticker(ticker)
        info = safe_info(stock) if yahoo_budget.allowed else {}
        news_items = safe_news_items(stock, limit=news_limit) if yahoo_budget.allowed else []
        yahoo_earnings = safe_next_earnings_at(stock, now=now) if yahoo_budget.allowed else None
        fmp_earnings = fetch_fmp_next_earnings(ticker, api_key=keys.fmp_api_key, now=now) if keys.fmp_api_key else None
        next_earnings, earnings_source, earnings_conflict = reconcile_earnings_dates(yahoo_earnings, fmp_earnings)
        items.append(
            EquityResearch(
                ticker=ticker,
                company_name=str(info.get("longName") or info.get("shortName") or ""),
                sector=str(info.get("sector") or ""),
                market_cap=number_or_none(info.get("marketCap")),
                trailing_pe=number_or_none(info.get("trailingPE")),
                forward_pe=number_or_none(info.get("forwardPE")),
                revenue_growth=number_or_none(info.get("revenueGrowth")),
                earnings_growth=number_or_none(info.get("earningsGrowth")),
                eps_growth=number_or_none(info.get("earningsQuarterlyGrowth") or info.get("earningsGrowth")),
                profit_margins=number_or_none(info.get("profitMargins")),
                operating_margins=number_or_none(info.get("operatingMargins")),
                free_cash_flow=number_or_none(info.get("freeCashflow")),
                total_debt=number_or_none(info.get("totalDebt")),
                debt_to_equity=number_or_none(info.get("debtToEquity")),
                peg_ratio=number_or_none(info.get("pegRatio")),
                price_to_sales=number_or_none(info.get("priceToSalesTrailing12Months")),
                enterprise_to_revenue=number_or_none(info.get("enterpriseToRevenue")),
                trailing_eps=number_or_none(info.get("trailingEps")),
                forward_eps=number_or_none(info.get("forwardEps")),
                next_earnings_at=next_earnings,
                earnings_source=earnings_source,
                earnings_conflict=earnings_conflict,
                recommendation=str(info.get("recommendationKey") or ""),
                headlines=tuple(item.title for item in news_items),
                news_items=tuple(news_items),
            )
        )
    return items


def _datetime_or_none(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        candidates = [_datetime_or_none(item) for item in value]
        available = [item for item in candidates if item is not None]
        return min(available) if available else None
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("America/New_York")
    return parsed.tz_convert("UTC").to_pydatetime()


def safe_next_earnings_at(stock: yf.Ticker, *, now: datetime) -> datetime | None:
    try:
        calendar = stock.calendar
    except Exception:
        return None
    candidates: list[datetime] = []
    if isinstance(calendar, Mapping):
        raw = calendar.get("Earnings Date") or calendar.get("earningsDate")
        parsed = _datetime_or_none(raw)
        if parsed is not None:
            candidates.append(parsed)
    elif hasattr(calendar, "loc"):
        for key in ("Earnings Date", "earningsDate"):
            try:
                parsed = _datetime_or_none(calendar.loc[key].tolist())
            except Exception:
                continue
            if parsed is not None:
                candidates.append(parsed)
    cutoff = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    future = [item for item in candidates if item >= cutoff.astimezone(timezone.utc)]
    return min(future) if future else None


def fetch_fmp_next_earnings(ticker: str, *, api_key: str, now: datetime) -> datetime | None:
    if not api_key:
        return None
    budget = reserve_provider_budget("FMP", 1)
    if not budget.allowed:
        return None
    query = urllib.parse.urlencode({"symbol": ticker.upper(), "apikey": api_key})
    try:
        payload = fetch_json(f"{FMP_URL}/earnings?{query}")
    except Exception:
        return None
    if not isinstance(payload, list):
        return None
    cutoff = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    candidates = []
    for item in payload:
        if not isinstance(item, Mapping):
            continue
        if str(item.get("symbol") or ticker).upper() != ticker.upper():
            continue
        parsed = _datetime_or_none(item.get("date") or item.get("fiscalDateEnding"))
        if parsed is not None and parsed >= cutoff.astimezone(timezone.utc):
            candidates.append(parsed)
    return min(candidates) if candidates else None


def reconcile_earnings_dates(yahoo_date: datetime | None, fmp_date: datetime | None) -> tuple[datetime | None, str, bool]:
    if yahoo_date is None and fmp_date is None:
        return None, "UNKNOWN", False
    if yahoo_date is None:
        return fmp_date, "FMP", False
    if fmp_date is None:
        return yahoo_date, "YFINANCE", False
    conflict = abs((yahoo_date.date() - fmp_date.date()).days) > 1
    return min(yahoo_date, fmp_date), "FMP+YFINANCE", conflict


def safe_info(stock: yf.Ticker) -> Mapping[str, object]:
    try:
        return stock.get_info() or {}
    except Exception:
        return {}


def safe_headlines(stock: yf.Ticker, *, limit: int) -> list[str]:
    return [item.title for item in safe_news_items(stock, limit=limit)]


def safe_news_items(stock: yf.Ticker, *, limit: int) -> list[NewsHeadline]:
    try:
        news = stock.news or []
    except Exception:
        return []
    headlines: list[NewsHeadline] = []
    for item in news:
        headline = headline_from_news_item(item)
        if headline.title:
            headlines.append(headline)
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


def write_research_json(
    items: Sequence[EquityResearch],
    *,
    path: Path = RESEARCH_JSON_PATH,
    generated_at: datetime | None = None,
) -> Path:
    """Write browser-safe structured research with conservative timestamped catalyst rules."""
    received_at = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    observed_at = received_at.isoformat()
    structured = []
    for item in items:
        events = build_catalyst_events(item.ticker, item.news_items, received_at=received_at)
        summary = summarize_catalysts(events)
        structured.append((item, events, summary))
    payload = {
        "version": 2,
        "generated_at": observed_at,
        "source": "yfinance_profile_news_with_optional_configured_provider_context",
        "directional_news_scoring": True,
        "catalyst_methodology": "deterministic_headline_rules_v1; only fresh timestamped directional events affect catalyst score; no LLM sentiment",
        "tickers": [
            {
                "ticker": item.ticker,
                "company_name": item.company_name,
                "sector": item.sector,
                "market_cap": item.market_cap,
                "trailing_pe": item.trailing_pe,
                "forward_pe": item.forward_pe,
                "revenue_growth": item.revenue_growth,
                "earnings_growth": item.earnings_growth,
                "eps_growth": item.eps_growth,
                "profit_margins": item.profit_margins,
                "operating_margins": item.operating_margins,
                "free_cash_flow": item.free_cash_flow,
                "total_debt": item.total_debt,
                "debt_to_equity": item.debt_to_equity,
                "peg_ratio": item.peg_ratio,
                "price_to_sales": item.price_to_sales,
                "enterprise_to_revenue": item.enterprise_to_revenue,
                "trailing_eps": item.trailing_eps,
                "forward_eps": item.forward_eps,
                "next_earnings_at": item.next_earnings_at.isoformat() if item.next_earnings_at else None,
                "earnings_source": item.earnings_source,
                "earnings_conflict": item.earnings_conflict,
                "recommendation": item.recommendation,
                "source_note": item.source_note,
                "catalyst_score": summary.score,
                "catalyst_confidence": summary.confidence,
                "catalyst_summary": summary.to_dict(),
                "news": [
                    {
                        "title": news.title,
                        "publisher": news.publisher,
                        "published_at": news.published_at.isoformat() if news.published_at else None,
                        "url": news.link,
                        "catalyst": next((event.to_dict() for event in events if event.title == news.title), None),
                    }
                    for news in item.news_items
                ],
            }
            for item, events, summary in structured
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def load_research_json(path: Path = RESEARCH_JSON_PATH) -> dict[str, EquityResearch]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}
    rows = payload.get("tickers", []) if isinstance(payload, Mapping) else []
    if not isinstance(rows, list):
        return {}
    result: dict[str, EquityResearch] = {}
    numeric_fields = (
        "market_cap", "trailing_pe", "forward_pe", "revenue_growth", "earnings_growth", "eps_growth",
        "profit_margins", "operating_margins", "free_cash_flow", "total_debt", "debt_to_equity",
        "peg_ratio", "price_to_sales", "enterprise_to_revenue", "trailing_eps", "forward_eps",
    )
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        ticker = str(row.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        news_items: list[NewsHeadline] = []
        for item in row.get("news", []) if isinstance(row.get("news"), list) else []:
            if not isinstance(item, Mapping):
                continue
            news_items.append(NewsHeadline(
                title=str(item.get("title") or "").strip(),
                publisher=str(item.get("publisher") or "").strip(),
                published_at=_datetime_or_none(item.get("published_at")),
                link=str(item.get("url") or "").strip(),
            ))
        numeric = {field: number_or_none(row.get(field)) for field in numeric_fields}
        result[ticker] = EquityResearch(
            ticker=ticker,
            company_name=str(row.get("company_name") or ""),
            sector=str(row.get("sector") or ""),
            recommendation=str(row.get("recommendation") or ""),
            headlines=tuple(item.title for item in news_items),
            news_items=tuple(news_items),
            next_earnings_at=_datetime_or_none(row.get("next_earnings_at")),
            earnings_source=str(row.get("earnings_source") or "UNKNOWN"),
            earnings_conflict=bool(row.get("earnings_conflict")),
            source_note=str(row.get("source_note") or "persisted structured research context"),
            **numeric,
        )
    return result
