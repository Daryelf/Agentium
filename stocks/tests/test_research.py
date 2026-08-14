from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from stock_guru.research import (
    EquityResearch,
    NewsHeadline,
    fetch_alpha_vantage_today_headlines,
    fetch_fmp_today_headlines,
    headline_from_news_item,
    title_from_news_item,
    write_research_json,
    write_research_report,
)


def test_title_from_current_yfinance_news_shape() -> None:
    title = title_from_news_item({"content": {"title": "Company expands margin"}})

    assert title == "Company expands margin"


def test_headline_from_current_yfinance_news_shape_reads_time_source_and_link() -> None:
    headline = headline_from_news_item(
        {
            "content": {
                "title": "Company expands margin",
                "provider": {"displayName": "Reuters"},
                "pubDate": "2026-06-09T14:44:22Z",
                "canonicalUrl": {"url": "https://example.com/news"},
            }
        },
        timezone_name="America/New_York",
    )

    assert headline.title == "Company expands margin"
    assert headline.publisher == "Reuters"
    assert headline.published_at == datetime(2026, 6, 9, 10, 44, 22, tzinfo=ZoneInfo("America/New_York"))
    assert headline.link == "https://example.com/news"


def test_fetch_fmp_today_headlines_reads_same_day_company_news(monkeypatch) -> None:
    monkeypatch.setattr(
        "stock_guru.research.fetch_json",
        lambda *_args, **_kwargs: [
            {
                "title": "Bank of America says trading revenue may beat forecast",
                "site": "Reuters",
                "publishedDate": "2026-06-09T12:30:00-04:00",
                "url": "https://example.com/bac",
            },
            {
                "title": "Yesterday headline",
                "site": "Wire",
                "publishedDate": "2026-06-08T12:30:00-04:00",
                "url": "https://example.com/old",
            },
        ],
    )

    headlines = fetch_fmp_today_headlines(
        "BAC",
        now=datetime(2026, 6, 9, 15, 0, tzinfo=ZoneInfo("America/New_York")),
        api_key="token",
        timezone_name="America/New_York",
    )

    assert len(headlines) == 1
    assert headlines[0].title == "Bank of America says trading revenue may beat forecast"
    assert headlines[0].publisher == "Reuters"


def test_fetch_alpha_vantage_today_headlines_reads_same_day_company_news(monkeypatch) -> None:
    monkeypatch.setattr(
        "stock_guru.research.fetch_json",
        lambda *_args, **_kwargs: {
            "feed": [
                {
                    "title": "BAC gains after markets revenue update",
                    "source": "Alpha Wire",
                    "time_published": "20260609T163000",
                    "url": "https://example.com/bac-alpha",
                }
            ]
        },
    )

    headlines = fetch_alpha_vantage_today_headlines(
        "BAC",
        now=datetime(2026, 6, 9, 15, 0, tzinfo=ZoneInfo("America/New_York")),
        api_key="token",
        timezone_name="America/New_York",
    )

    assert len(headlines) == 1
    assert headlines[0].title == "BAC gains after markets revenue update"
    assert headlines[0].published_at == datetime(2026, 6, 9, 12, 30, tzinfo=ZoneInfo("America/New_York"))


def test_write_research_report_includes_profile_and_headlines(tmp_path) -> None:
    path = tmp_path / "research.md"
    item = EquityResearch(
        ticker="AAPL",
        company_name="Apple Inc.",
        sector="Technology",
        market_cap=3_000_000_000_000,
        trailing_pe=30.25,
        forward_pe=25.5,
        revenue_growth=0.07,
        recommendation="buy",
        headlines=("Apple headline",),
    )

    write_research_report([item], path=path)

    content = path.read_text()
    assert "Apple Inc." in content
    assert "$3.00T" in content
    assert "Apple headline" in content


def test_write_research_json_preserves_source_time_and_url_without_fake_sentiment(tmp_path) -> None:
    path = tmp_path / "research.json"
    published = datetime(2026, 6, 9, 10, 44, tzinfo=ZoneInfo("America/New_York"))
    item = EquityResearch(
        ticker="NET",
        company_name="Cloudflare, Inc.",
        news_items=(
            NewsHeadline(title="Cloudflare updates guidance", publisher="Reuters", published_at=published, link="https://example.com/net"),
        ),
    )
    write_research_json([item], path=path, generated_at=datetime(2026, 6, 9, 15, 0, tzinfo=ZoneInfo("America/New_York")))
    payload = __import__("json").loads(path.read_text())
    assert payload["directional_news_scoring"] is False
    assert payload["tickers"][0]["news"][0]["publisher"] == "Reuters"
    assert payload["tickers"][0]["news"][0]["url"] == "https://example.com/net"
    assert payload["tickers"][0]["news"][0]["published_at"] == published.isoformat()
