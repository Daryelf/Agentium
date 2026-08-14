from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Mapping, Protocol

from .broker import BrokerAccountState
from .evaluator import QuoteSnapshot
from .lifecycle import BrokerReview, OrderPlan


def normalized_order_state(state: str) -> str:
    return state.strip().lower().replace("-", "_").replace(" ", "_")


@dataclass(frozen=True)
class BrokerPosition:
    symbol: str
    shares: float
    average_cost: float

    @property
    def notional(self) -> float:
        return self.shares * self.average_cost


@dataclass(frozen=True)
class BrokerOrder:
    order_id: str
    symbol: str
    side: str
    state: str
    quantity: float | None = None
    dollar_amount: float | None = None
    average_price: float | None = None

    @property
    def is_open(self) -> bool:
        return normalized_order_state(self.state) in {"new", "queued", "confirmed", "unconfirmed", "partially_filled"}

    @property
    def is_filled(self) -> bool:
        return normalized_order_state(self.state) == "filled"


@dataclass(frozen=True)
class BrokerOrderResult:
    order_id: str
    state: str
    filled_quantity: float | None = None
    average_price: float | None = None
    raw: Mapping[str, object] | None = None


class BrokerClient(Protocol):
    def get_portfolio(self, account_number: str) -> BrokerAccountState:
        ...

    def get_positions(self, account_number: str) -> list[BrokerPosition]:
        ...

    def get_orders(self, account_number: str) -> list[BrokerOrder]:
        ...

    def get_quotes(self, symbols: list[str]) -> dict[str, QuoteSnapshot]:
        ...

    def get_tradability(self, account_number: str, symbols: list[str]) -> dict[str, bool]:
        ...

    def review_order(self, account_number: str, plan: OrderPlan) -> BrokerReview:
        ...

    def place_order(self, account_number: str, plan: OrderPlan) -> BrokerOrderResult:
        ...

    def cancel_order(self, account_number: str, order_id: str) -> BrokerOrderResult:
        ...


@dataclass
class DryRunBrokerClient:
    account: BrokerAccountState
    quotes: dict[str, QuoteSnapshot] = field(default_factory=dict)
    positions: list[BrokerPosition] = field(default_factory=list)
    orders: list[BrokerOrder] = field(default_factory=list)
    tradability: dict[str, bool] = field(default_factory=dict)
    review_warnings: list[str] = field(default_factory=list)
    placed_orders: list[OrderPlan] = field(default_factory=list)
    cancelled_orders: list[str] = field(default_factory=list)

    def get_portfolio(self, account_number: str) -> BrokerAccountState:
        return self.account

    def get_positions(self, account_number: str) -> list[BrokerPosition]:
        return list(self.positions)

    def get_orders(self, account_number: str) -> list[BrokerOrder]:
        return list(self.orders)

    def get_quotes(self, symbols: list[str]) -> dict[str, QuoteSnapshot]:
        return {symbol: self.quotes[symbol] for symbol in symbols if symbol in self.quotes}

    def get_tradability(self, account_number: str, symbols: list[str]) -> dict[str, bool]:
        return {symbol: self.tradability.get(symbol, True) for symbol in symbols}

    def review_order(self, account_number: str, plan: OrderPlan) -> BrokerReview:
        quote = self.quotes.get(plan.symbol)
        warnings = list(self.review_warnings)
        if quote is None or not quote.data_fresh:
            warnings.append("fresh broker quote missing")
        return BrokerReview(
            passed=not warnings,
            quote_last=quote.last if quote else None,
            bid=quote.bid if quote else None,
            ask=quote.ask if quote else None,
            warnings=warnings,
        )

    def place_order(self, account_number: str, plan: OrderPlan) -> BrokerOrderResult:
        self.placed_orders.append(plan)
        quote = self.quotes.get(plan.symbol)
        price = plan.limit_price or (quote.last if quote and quote.last else None)
        quantity = plan.quantity
        if quantity is None and price and plan.dollar_amount > 0:
            quantity = round(plan.dollar_amount / price, 6)
        order_id = f"dry-{plan.ref_id or len(self.placed_orders)}"
        order = BrokerOrder(
            order_id=order_id,
            symbol=plan.symbol,
            side=plan.side,
            state="filled",
            quantity=quantity,
            dollar_amount=plan.dollar_amount,
            average_price=price,
        )
        self.orders.append(order)
        return BrokerOrderResult(order_id=order_id, state="filled", filled_quantity=quantity, average_price=price)

    def cancel_order(self, account_number: str, order_id: str) -> BrokerOrderResult:
        self.cancelled_orders.append(order_id)
        self.orders = [
            replace(order, state="cancelled") if order.order_id == order_id else order
            for order in self.orders
        ]
        return BrokerOrderResult(order_id=order_id, state="cancelled")


def _number(value: object, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _text(value: object, default: str = "") -> str:
    if value is None or value == "":
        return default
    return str(value)


def _bool_or_none(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1", "pass", "passed", "approved", "accepted", "allowed"}:
            return True
        if normalized in {"false", "no", "n", "0", "fail", "failed", "rejected", "declined", "denied", "blocked"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return None


def _items(payload: object, *keys: str) -> list[object]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, Mapping):
        return []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    results = payload.get("results")
    return results if isinstance(results, list) else []


def _first_mapping(payload: object, *keys: str) -> Mapping[str, object]:
    if isinstance(payload, Mapping):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, Mapping):
                return value
        return payload
    return {}


def _symbol(payload: Mapping[str, object]) -> str:
    for key in ["symbol", "ticker"]:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().upper()
    instrument = payload.get("instrument")
    if isinstance(instrument, Mapping):
        return _symbol(instrument)
    return ""


def _account_number(payload: Mapping[str, object]) -> str:
    for key in ["account_number", "account_no", "account_id"]:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    account = payload.get("account")
    if isinstance(account, Mapping):
        return _account_number(account)
    return ""


def _alerts(payload: object) -> list[str]:
    alerts: list[str] = []
    if not isinstance(payload, Mapping):
        return alerts
    for key in ["alerts", "warnings", "errors", "restrictions"]:
        value = payload.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    alerts.append(item)
                elif isinstance(item, Mapping):
                    text = item.get("message") or item.get("detail") or item.get("reason") or item.get("code")
                    if text:
                        alerts.append(str(text))
        elif isinstance(value, str):
            alerts.append(value)
    return alerts


def _review_block_reasons(payload: object) -> list[str]:
    if not isinstance(payload, Mapping):
        return ["broker review response is not structured"]
    reasons: list[str] = []
    for key in ["passed", "pass", "approved", "approval", "accepted", "allowed", "can_place", "placeable"]:
        value = _bool_or_none(payload.get(key))
        if value is False:
            reasons.append(f"broker review returned {key}=false")
    for container_key in ["review", "result", "order_review"]:
        nested = payload.get(container_key)
        if isinstance(nested, Mapping):
            for key in ["passed", "approved", "accepted", "allowed", "can_place", "placeable"]:
                value = _bool_or_none(nested.get(key))
                if value is False:
                    reasons.append(f"broker review returned {container_key}.{key}=false")
    state = normalized_order_state(_text(payload.get("status") or payload.get("state")))
    if state in {"rejected", "failed", "declined", "denied", "blocked", "not_approved", "not_allowed"}:
        reasons.append(f"broker review status is {state}")
    return reasons


REQUIRED_MCP_TOOL_NAMES = (
    "get_portfolio",
    "get_equity_positions",
    "get_equity_orders",
    "get_equity_quotes",
    "get_equity_tradability",
    "review_equity_order",
    "place_equity_order",
)


@dataclass(frozen=True)
class BrokerToolStatus:
    configured: bool
    missing_tools: list[str]
    placement_enabled: bool
    cancel_enabled: bool


@dataclass(frozen=True)
class CodexMcpToolset:
    get_portfolio: Any | None = None
    get_equity_positions: Any | None = None
    get_equity_orders: Any | None = None
    get_equity_quotes: Any | None = None
    get_equity_tradability: Any | None = None
    review_equity_order: Any | None = None
    place_equity_order: Any | None = None
    cancel_equity_order: Any | None = None

    def status(self, *, require_placement: bool = True) -> BrokerToolStatus:
        required = list(REQUIRED_MCP_TOOL_NAMES if require_placement else REQUIRED_MCP_TOOL_NAMES[:-1])
        missing = [name for name in required if not callable(getattr(self, name))]
        return BrokerToolStatus(
            configured=not missing,
            missing_tools=missing,
            placement_enabled=callable(self.place_equity_order),
            cancel_enabled=callable(self.cancel_equity_order),
        )


def build_codex_mcp_broker_client(
    toolset: CodexMcpToolset,
    *,
    require_placement: bool = True,
) -> "CodexMcpBrokerClient":
    status = toolset.status(require_placement=require_placement)
    if not status.configured:
        raise RuntimeError("missing Codex MCP broker tools: " + ", ".join(status.missing_tools))
    if require_placement:
        place_fn = toolset.place_equity_order
    else:
        place_fn = _placement_disabled
    return CodexMcpBrokerClient(
        get_portfolio_fn=toolset.get_portfolio,
        get_equity_positions_fn=toolset.get_equity_positions,
        get_equity_orders_fn=toolset.get_equity_orders,
        get_equity_quotes_fn=toolset.get_equity_quotes,
        get_equity_tradability_fn=toolset.get_equity_tradability,
        review_equity_order_fn=toolset.review_equity_order,
        place_equity_order_fn=place_fn,
        cancel_equity_order_fn=toolset.cancel_equity_order,
    )


def _placement_disabled(**kwargs):
    raise RuntimeError("Codex MCP placement function is not configured")


def _require_account_number(account_number: str) -> None:
    if not account_number.strip():
        raise RuntimeError("explicit Agentic account number is required")


def validate_broker_order_plan(plan: OrderPlan) -> None:
    if plan.side not in {"buy", "sell"}:
        raise RuntimeError(f"unsupported broker order side: {plan.side}")
    if plan.order_type not in {"market", "limit"}:
        raise RuntimeError(f"unsupported broker order type: {plan.order_type}")
    if plan.time_in_force != "gfd":
        raise RuntimeError(f"unsupported broker time in force: {plan.time_in_force}")
    if plan.market_hours != "regular_hours":
        raise RuntimeError(f"unsupported broker market hours: {plan.market_hours}")
    if plan.quantity is None and plan.dollar_amount <= 0:
        raise RuntimeError("broker order plan missing quantity or dollar amount")
    if plan.order_type == "limit" and (plan.limit_price is None or plan.limit_price <= 0):
        raise RuntimeError("limit order plan missing valid limit price")


def broker_order_args(plan: OrderPlan, *, include_ref_id: bool = True) -> dict[str, str]:
    validate_broker_order_plan(plan)
    args: dict[str, str] = {
        "symbol": plan.symbol,
        "side": plan.side,
        "type": plan.order_type,
        "time_in_force": plan.time_in_force,
        "market_hours": plan.market_hours,
    }
    if include_ref_id and plan.ref_id:
        args["ref_id"] = plan.ref_id
    if plan.quantity is not None:
        args["quantity"] = f"{plan.quantity:.6f}".rstrip("0").rstrip(".")
    elif plan.dollar_amount > 0:
        args["dollar_amount"] = f"{plan.dollar_amount:.2f}"
    if plan.limit_price is not None:
        args["limit_price"] = f"{plan.limit_price:.2f}"
    if plan.stop_price is not None:
        args["stop_price"] = f"{plan.stop_price:.2f}"
    return args


@dataclass
class CodexMcpBrokerClient:
    """BrokerClient backed by injected Codex Robintrade MCP callables.

    The local Python app cannot import Codex MCP tools directly. Production wiring should
    pass approved tool-call functions for each broker operation at process setup time.
    """

    get_portfolio_fn: Any
    get_equity_positions_fn: Any
    get_equity_orders_fn: Any
    get_equity_quotes_fn: Any
    get_equity_tradability_fn: Any
    review_equity_order_fn: Any
    place_equity_order_fn: Any
    cancel_equity_order_fn: Any | None = None

    def __post_init__(self) -> None:
        required = {
            "get_portfolio_fn": self.get_portfolio_fn,
            "get_equity_positions_fn": self.get_equity_positions_fn,
            "get_equity_orders_fn": self.get_equity_orders_fn,
            "get_equity_quotes_fn": self.get_equity_quotes_fn,
            "get_equity_tradability_fn": self.get_equity_tradability_fn,
            "review_equity_order_fn": self.review_equity_order_fn,
            "place_equity_order_fn": self.place_equity_order_fn,
        }
        missing = [name for name, fn in required.items() if not callable(fn)]
        if missing:
            raise RuntimeError("missing Codex MCP broker callables: " + ", ".join(missing))

    def get_portfolio(self, account_number: str) -> BrokerAccountState:
        _require_account_number(account_number)
        payload = self.get_portfolio_fn(account_number=account_number)
        data = _first_mapping(payload, "portfolio", "account", "result")
        returned_account = _account_number(data) or (_account_number(payload) if isinstance(payload, Mapping) else "")
        if returned_account and returned_account != account_number.strip():
            raise RuntimeError("broker portfolio account number does not match requested Agentic account")
        warnings = _alerts(payload)
        return BrokerAccountState(
            account_number=account_number,
            account_value=_number(data.get("account_value") or data.get("market_value") or data.get("total_equity")),
            cash=_number(data.get("cash") or data.get("cash_available") or data.get("withdrawable_cash")),
            buying_power=_number(data.get("buying_power") or data.get("equity_buying_power") or data.get("stock_buying_power")),
            deployed_dollars=_number(data.get("equity_market_value") or data.get("stock_market_value")),
            warnings=warnings,
            restrictions=[item for item in _alerts(data) if "restrict" in item.lower()],
            margin_state=_text(data.get("margin_state")),
            unsettled_funds=_number(data.get("unsettled_funds")),
        )

    def get_positions(self, account_number: str) -> list[BrokerPosition]:
        _require_account_number(account_number)
        payload = self.get_equity_positions_fn(account_number=account_number)
        positions: list[BrokerPosition] = []
        for item in _items(payload, "positions", "equity_positions"):
            if not isinstance(item, Mapping):
                continue
            symbol = _symbol(item)
            shares = _number(item.get("shares") or item.get("quantity") or item.get("qty"))
            average = _number(item.get("average_cost") or item.get("average_price") or item.get("average_buy_price"))
            if shares <= 0:
                continue
            if not symbol:
                raise RuntimeError("broker position response missing symbol")
            if average <= 0:
                raise RuntimeError(f"{symbol}: broker position response missing average cost")
            positions.append(BrokerPosition(symbol=symbol, shares=shares, average_cost=average))
        return positions

    def get_orders(self, account_number: str) -> list[BrokerOrder]:
        _require_account_number(account_number)
        payload = self.get_equity_orders_fn(account_number=account_number)
        orders: list[BrokerOrder] = []
        for item in _items(payload, "orders", "equity_orders"):
            if not isinstance(item, Mapping):
                continue
            symbol = _symbol(item)
            order_id = _text(item.get("id") or item.get("order_id"))
            side = _text(item.get("side")).lower()
            state = _text(item.get("state") or item.get("status")).lower()
            if not symbol:
                raise RuntimeError("broker order response missing symbol")
            if not order_id:
                raise RuntimeError(f"{symbol}: broker order response missing order id")
            if not side:
                raise RuntimeError(f"{symbol}: broker order response missing side")
            if not state:
                raise RuntimeError(f"{symbol}: broker order response missing state")
            orders.append(
                BrokerOrder(
                    order_id=order_id,
                    symbol=symbol,
                    side=side,
                    state=state,
                    quantity=_number(item.get("quantity") or item.get("cumulative_quantity") or item.get("filled_quantity"), None),
                    dollar_amount=_number(item.get("dollar_amount") or item.get("notional"), None),
                    average_price=_number(item.get("average_price") or item.get("price"), None),
                )
            )
        return orders

    def get_quotes(self, symbols: list[str]) -> dict[str, QuoteSnapshot]:
        payload = self.get_equity_quotes_fn(symbols=symbols)
        quote_items = _items(payload, "quotes", "results")
        if not quote_items and isinstance(payload, Mapping):
            quote_items = list(payload.values()) if all(isinstance(value, Mapping) for value in payload.values()) else [payload]
        quotes: dict[str, QuoteSnapshot] = {}
        for item in quote_items:
            if not isinstance(item, Mapping):
                continue
            symbol = _symbol(item)
            if not symbol:
                raise RuntimeError("broker quote response missing symbol")
            bid = _number(item.get("bid") or item.get("bid_price"), None)
            ask = _number(item.get("ask") or item.get("ask_price"), None)
            last = _number(item.get("last") or item.get("last_trade_price") or item.get("mark_price"), None)
            if last is None or last <= 0:
                raise RuntimeError(f"{symbol}: broker quote response missing valid last price")
            if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
                raise RuntimeError(f"{symbol}: broker quote response missing valid bid/ask")
            quotes[symbol] = QuoteSnapshot(
                ticker=symbol,
                bid=bid,
                ask=ask,
                last=last,
                data_fresh=not bool(item.get("stale") or item.get("halted")),
            )
        return quotes

    def get_tradability(self, account_number: str, symbols: list[str]) -> dict[str, bool]:
        _require_account_number(account_number)
        payload = self.get_equity_tradability_fn(account_number=account_number, symbols=symbols)
        items = _items(payload, "tradability", "results", "instruments")
        states: dict[str, bool] = {}
        for item in items:
            if not isinstance(item, Mapping):
                continue
            symbol = _symbol(item)
            if not symbol:
                raise RuntimeError("broker tradability response missing symbol")
            value = item.get("tradable")
            if value is None:
                value = item.get("tradeable")
            if value is None:
                value = item.get("is_tradable")
            if value is None:
                raise RuntimeError(f"{symbol}: broker tradability response missing tradable flag")
            states[symbol] = bool(value)
        return {symbol: states.get(symbol, False) for symbol in symbols}

    def review_order(self, account_number: str, plan: OrderPlan) -> BrokerReview:
        _require_account_number(account_number)
        payload = self.review_equity_order_fn(account_number=account_number, **broker_order_args(plan, include_ref_id=False))
        quote = _first_mapping(payload, "quote", "estimated_quote")
        warnings = [*_alerts(payload), *_review_block_reasons(payload)]
        if not quote and isinstance(payload, Mapping):
            quote = payload
        quote_last = _number(quote.get("last") or quote.get("last_trade_price") or quote.get("estimated_price"), None)
        bid = _number(quote.get("bid") or quote.get("bid_price"), None)
        ask = _number(quote.get("ask") or quote.get("ask_price"), None)
        if quote_last is None or quote_last <= 0:
            warnings.append("broker review quote missing valid last price")
        if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
            warnings.append("broker review quote missing valid bid/ask")
        return BrokerReview(
            passed=not warnings,
            quote_last=quote_last,
            bid=bid,
            ask=ask,
            warnings=warnings,
            raw=payload if isinstance(payload, Mapping) else {"payload": payload},
        )

    def place_order(self, account_number: str, plan: OrderPlan) -> BrokerOrderResult:
        _require_account_number(account_number)
        if not plan.ref_id:
            raise RuntimeError("live order placement requires a client ref_id")
        payload = self.place_equity_order_fn(account_number=account_number, **broker_order_args(plan))
        data = _first_mapping(payload, "order", "result")
        state = _text(data.get("state") or data.get("status"))
        if not state:
            raise RuntimeError("broker placement response missing state")
        return BrokerOrderResult(
            order_id=_text(data.get("id") or data.get("order_id")),
            state=state,
            filled_quantity=_number(data.get("filled_quantity") or data.get("cumulative_quantity"), None),
            average_price=_number(data.get("average_price") or data.get("price"), None),
            raw=payload if isinstance(payload, Mapping) else {"payload": payload},
        )

    def cancel_order(self, account_number: str, order_id: str) -> BrokerOrderResult:
        _require_account_number(account_number)
        if self.cancel_equity_order_fn is None:
            raise RuntimeError("Robintrade cancel function not configured")
        payload = self.cancel_equity_order_fn(account_number=account_number, order_id=order_id)
        data = _first_mapping(payload, "order", "result")
        return BrokerOrderResult(
            order_id=order_id,
            state=_text(data.get("state") or data.get("status"), "cancelled"),
            raw=payload if isinstance(payload, Mapping) else {"payload": payload},
        )


RobintradeBrokerClient = CodexMcpBrokerClient
