from __future__ import annotations

from stock_guru.broker import BrokerAccountState
import pytest

from stock_guru.broker_client import (
    CodexMcpBrokerClient,
    CodexMcpToolset,
    BrokerOrder,
    DryRunBrokerClient,
    build_codex_mcp_broker_client,
    broker_order_args,
)
from stock_guru.evaluator import QuoteSnapshot
from stock_guru.lifecycle import OrderPlan


def plan(ref_id: str = "same-ref", **overrides) -> OrderPlan:
    values = {
        "side": "buy",
        "symbol": "TEST",
        "order_type": "limit",
        "dollar_amount": 25,
        "quantity": None,
        "limit_price": 100.01,
        "stop_price": None,
        "time_in_force": "gfd",
        "market_hours": "regular_hours",
        "status": "READY_TO_PLACE",
        "ref_id": ref_id,
    }
    values.update(overrides)
    return OrderPlan(**values)


def test_dry_run_review_rejects_missing_quote() -> None:
    broker = DryRunBrokerClient(account=BrokerAccountState("A123", 25, 25, 25))

    review = broker.review_order("A123", plan())

    assert not review.passed
    assert "fresh broker quote missing" in review.warnings


def test_dry_run_review_rejects_broker_warning() -> None:
    broker = DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)},
        review_warnings=["broker says no"],
    )

    review = broker.review_order("A123", plan())

    assert not review.passed
    assert "broker says no" in review.warnings


def test_dry_run_place_reuses_ref_id_for_idempotency() -> None:
    broker = DryRunBrokerClient(
        account=BrokerAccountState("A123", 25, 25, 25),
        quotes={"TEST": QuoteSnapshot("TEST", bid=99.99, ask=100.01, last=100, data_fresh=True)},
    )

    first = broker.place_order("A123", plan(ref_id="fixed-ref"))
    second = broker.place_order("A123", plan(ref_id="fixed-ref"))

    assert first.order_id == "dry-fixed-ref"
    assert second.order_id == "dry-fixed-ref"


def test_broker_order_state_helpers_normalize_state_names() -> None:
    assert BrokerOrder("o1", "TEST", "buy", "Partially Filled").is_open
    assert BrokerOrder("o2", "TEST", "buy", "CONFIRMED").is_open
    assert BrokerOrder("o3", "TEST", "buy", "FILLED").is_filled


def test_broker_order_args_rejects_unsupported_side() -> None:
    with pytest.raises(RuntimeError, match="unsupported broker order side"):
        broker_order_args(plan(side="short"))


def test_broker_order_args_rejects_unsupported_order_type() -> None:
    with pytest.raises(RuntimeError, match="unsupported broker order type"):
        broker_order_args(plan(order_type="stop_limit"))


def test_broker_order_args_rejects_extended_hours() -> None:
    with pytest.raises(RuntimeError, match="unsupported broker market hours"):
        broker_order_args(plan(market_hours="extended_hours"))


def test_broker_order_args_rejects_empty_order_size() -> None:
    with pytest.raises(RuntimeError, match="missing quantity or dollar amount"):
        broker_order_args(plan(order_type="market", dollar_amount=0, quantity=None, limit_price=None))


def test_broker_order_args_rejects_limit_without_limit_price() -> None:
    with pytest.raises(RuntimeError, match="limit order plan missing valid limit price"):
        broker_order_args(plan(limit_price=None))


def mcp_toolset(review_alerts=None, seen=None, review_payload=None) -> CodexMcpToolset:
    seen = seen if seen is not None else {}
    def review_equity_order(**kwargs):
        seen["review"] = kwargs
        return review_payload or {
            "quote": {"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"},
            "alerts": review_alerts or [],
        }

    def place_equity_order(**kwargs):
        seen["place"] = kwargs
        return {"order": {"id": kwargs["ref_id"], "state": "queued"}}

    return CodexMcpToolset(
        get_portfolio=lambda **kwargs: {
            "portfolio": {
                "account_value": "25.50",
                "cash": "20.00",
                "buying_power": "20.00",
                "equity_market_value": "5.50",
            }
        },
        get_equity_positions=lambda **kwargs: {
            "positions": [{"symbol": "TEST", "quantity": "0.25", "average_cost": "100.00"}]
        },
        get_equity_orders=lambda **kwargs: {
            "orders": [{"id": "order-1", "symbol": "TEST", "side": "buy", "state": "confirmed", "quantity": "0.25"}]
        },
        get_equity_quotes=lambda **kwargs: {
            "quotes": [{"symbol": "TEST", "bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"}]
        },
        get_equity_tradability=lambda **kwargs: {
            "results": [{"symbol": "TEST", "tradable": True}]
        },
        review_equity_order=review_equity_order,
        place_equity_order=place_equity_order,
    )


def mcp_client(review_alerts=None, seen=None, review_payload=None) -> CodexMcpBrokerClient:
    return build_codex_mcp_broker_client(mcp_toolset(review_alerts=review_alerts, seen=seen, review_payload=review_payload))


def old_mcp_client(review_alerts=None) -> CodexMcpBrokerClient:
    return CodexMcpBrokerClient(
        get_portfolio_fn=lambda **kwargs: {
            "portfolio": {
                "account_value": "25.50",
                "cash": "20.00",
                "buying_power": "20.00",
                "equity_market_value": "5.50",
            }
        },
        get_equity_positions_fn=lambda **kwargs: {
            "positions": [{"symbol": "TEST", "quantity": "0.25", "average_cost": "100.00"}]
        },
        get_equity_orders_fn=lambda **kwargs: {
            "orders": [{"id": "order-1", "symbol": "TEST", "side": "buy", "state": "confirmed", "quantity": "0.25"}]
        },
        get_equity_quotes_fn=lambda **kwargs: {
            "quotes": [{"symbol": "TEST", "bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"}]
        },
        get_equity_tradability_fn=lambda **kwargs: {
            "results": [{"symbol": "TEST", "tradable": True}]
        },
        review_equity_order_fn=lambda **kwargs: {
            "quote": {"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"},
            "alerts": review_alerts or [],
        },
        place_equity_order_fn=lambda **kwargs: {"order": {"id": kwargs["ref_id"], "state": "queued"}},
    )


def test_codex_mcp_adapter_maps_broker_state() -> None:
    client = mcp_client()

    account = client.get_portfolio("A123")
    positions = client.get_positions("A123")
    orders = client.get_orders("A123")
    quotes = client.get_quotes(["TEST"])
    tradability = client.get_tradability("A123", ["TEST"])

    assert account.account_value == 25.5
    assert account.buying_power == 20
    assert positions[0].shares == 0.25
    assert orders[0].is_open
    assert quotes["TEST"].ask == 100.01
    assert tradability == {"TEST": True}


def test_codex_mcp_portfolio_account_mismatch_rejects() -> None:
    toolset = mcp_toolset()
    mismatched = CodexMcpToolset(
        get_portfolio=lambda **kwargs: {
            "portfolio": {
                "account_number": "OTHER",
                "account_value": "25.50",
                "cash": "20.00",
                "buying_power": "20.00",
            }
        },
        get_equity_positions=toolset.get_equity_positions,
        get_equity_orders=toolset.get_equity_orders,
        get_equity_quotes=toolset.get_equity_quotes,
        get_equity_tradability=toolset.get_equity_tradability,
        review_equity_order=toolset.review_equity_order,
        place_equity_order=toolset.place_equity_order,
    )
    client = build_codex_mcp_broker_client(mismatched)

    with pytest.raises(RuntimeError, match="account number does not match"):
        client.get_portfolio("A123")


def test_codex_mcp_position_missing_symbol_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=lambda **kwargs: {"positions": [{"quantity": "0.25", "average_cost": "100.00"}]},
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=toolset.get_equity_quotes,
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="position response missing symbol"):
        client.get_positions("A123")


def test_codex_mcp_position_missing_average_cost_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=lambda **kwargs: {"positions": [{"symbol": "TEST", "quantity": "0.25"}]},
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=toolset.get_equity_quotes,
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="TEST: broker position response missing average cost"):
        client.get_positions("A123")


def test_codex_mcp_order_missing_id_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=toolset.get_equity_positions,
            get_equity_orders=lambda **kwargs: {"orders": [{"symbol": "TEST", "side": "buy", "state": "confirmed"}]},
            get_equity_quotes=toolset.get_equity_quotes,
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="TEST: broker order response missing order id"):
        client.get_orders("A123")


def test_codex_mcp_quote_missing_symbol_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=toolset.get_equity_positions,
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=lambda **kwargs: {"quotes": [{"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"}]},
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="broker quote response missing symbol"):
        client.get_quotes(["TEST"])


def test_codex_mcp_quote_invalid_bid_ask_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=toolset.get_equity_positions,
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=lambda **kwargs: {"quotes": [{"symbol": "TEST", "bid_price": "101.00", "ask_price": "100.00", "last_trade_price": "100.00"}]},
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="TEST: broker quote response missing valid bid/ask"):
        client.get_quotes(["TEST"])


def test_codex_mcp_tradability_missing_flag_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=toolset.get_equity_positions,
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=toolset.get_equity_quotes,
            get_equity_tradability=lambda **kwargs: {"results": [{"symbol": "TEST"}]},
            review_equity_order=toolset.review_equity_order,
            place_equity_order=toolset.place_equity_order,
        )
    )

    with pytest.raises(RuntimeError, match="TEST: broker tradability response missing tradable flag"):
        client.get_tradability("A123", ["TEST"])


def test_codex_mcp_review_alert_rejects() -> None:
    client = mcp_client(review_alerts=[{"message": "PDT warning"}])

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "PDT warning" in review.warnings


def test_codex_mcp_review_explicit_passed_false_rejects() -> None:
    client = mcp_client(
        review_payload={
            "passed": False,
            "quote": {"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"},
        }
    )

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "broker review returned passed=false" in review.warnings


def test_codex_mcp_review_nested_approval_false_rejects() -> None:
    client = mcp_client(
        review_payload={
            "review": {"approved": False},
            "quote": {"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"},
        }
    )

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "broker review returned review.approved=false" in review.warnings


def test_codex_mcp_review_rejected_status_rejects() -> None:
    client = mcp_client(
        review_payload={
            "status": "rejected",
            "quote": {"bid_price": "99.99", "ask_price": "100.01", "last_trade_price": "100.00"},
        }
    )

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "broker review status is rejected" in review.warnings


def test_codex_mcp_review_missing_quote_rejects() -> None:
    client = mcp_client(review_payload={"passed": True})

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "broker review quote missing valid last price" in review.warnings
    assert "broker review quote missing valid bid/ask" in review.warnings


def test_codex_mcp_review_invalid_bid_ask_rejects() -> None:
    client = mcp_client(
        review_payload={
            "quote": {"bid_price": "101.00", "ask_price": "100.00", "last_trade_price": "100.00"},
        }
    )

    review = client.review_order("A123", plan())

    assert not review.passed
    assert "broker review quote missing valid bid/ask" in review.warnings


def test_codex_mcp_place_passes_ref_id() -> None:
    client = mcp_client()

    result = client.place_order("A123", plan(ref_id="fixed-ref"))

    assert result.order_id == "fixed-ref"
    assert broker_order_args(plan(ref_id="fixed-ref"))["ref_id"] == "fixed-ref"


def test_codex_mcp_place_missing_state_rejects() -> None:
    toolset = mcp_toolset()
    client = build_codex_mcp_broker_client(
        CodexMcpToolset(
            get_portfolio=toolset.get_portfolio,
            get_equity_positions=toolset.get_equity_positions,
            get_equity_orders=toolset.get_equity_orders,
            get_equity_quotes=toolset.get_equity_quotes,
            get_equity_tradability=toolset.get_equity_tradability,
            review_equity_order=toolset.review_equity_order,
            place_equity_order=lambda **kwargs: {"order": {"id": kwargs["ref_id"]}},
        )
    )

    with pytest.raises(RuntimeError, match="broker placement response missing state"):
        client.place_order("A123", plan(ref_id="fixed-ref"))


def test_codex_mcp_toolset_reports_missing_tools() -> None:
    status = CodexMcpToolset(get_portfolio=lambda **kwargs: {}).status()

    assert not status.configured
    assert "get_equity_positions" in status.missing_tools
    assert "place_equity_order" in status.missing_tools


def test_build_codex_mcp_broker_client_rejects_missing_live_tools() -> None:
    with pytest.raises(RuntimeError, match="missing Codex MCP broker tools"):
        build_codex_mcp_broker_client(CodexMcpToolset(get_portfolio=lambda **kwargs: {}))


def test_build_codex_mcp_broker_client_allows_review_only_without_place() -> None:
    toolset = mcp_toolset()
    review_only = CodexMcpToolset(
        get_portfolio=toolset.get_portfolio,
        get_equity_positions=toolset.get_equity_positions,
        get_equity_orders=toolset.get_equity_orders,
        get_equity_quotes=toolset.get_equity_quotes,
        get_equity_tradability=toolset.get_equity_tradability,
        review_equity_order=toolset.review_equity_order,
    )

    client = build_codex_mcp_broker_client(review_only, require_placement=False)

    review = client.review_order("A123", plan())
    assert review.passed
    with pytest.raises(RuntimeError, match="placement function is not configured"):
        client.place_order("A123", plan(ref_id="fixed-ref"))


def test_codex_mcp_review_does_not_send_ref_id_but_place_does() -> None:
    seen = {}
    client = mcp_client(seen=seen)

    client.review_order("A123", plan(ref_id="fixed-ref"))
    client.place_order("A123", plan(ref_id="fixed-ref"))

    assert "ref_id" not in seen["review"]
    assert seen["place"]["ref_id"] == "fixed-ref"


def test_codex_mcp_rejects_empty_account_number() -> None:
    client = mcp_client()

    with pytest.raises(RuntimeError, match="explicit Agentic account number"):
        client.get_portfolio("")


def test_codex_mcp_place_requires_client_ref_id() -> None:
    client = mcp_client()

    with pytest.raises(RuntimeError, match="requires a client ref_id"):
        client.place_order("A123", plan(ref_id=""))
