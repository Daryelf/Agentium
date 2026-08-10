from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from stock_guru.copy_trader import (
    SAFE_EXECUTION_MODE,
    apply_paper_candidates,
    build_mirror_plan,
    load_copy_policy,
    load_public_signals,
    write_mirror_plan,
)
from stock_guru.paper import read_ledger


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def policy_path(tmp_path: Path) -> Path:
    return write_json(
        tmp_path / "copy_trader.json",
        {
            "version": 1,
            "execution_mode": SAFE_EXECUTION_MODE,
            "total_budget_dollars": 25,
            "max_trade_dollars": 5,
            "max_daily_notional_dollars": 10,
            "max_source_allocation_pct": 0.4,
            "min_trade_dollars": 1,
            "minimum_confidence": 0.7,
            "max_price_drift_pct": 0.03,
            "max_signal_age_hours": 96,
            "allowed_asset_types": ["equity"],
            "research_only_asset_types": ["event_contract"],
            "sources": [
                {
                    "id": "sec_form4",
                    "name": "SEC Form 4",
                    "source_type": "official_disclosure",
                    "enabled": True,
                    "mirror_eligible": True,
                    "max_disclosure_lag_hours": 96,
                },
                {
                    "id": "sec_13f",
                    "name": "SEC Form 13F",
                    "source_type": "delayed_holdings",
                    "enabled": True,
                    "mirror_eligible": False,
                    "max_disclosure_lag_hours": 1080,
                },
                {
                    "id": "public_event",
                    "name": "Public event-contract signal",
                    "source_type": "public_signal",
                    "enabled": True,
                    "mirror_eligible": True,
                    "max_disclosure_lag_hours": 24,
                },
            ],
        },
    )


def signal(
    *,
    signal_id: str = "sig-1",
    source_id: str = "sec_form4",
    asset_type: str = "equity",
    symbol: str = "AAPL",
    side: str = "BUY",
    transaction_code: str = "P",
    transaction_at: str = "2026-08-08T14:00:00Z",
    disclosed_at: str = "2026-08-09T14:00:00Z",
    signal_price: float = 100,
    current_price: float = 102,
    current_position_shares: float = 0,
    trader_name: str = "Public reporting person",
) -> dict[str, object]:
    return {
        "id": signal_id,
        "source_id": source_id,
        "trader_name": trader_name,
        "asset_type": asset_type,
        "symbol": symbol,
        "side": side,
        "transaction_code": transaction_code,
        "transaction_at": transaction_at,
        "disclosed_at": disclosed_at,
        "observed_at": disclosed_at,
        "source_url": "https://www.sec.gov/Archives/edgar/data/123/example.xml",
        "signal_price": signal_price,
        "current_price": current_price,
        "current_position_shares": current_position_shares,
        "confidence": 0.95,
    }


def build_from_payload(tmp_path: Path, signals: list[dict[str, object]], knowledge: dict[str, object] | None = None):
    policy = load_copy_policy(policy_path(tmp_path))
    inbox = write_json(tmp_path / "signals.json", {"signals": signals})
    loaded, warnings = load_public_signals(inbox)
    return build_mirror_plan(
        loaded,
        policy,
        now=datetime(2026, 8, 10, 14, 0, tzinfo=timezone.utc),
        import_warnings=warnings,
        knowledge=knowledge,
    )


def test_form4_open_market_buy_becomes_bounded_paper_candidate(tmp_path: Path) -> None:
    plan = build_from_payload(tmp_path, [signal()])
    candidate = plan.candidates[0]

    assert plan.mode == SAFE_EXECUTION_MODE
    assert candidate.status == "paper_ready"
    assert candidate.mirror_notional_dollars == 5
    assert candidate.mirror_shares == round(5 / 102, 8)
    assert candidate.human_gate_eligible is True
    assert plan.summary["live_orders_placed"] == 0


def test_delayed_holdings_and_event_contracts_stay_research_only(tmp_path: Path) -> None:
    plan = build_from_payload(
        tmp_path,
        [
            signal(signal_id="13f", source_id="sec_13f", transaction_at="2026-07-01T14:00:00Z", disclosed_at="2026-08-09T14:00:00Z"),
            signal(signal_id="event", source_id="public_event", asset_type="event_contract", symbol="EVENT:YES", side="YES", transaction_code="", signal_price=0.4, current_price=0.41),
        ],
    )

    assert [candidate.status for candidate in plan.candidates] == ["research_only", "research_only"]
    assert all(candidate.human_gate_eligible is False for candidate in plan.candidates)
    assert any("authorized execution path" in reason for reason in plan.candidates[0].reasons + plan.candidates[1].reasons)


def test_price_chasing_duplicate_and_short_creation_are_blocked(tmp_path: Path) -> None:
    duplicate = signal(signal_id="same")
    plan = build_from_payload(
        tmp_path,
        [
            signal(signal_id="drift", signal_price=100, current_price=110),
            duplicate,
            duplicate,
            signal(signal_id="sell", side="SELL", transaction_code="S", current_position_shares=0),
        ],
    )
    statuses = [candidate.status for candidate in plan.candidates]

    assert "duplicate" in statuses
    assert sum(status == "paper_ready" for status in statuses) == 1
    assert sum(status == "research_only" for status in statuses) == 2
    assert any("chasing is blocked" in reason for candidate in plan.candidates for reason in candidate.reasons)
    assert any("cannot create a short" in reason for candidate in plan.candidates for reason in candidate.reasons)


def test_form4_transaction_code_must_match_reported_direction(tmp_path: Path) -> None:
    plan = build_from_payload(
        tmp_path,
        [signal(signal_id="mismatch", side="BUY", transaction_code="S")],
    )

    assert plan.candidates[0].status == "research_only"
    assert any("conflicts" in reason for reason in plan.candidates[0].reasons)


def test_paper_apply_is_idempotent_and_never_records_live_execution(tmp_path: Path) -> None:
    plan = build_from_payload(tmp_path, [signal()])
    ledger = tmp_path / "paper.csv"
    history = tmp_path / "history.json"

    first = apply_paper_candidates(plan, ledger_path=ledger, history_path=history)
    second = apply_paper_candidates(plan, ledger_path=ledger, history_path=history)

    assert len(first) == 1
    assert second == []
    assert len(read_ledger(ledger)) == 1
    payload = json.loads(history.read_text())
    assert payload["applied"][0]["live_order_placed"] is False


def test_plan_outputs_do_not_include_broker_credentials_or_order_calls(tmp_path: Path) -> None:
    plan = build_from_payload(tmp_path, [signal()])
    json_path, markdown_path = write_mirror_plan(plan, tmp_path / "plan.json", tmp_path / "plan.md")
    body = json_path.read_text() + markdown_path.read_text()

    assert "live_orders_placed" in body
    assert "Live orders placed: 0" in body
    assert "account_number" not in body
    assert "api_key" not in body


def test_measured_knowledge_ranks_stronger_trader_first_and_blocks_weak_evidence(tmp_path: Path) -> None:
    knowledge = {
        "source_profiles": [],
        "trader_profiles": [
            {"source_id": "sec_form4", "trader_name": "Measured strong", "sample_size": 20, "evidence_score": 0.8},
            {"source_id": "sec_form4", "trader_name": "Measured weak", "sample_size": 20, "evidence_score": 0.2},
        ],
    }
    plan = build_from_payload(
        tmp_path,
        [
            signal(signal_id="weak", symbol="WEAK", trader_name="Measured weak"),
            signal(signal_id="strong", symbol="GOOD", trader_name="Measured strong"),
        ],
        knowledge=knowledge,
    )

    assert [candidate.symbol for candidate in plan.candidates] == ["GOOD", "WEAK"]
    assert plan.candidates[0].status == "paper_ready"
    assert plan.candidates[0].evidence_status == "measured"
    assert plan.candidates[0].evidence_score == 0.8
    assert plan.candidates[1].status == "research_only"
    assert any("evidence-quality floor" in reason for reason in plan.candidates[1].reasons)
