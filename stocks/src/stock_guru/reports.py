from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import REPORT_DIR, Settings
from .scoring import Candidate


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def money(value: float) -> str:
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def write_markdown_report(
    candidates: list[Candidate],
    settings: Settings,
    budget: float,
    path: Path | None = None,
) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    target = path or REPORT_DIR / "latest.md"
    now = datetime.now(ZoneInfo(settings.market_timezone))

    lines = [
        "# Stock Guru Report",
        "",
        f"Generated: {now:%Y-%m-%d %H:%M %Z}",
        f"Budget model: ${budget:,.2f}",
        "",
        "This is decision support, not financial advice. Verify quotes and fundamentals before trading.",
        "",
        "| Rank | Ticker | Rating | Score | Price | 1D | 20D | 60D | Vol | Liquidity | Size | Reasons |",
        "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for idx, item in enumerate(candidates, start=1):
        reasons = ", ".join(item.reasons) if item.reasons else "none"
        lines.append(
            "| "
            f"{idx} | {item.ticker} | {item.rating} | {item.score:.1f} | "
            f"${item.price:.2f} | {pct(item.daily_return)} | {pct(item.momentum_20d)} | "
            f"{pct(item.momentum_60d)} | {pct(item.volatility_20d)} | "
            f"{money(item.dollar_volume)} | {item.suggested_shares} sh | {reasons} |"
        )

    target.write_text("\n".join(lines) + "\n")
    return target
