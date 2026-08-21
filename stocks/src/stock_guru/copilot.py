from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .bot import BotSnapshot
from .config import REPORT_DIR


LATEST_TICKET_PATH = REPORT_DIR / "latest_ticket.md"


@dataclass(frozen=True)
class TradeTicket:
    action: str
    ticker: str | None
    reason: str
    shares: float = 0.0
    estimated_price: float = 0.0
    notional: float = 0.0
    cash_now: float = 0.0
    cash_after_signal: float = 0.0
    stop_price: float | None = None
    take_profit_price: float | None = None
    generated_at: datetime | None = None
    expires_at: datetime | None = None
    manual_broker_action_required: bool = True

    @property
    def summary(self) -> str:
        if not self.ticker:
            return f"{self.action}: {self.reason}"
        return f"{self.action} {self.ticker}: {self.reason}"


def build_trade_ticket(
    snapshot: BotSnapshot,
    *,
    stop_loss_pct: float,
    take_profit_pct: float,
    stale_minutes: int = 5,
    tz_name: str = "America/New_York",
) -> TradeTicket:
    decision = snapshot.decision
    generated_at = datetime.now(ZoneInfo(tz_name))
    expires_at = generated_at + timedelta(minutes=stale_minutes)
    if decision.action == "BUY" and decision.ticker:
        stop_price = decision.stop_price if decision.stop_price is not None else decision.price * (1 - stop_loss_pct)
        take_profit_price = (
            decision.take_profit_price if decision.take_profit_price is not None else decision.price * (1 + take_profit_pct)
        )
        return TradeTicket(
            action="BUY",
            ticker=decision.ticker,
            reason=decision.reason,
            shares=decision.shares,
            estimated_price=decision.price,
            notional=decision.notional,
            cash_now=snapshot.state.cash,
            cash_after_signal=max(0.0, snapshot.state.cash - decision.notional),
            stop_price=stop_price,
            take_profit_price=take_profit_price,
            generated_at=generated_at,
            expires_at=expires_at,
        )

    if decision.action == "SELL" and decision.ticker:
        return TradeTicket(
            action="SELL",
            ticker=decision.ticker,
            reason=decision.reason,
            shares=decision.shares,
            estimated_price=decision.price,
            notional=decision.notional,
            cash_now=snapshot.state.cash,
            cash_after_signal=snapshot.state.cash + decision.notional,
            generated_at=generated_at,
            expires_at=expires_at,
        )

    if snapshot.state.positions:
        position = next(iter(snapshot.state.positions.values()))
        stop_price = position.stop_price if position.stop_price is not None else position.avg_cost * (1 - stop_loss_pct)
        take_profit_price = (
            position.take_profit_price if position.take_profit_price is not None else position.avg_cost * (1 + take_profit_pct)
        )
        return TradeTicket(
            action="HOLD",
            ticker=position.ticker,
            reason=decision.reason,
            shares=position.shares,
            estimated_price=position.avg_cost,
            notional=position.cost_basis,
            cash_now=snapshot.state.cash,
            cash_after_signal=snapshot.state.cash,
            stop_price=stop_price,
            take_profit_price=take_profit_price,
            generated_at=generated_at,
            expires_at=expires_at,
        )

    top = snapshot.candidates[0] if snapshot.candidates else None
    return TradeTicket(
        action="WAIT",
        ticker=top.ticker if top else None,
        reason=decision.reason,
        estimated_price=top.price if top else 0.0,
        cash_now=snapshot.state.cash,
        cash_after_signal=snapshot.state.cash,
        generated_at=generated_at,
        expires_at=expires_at,
    )


def write_ticket_markdown(ticket: TradeTicket, path: Path = LATEST_TICKET_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Latest Trade Copilot Ticket",
        "",
        "This is a paper-trading signal. It does not place a broker order.",
        "",
        f"- Action: {ticket.action}",
        f"- Ticker: {ticket.ticker or 'N/A'}",
        f"- Reason: {ticket.reason}",
        f"- Shares: {ticket.shares:.6f}",
        f"- Estimated price: ${ticket.estimated_price:.2f}",
        f"- Notional: ${ticket.notional:.2f}",
        f"- Cash now: ${ticket.cash_now:.2f}",
        f"- Cash after signal: ${ticket.cash_after_signal:.2f}",
    ]
    if ticket.stop_price is not None:
        lines.append(f"- Stop: ${ticket.stop_price:.2f}")
    if ticket.take_profit_price is not None:
        lines.append(f"- Take profit: ${ticket.take_profit_price:.2f}")
    if ticket.generated_at is not None:
        lines.append(f"- Generated: {ticket.generated_at.isoformat(timespec='seconds')}")
    if ticket.expires_at is not None:
        lines.append(f"- Refresh after: {ticket.expires_at.isoformat(timespec='seconds')}")
    lines.extend(
        [
            f"- Manual broker action required: {'yes' if ticket.manual_broker_action_required else 'no'}",
            "",
        ]
    )
    path.write_text("\n".join(lines))
    return path
