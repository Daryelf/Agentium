from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import LEDGER_PATH


HEADER = ["timestamp", "side", "ticker", "shares", "price", "notional", "note"]


@dataclass(frozen=True)
class PaperTrade:
    timestamp: str
    side: str
    ticker: str
    shares: float
    price: float
    notional: float
    note: str


def ensure_ledger(path: Path = LEDGER_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with path.open("w", newline="") as handle:
            csv.writer(handle).writerow(HEADER)


def record_trade(
    side: str,
    ticker: str,
    shares: float,
    price: float,
    note: str = "",
    tz_name: str = "America/New_York",
    path: Path = LEDGER_PATH,
) -> PaperTrade:
    ensure_ledger(path)
    clean_side = side.upper()
    clean_ticker = ticker.upper()
    notional = shares * price
    trade = PaperTrade(
        timestamp=datetime.now(ZoneInfo(tz_name)).isoformat(timespec="seconds"),
        side=clean_side,
        ticker=clean_ticker,
        shares=shares,
        price=price,
        notional=notional,
        note=note,
    )
    with path.open("a", newline="") as handle:
        csv.writer(handle).writerow(
            [
                trade.timestamp,
                trade.side,
                trade.ticker,
                trade.shares,
                f"{trade.price:.4f}",
                f"{trade.notional:.2f}",
                trade.note,
            ]
        )
    return trade


def read_ledger(path: Path = LEDGER_PATH) -> list[PaperTrade]:
    ensure_ledger(path)
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    return [
        PaperTrade(
            timestamp=row["timestamp"],
            side=row["side"],
            ticker=row["ticker"],
            shares=float(row["shares"]),
            price=float(row["price"]),
            notional=float(row["notional"]),
            note=row["note"],
        )
        for row in rows
    ]
