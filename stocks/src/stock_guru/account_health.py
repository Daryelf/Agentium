from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from .broker import BrokerGuardrails, account_state_ready
from .broker_client import BrokerClient
from .config import DATA_DIR, Settings
from .intraday import spread_pct


ACCOUNT_HEALTH_REPORT_PATH = DATA_DIR / "broker_account_health.json"


@dataclass(frozen=True)
class AccountHealthIssue:
    severity: str
    code: str
    detail: str
    symbol: str = ""


@dataclass(frozen=True)
class BrokerAccountHealthReport:
    generated_at: str
    account_number: str
    account_value: float
    buying_power: float
    cash: float
    deployed_dollars: float
    open_orders: int
    positions: int
    symbols_checked: list[str]
    issues: list[AccountHealthIssue]
    safe_for_entries: bool

    @property
    def blockers(self) -> list[AccountHealthIssue]:
        return [issue for issue in self.issues if issue.severity == "blocker"]

    @property
    def warnings(self) -> list[AccountHealthIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]


def build_account_health_report(
    *,
    settings: Settings,
    account_number: str,
    symbols: list[str],
    broker: BrokerClient | None,
    now: datetime,
) -> BrokerAccountHealthReport:
    issues: list[AccountHealthIssue] = []
    unique_symbols = list(dict.fromkeys(symbol.upper() for symbol in symbols if symbol.strip()))
    if broker is None:
        return BrokerAccountHealthReport(
            generated_at=now.isoformat(timespec="seconds"),
            account_number=account_number,
            account_value=0.0,
            buying_power=0.0,
            cash=0.0,
            deployed_dollars=0.0,
            open_orders=0,
            positions=0,
            symbols_checked=unique_symbols,
            issues=[
                AccountHealthIssue(
                    severity="blocker",
                    code="broker_missing",
                    detail="broker client missing; cannot inspect live account health",
                )
            ],
            safe_for_entries=False,
        )

    try:
        account = broker.get_portfolio(account_number)
        positions = broker.get_positions(account_number)
        orders = broker.get_orders(account_number)
        quotes = broker.get_quotes(unique_symbols)
        tradability = broker.get_tradability(account_number, unique_symbols)
    except Exception as exc:
        return BrokerAccountHealthReport(
            generated_at=now.isoformat(timespec="seconds"),
            account_number=account_number,
            account_value=0.0,
            buying_power=0.0,
            cash=0.0,
            deployed_dollars=0.0,
            open_orders=0,
            positions=0,
            symbols_checked=unique_symbols,
            issues=[
                AccountHealthIssue(
                    severity="blocker",
                    code="broker_read_failed",
                    detail=f"broker account health read failed: {exc}",
                )
            ],
            safe_for_entries=False,
        )

    ready, account_reasons = account_state_ready(account)
    if account.account_number.strip() != account_number.strip():
        issues.append(
            AccountHealthIssue(
                severity="blocker",
                code="account_identity_mismatch",
                detail="broker account number does not match requested Agentic account",
            )
        )
    for reason in account_reasons:
        issues.append(AccountHealthIssue(severity="blocker", code="account_state", detail=reason))
    guardrails = BrokerGuardrails.from_settings(settings)
    next_ticket = guardrails.cap_order(
        requested_dollars=guardrails.max_order_dollars,
        buying_power=account.buying_power,
        account_value=account.account_value,
        deployed_dollars=account.deployed_dollars,
    )
    if next_ticket <= 0:
        issues.append(
            AccountHealthIssue(
                severity="blocker",
                code="guardrail_ticket_blocked",
                detail="guardrails leave no allowed entry ticket",
            )
        )

    open_orders = [order for order in orders if order.is_open]
    if open_orders:
        issues.append(
            AccountHealthIssue(
                severity="blocker",
                code="open_orders_present",
                detail=f"{len(open_orders)} open broker order(s) must reconcile before new entries",
            )
        )

    for symbol in unique_symbols:
        quote = quotes.get(symbol)
        if quote is None:
            issues.append(AccountHealthIssue("blocker", "quote_missing", f"{symbol}: broker quote missing", symbol))
            continue
        if not quote.data_fresh or quote.last is None or quote.last <= 0:
            issues.append(AccountHealthIssue("blocker", "quote_stale", f"{symbol}: broker quote stale or invalid", symbol))
            continue
        current_spread = spread_pct(quote, quote.last)
        if current_spread > settings.intraday_max_spread_pct:
            issues.append(
                AccountHealthIssue(
                    "blocker",
                    "spread_unsafe",
                    f"{symbol}: spread {current_spread:.4%} exceeds {settings.intraday_max_spread_pct:.4%}",
                    symbol,
                )
            )
        if tradability.get(symbol) is not True:
            issues.append(AccountHealthIssue("blocker", "not_tradable", f"{symbol}: broker tradability check failed", symbol))

    return BrokerAccountHealthReport(
        generated_at=now.isoformat(timespec="seconds"),
        account_number=account.account_number,
        account_value=round(account.account_value, 4),
        buying_power=round(account.buying_power, 4),
        cash=round(account.cash, 4),
        deployed_dollars=round(account.deployed_dollars, 4),
        open_orders=len(open_orders),
        positions=len(positions),
        symbols_checked=unique_symbols,
        issues=issues,
        safe_for_entries=ready and not any(issue.severity == "blocker" for issue in issues),
    )


def write_account_health_report(
    report: BrokerAccountHealthReport,
    path: Path = ACCOUNT_HEALTH_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(report), indent=2, sort_keys=True) + "\n")
    return path
