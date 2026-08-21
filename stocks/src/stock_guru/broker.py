from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from .config import EXECUTION_POLICY_APPROVAL, REPORT_DIR, Settings
from .intraday import AUTO_ORDER_READY, INTRADAY_EXIT, LARGE_AUTO_ORDER_READY, IntradayExitDecision
from .lifecycle import BrokerReview, OrderPlan, TradeIntent


MISSION_REPORT_PATH = REPORT_DIR / "mission.md"


@dataclass(frozen=True)
class BrokerGuardrails:
    account_nickname: str
    principal_dollars: float
    max_total_dollars: float
    max_order_dollars: float
    min_order_dollars: float
    cash_reserve_dollars: float
    lock_profits: bool

    @classmethod
    def from_settings(cls, settings: Settings) -> "BrokerGuardrails":
        return cls(
            account_nickname=settings.live_account_nickname,
            principal_dollars=settings.live_principal_dollars,
            max_total_dollars=settings.live_max_total_dollars,
            max_order_dollars=settings.live_max_order_dollars,
            min_order_dollars=settings.live_min_order_dollars,
            cash_reserve_dollars=settings.live_cash_reserve_dollars,
            lock_profits=settings.live_lock_profits,
        )

    def profit_reserve(self, *, account_value: float) -> float:
        if not self.lock_profits:
            return 0.0
        return round(max(0.0, account_value - self.principal_dollars), 2)

    def working_bankroll(self, *, account_value: float) -> float:
        if not self.lock_profits:
            return min(account_value, self.max_total_dollars)
        return min(account_value, self.principal_dollars, self.max_total_dollars)

    def cap_order(
        self,
        *,
        requested_dollars: float,
        buying_power: float,
        account_value: float,
        deployed_dollars: float = 0.0,
    ) -> float:
        available_after_reserve = max(0.0, buying_power - self.cash_reserve_dollars)
        remaining_total = max(0.0, self.working_bankroll(account_value=account_value) - deployed_dollars)
        capped = min(requested_dollars, self.max_order_dollars, available_after_reserve, remaining_total)
        if capped < self.min_order_dollars:
            return 0.0
        return round(capped, 2)

    def summary(self) -> str:
        profit_rule = "profits above principal locked" if self.lock_profits else "profits reusable"
        return (
            f"{self.account_nickname} only; long equities only; "
            f"${self.principal_dollars:,.2f} principal bankroll; "
            f"${self.max_total_dollars:,.2f} max deployed; "
            f"up to ${self.max_order_dollars:,.2f} per order; "
            f"${self.cash_reserve_dollars:,.2f} cash reserve; "
            f"{profit_rule}"
        )


@dataclass(frozen=True)
class BrokerMission:
    account_label: str
    account_value: float
    cash: float
    buying_power: float
    deployed_dollars: float = 0.0
    open_orders: int = 0
    positions: int = 0

    @property
    def idle_cash(self) -> float:
        return max(0.0, self.cash - self.deployed_dollars)


@dataclass(frozen=True)
class BrokerAccountState:
    account_number: str
    account_value: float
    cash: float
    buying_power: float
    deployed_dollars: float = 0.0
    open_orders: int = 0
    positions: int = 0
    warnings: list[str] = field(default_factory=list)
    restrictions: list[str] = field(default_factory=list)
    margin_state: str = ""
    unsettled_funds: float = 0.0


@dataclass(frozen=True)
class BrokerOrderInput:
    symbol: str
    side: str
    dollar_amount: float
    order_type: str = "market"
    quantity: float | None = None
    limit_price: float | None = None
    stop_price: float | None = None
    time_in_force: str = "gfd"
    market_hours: str = "regular_hours"


def account_state_ready(account: BrokerAccountState | None) -> tuple[bool, list[str]]:
    if account is None:
        return False, ["broker account state missing"]
    reasons: list[str] = []
    if not account.account_number.strip():
        reasons.append("broker account number missing")
    if account.buying_power <= 0:
        reasons.append("buying power unavailable")
    if account.warnings:
        reasons.append("broker warnings present: " + "; ".join(account.warnings))
    if account.restrictions:
        reasons.append("account restrictions present: " + "; ".join(account.restrictions))
    if account.open_orders > 0:
        reasons.append("open broker orders already exist")
    if account.unsettled_funds < 0:
        reasons.append("unsettled funds state invalid")
    return not reasons, reasons


def account_state_ready_for_exit(account: BrokerAccountState | None) -> tuple[bool, list[str]]:
    if account is None:
        return False, ["broker account state missing"]
    reasons: list[str] = []
    if not account.account_number.strip():
        reasons.append("broker account number missing")
    if account.warnings:
        reasons.append("broker warnings present: " + "; ".join(account.warnings))
    if account.restrictions:
        reasons.append("account restrictions present: " + "; ".join(account.restrictions))
    if account.unsettled_funds < 0:
        reasons.append("unsettled funds state invalid")
    return not reasons, reasons


def build_auto_order_plan(
    intent: TradeIntent,
    *,
    settings: Settings,
    guardrails: BrokerGuardrails,
    account: BrokerAccountState | None,
    broker_review: BrokerReview | None,
    ref_id: str | None = None,
    existing_symbol_exposure: float = 0.0,
) -> OrderPlan:
    ready, reasons = account_state_ready(account)
    if settings.execution_policy != EXECUTION_POLICY_APPROVAL:
        reasons.append("execution policy must require Argentum Human Gate approval")
    if intent.status not in {AUTO_ORDER_READY, LARGE_AUTO_ORDER_READY}:
        reasons.append(f"trade intent is not auto-order ready: {intent.status}")
    if broker_review is None:
        reasons.append("broker order review missing")
    elif not broker_review.passed:
        reasons.extend(broker_review.warnings or ["broker order review did not pass"])

    account_value = account.account_value if account is not None else 0.0
    buying_power = account.buying_power if account is not None else 0.0
    deployed = account.deployed_dollars if account is not None else 0.0
    requested = guardrails.max_order_dollars
    if intent.confidence_score >= settings.intraday_large_size_score:
        requested = min(guardrails.max_order_dollars, guardrails.max_total_dollars)
    symbol_cap = max(0.0, account_value * settings.max_symbol_exposure_pct)
    if symbol_cap <= 0:
        reasons.append("symbol exposure cap is not configured")
    remaining_symbol_capacity = max(0.0, symbol_cap - max(0.0, existing_symbol_exposure))
    if remaining_symbol_capacity <= 0:
        reasons.append("symbol exposure cap reached")
    requested = min(requested, remaining_symbol_capacity)
    amount = guardrails.cap_order(
        requested_dollars=requested,
        buying_power=buying_power,
        account_value=account_value,
        deployed_dollars=deployed,
    )
    if amount <= 0:
        reasons.append("order amount blocked by guardrails")

    order_type = "market"
    limit_price = None
    quantity = None
    if broker_review and broker_review.ask and broker_review.ask > 0 and amount >= broker_review.ask:
        order_type = "limit"
        limit_price = round(broker_review.ask, 2)
        quantity = float(int(amount // broker_review.ask))
        amount = 0.0
    elif not settings.live_allow_market_notional_entries:
        reasons.append("market notional entries are disabled and limit quantity is not affordable")

    status = "READY_TO_PLACE" if ready and not reasons else "REJECTED"
    return OrderPlan(
        side="buy",
        symbol=intent.symbol,
        order_type=order_type,
        dollar_amount=amount,
        quantity=quantity,
        limit_price=limit_price,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status=status,
        broker_review=broker_review,
        rejection_reasons=reasons,
        ref_id=ref_id or str(uuid4()),
    )


def build_exit_order_plan(
    decision: IntradayExitDecision,
    *,
    account: BrokerAccountState | None,
    broker_review: BrokerReview | None,
    ref_id: str | None = None,
) -> OrderPlan:
    ready, reasons = account_state_ready_for_exit(account)
    if decision.action != INTRADAY_EXIT:
        reasons.append(f"exit decision is not actionable: {decision.action}")
    if broker_review is None:
        reasons.append("broker order review missing")
    elif not broker_review.passed and decision.reason not in {"stop loss hit", "end-of-day close rule"}:
        reasons.extend(broker_review.warnings or ["broker order review did not pass"])

    status = "READY_TO_PLACE" if ready and not reasons else "REJECTED"
    return OrderPlan(
        side="sell",
        symbol=decision.symbol,
        order_type="market",
        dollar_amount=0.0,
        quantity=round(decision.shares, 6),
        limit_price=None,
        stop_price=None,
        time_in_force="gfd",
        market_hours="regular_hours",
        status=status,
        broker_review=broker_review,
        rejection_reasons=reasons,
        ref_id=ref_id or str(uuid4()),
    )


def build_mission_lines(mission: BrokerMission, guardrails: BrokerGuardrails) -> list[str]:
    next_ticket = guardrails.cap_order(
        requested_dollars=guardrails.max_order_dollars,
        buying_power=mission.buying_power,
        account_value=mission.account_value,
        deployed_dollars=mission.deployed_dollars,
    )
    profit_reserve = guardrails.profit_reserve(account_value=mission.account_value)
    working_bankroll = guardrails.working_bankroll(account_value=mission.account_value)
    state = "ready" if next_ticket > 0 else "wait"
    return [
        f"Mission state: {state}",
        f"Account: {mission.account_label}",
        f"Account value: ${mission.account_value:,.2f}",
        f"Cash: ${mission.cash:,.2f}",
        f"Buying power: ${mission.buying_power:,.2f}",
        f"Currently deployed: ${mission.deployed_dollars:,.2f}",
        f"Working bankroll: ${working_bankroll:,.2f}",
        f"Locked profit reserve: ${profit_reserve:,.2f}",
        f"Positions: {mission.positions}",
        f"Open orders: {mission.open_orders}",
        f"Guardrails: {guardrails.summary()}",
        f"Next allowed ticket: ${next_ticket:,.2f}" if next_ticket > 0 else "Next allowed ticket: none under current guardrails",
    ]


def write_mission_report(
    mission: BrokerMission,
    guardrails: BrokerGuardrails,
    *,
    path: Path = MISSION_REPORT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Growth Mission",
        "",
        "This report is decision support. It does not place broker orders.",
        "",
    ]
    lines.extend(f"- {line}" for line in build_mission_lines(mission, guardrails))
    lines.extend(
        [
            "",
            "Execution rules:",
            "",
            "- Use the Agentic account only.",
            "- Long equities only.",
            "- Send Telegram before any Robinhood action.",
            "- Run an order review before any real order.",
            "- Place an order only after explicit user confirmation.",
            "",
        ]
    )
    path.write_text("\n".join(lines))
    return path
