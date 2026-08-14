from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Mapping

from .config import DATA_DIR


LIFECYCLE_STATE_PATH = DATA_DIR / "intraday_lifecycle_state.json"


@dataclass(frozen=True)
class TradeIntent:
    symbol: str
    side: str
    setup_type: str
    confidence_score: int
    entry_price: float
    entry_zone: str
    stop_price: float
    target_1: float
    target_2: float
    risk_reward_ratio: float
    risk_dollars: float
    status: str
    rejection_reasons: list[str] = field(default_factory=list)
    thesis: str = ""
    created_at: str = ""


@dataclass(frozen=True)
class BrokerReview:
    passed: bool
    quote_last: float | None = None
    bid: float | None = None
    ask: float | None = None
    warnings: list[str] = field(default_factory=list)
    raw: Mapping[str, object] | None = None


@dataclass(frozen=True)
class OrderPlan:
    side: str
    symbol: str
    order_type: str
    dollar_amount: float
    quantity: float | None
    limit_price: float | None
    stop_price: float | None
    time_in_force: str
    market_hours: str
    status: str
    broker_review: BrokerReview | None = None
    rejection_reasons: list[str] = field(default_factory=list)
    ref_id: str = ""
    placed_order_id: str = ""
    placed_at: str = ""
    placement_state: str = ""
    placement_raw: Mapping[str, object] | None = None


@dataclass(frozen=True)
class LivePositionPlan:
    symbol: str
    shares: float
    average_cost: float
    stop_price: float
    target_1: float
    target_2: float
    profit_lock_price: float
    thesis: str
    opened_at: str
    force_exit_after: str
    allow_overnight: bool = False


@dataclass(frozen=True)
class DailyRiskState:
    date: str
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    trades_today: int = 0
    consecutive_losses: int = 0
    lockout_reason: str = ""

    @property
    def locked(self) -> bool:
        return bool(self.lockout_reason)


@dataclass(frozen=True)
class IntradayLifecycleState:
    daily_risk: DailyRiskState
    intents: list[TradeIntent] = field(default_factory=list)
    order_plans: list[OrderPlan] = field(default_factory=list)
    positions: dict[str, LivePositionPlan] = field(default_factory=dict)
    updated_at: str = ""


def empty_lifecycle_state(now: datetime) -> IntradayLifecycleState:
    return IntradayLifecycleState(
        daily_risk=DailyRiskState(date=now.date().isoformat()),
        updated_at=now.isoformat(timespec="seconds"),
    )


def load_lifecycle_state(path: Path = LIFECYCLE_STATE_PATH, *, now: datetime | None = None) -> IntradayLifecycleState:
    current = now or datetime.now().astimezone()
    if not path.exists():
        return empty_lifecycle_state(current)
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return empty_lifecycle_state(current)
    if not isinstance(payload, dict):
        return empty_lifecycle_state(current)

    risk_payload = payload.get("daily_risk", {})
    risk = DailyRiskState(**risk_payload) if isinstance(risk_payload, dict) else DailyRiskState(date=current.date().isoformat())
    if risk.date != current.date().isoformat():
        risk = DailyRiskState(date=current.date().isoformat())

    positions_payload = payload.get("positions", {})
    positions = {
        symbol: LivePositionPlan(**values)
        for symbol, values in positions_payload.items()
        if isinstance(symbol, str) and isinstance(values, dict)
    } if isinstance(positions_payload, dict) else {}

    return IntradayLifecycleState(
        daily_risk=risk,
        intents=[TradeIntent(**item) for item in payload.get("intents", []) if isinstance(item, dict)],
        order_plans=[order_plan_from_dict(item) for item in payload.get("order_plans", []) if isinstance(item, dict)],
        positions=positions,
        updated_at=str(payload.get("updated_at", "")),
    )


def order_plan_from_dict(payload: dict[str, object]) -> OrderPlan:
    review_payload = payload.get("broker_review")
    review = BrokerReview(**review_payload) if isinstance(review_payload, dict) else None
    values = dict(payload)
    values["broker_review"] = review
    return OrderPlan(**values)


def save_lifecycle_state(state: IntradayLifecycleState, path: Path = LIFECYCLE_STATE_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2, sort_keys=True) + "\n")
    return path
