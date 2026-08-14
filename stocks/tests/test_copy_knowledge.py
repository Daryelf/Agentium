from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from stock_guru.copy_knowledge import (
    PriceObservation,
    build_copy_knowledge,
    capture_signal_price_observations,
    load_price_observations,
    write_copy_knowledge,
)
from stock_guru.copy_trader import load_copy_policy, load_public_signals, signal_fingerprint


BASE = datetime(2026, 1, 1, 14, 0, tzinfo=timezone.utc)


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def policy_path(tmp_path: Path, *, source_id: str = "sec_form4", mirror_eligible: bool = True, prior: int = 20) -> Path:
    return write_json(
        tmp_path / "copy_trader.json",
        {
            "version": 1,
            "execution_mode": "paper_and_human_gate_only",
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
            "knowledge": {
                "prior_strength": prior,
                "minimum_samples_for_gate": 8,
                "minimum_evidence_score": 0.4,
            },
            "sources": [
                {
                    "id": source_id,
                    "name": source_id,
                    "source_type": "official_disclosure" if mirror_eligible else "delayed_holdings",
                    "enabled": True,
                    "mirror_eligible": mirror_eligible,
                    "max_disclosure_lag_hours": 96 if mirror_eligible else 1080,
                }
            ],
        },
    )


def signal_payload(
    index: int = 0,
    *,
    source_id: str = "sec_form4",
    trader_name: str = "Tracked person",
    side: str = "BUY",
) -> dict[str, object]:
    transaction = BASE + timedelta(minutes=index)
    disclosed = transaction + timedelta(hours=24)
    observed = disclosed + timedelta(minutes=5)
    return {
        "id": f"signal-{index}",
        "source_id": source_id,
        "trader_name": trader_name,
        "asset_type": "equity",
        "symbol": f"EX{index}",
        "side": side,
        "transaction_code": "P" if side == "BUY" else "S",
        "transaction_at": transaction.isoformat(),
        "disclosed_at": disclosed.isoformat(),
        "observed_at": observed.isoformat(),
        "source_url": "https://www.sec.gov/Archives/edgar/data/123/example.xml",
        "signal_price": 100,
        "initial_observed_price": 100,
        "current_price": 100,
        "current_price_observed_at": observed.isoformat(),
        "confidence": 0.95,
        "current_position_shares": 1,
    }


def load_signals(tmp_path: Path, payloads: list[dict[str, object]]):
    path = write_json(tmp_path / "signals.json", {"signals": payloads})
    signals, warnings = load_public_signals(path)
    assert warnings == []
    return signals


def observation(signal, *, days: float, price: float, provenance: str = "market_snapshot") -> PriceObservation:
    reference = (
        "broker-order-123" if provenance == "broker_fill" else
        "paper-ledger-row-123" if provenance == "paper_fill" else
        f"https://finance.yahoo.com/quote/{signal.symbol}"
    )
    return PriceObservation(
        signal_fingerprint=signal_fingerprint(signal),
        observed_at=signal.observed_at + timedelta(days=days),
        price=price,
        provenance=provenance,
        reference=reference,
        market_regime="bull",
    )


def test_horizon_uses_only_observations_at_or_after_target_and_ignores_future(tmp_path: Path) -> None:
    signal = load_signals(tmp_path, [signal_payload()])[0]
    policy = load_copy_policy(policy_path(tmp_path))
    report = build_copy_knowledge(
        [signal],
        [
            observation(signal, days=0.5, price=200),
            observation(signal, days=1, price=110),
            observation(signal, days=2, price=500),
        ],
        policy,
        now=signal.observed_at + timedelta(days=1, minutes=1),
    )

    outcome = report.signal_outcomes[0]
    one_day = outcome.horizons[0]
    assert one_day.status == "measured"
    assert one_day.price == 110
    assert one_day.directional_return == 0.1
    assert outcome.selected_directional_return == 0.1
    assert any("after the report's as-of time" in warning for warning in outcome.warnings)


def test_small_sample_is_shrunk_toward_neutral(tmp_path: Path) -> None:
    signal = load_signals(tmp_path, [signal_payload()])[0]
    policy = load_copy_policy(policy_path(tmp_path, prior=20))
    report = build_copy_knowledge(
        [signal],
        [observation(signal, days=1, price=200)],
        policy,
        now=signal.observed_at + timedelta(days=2),
    )

    profile = report.source_profiles[0]
    assert profile.raw_quality_score == 1.0
    assert abs(profile.posterior_quality_score - 0.5) < 0.025
    assert profile.evidence_status == "small_sample"


def test_delayed_source_score_is_hard_capped_and_never_becomes_mirror_eligible(tmp_path: Path) -> None:
    signals = load_signals(
        tmp_path,
        [signal_payload(index, source_id="sec_13f", trader_name="Delayed manager") for index in range(12)],
    )
    policy = load_copy_policy(policy_path(tmp_path, source_id="sec_13f", mirror_eligible=False, prior=1))
    observations = [observation(signal, days=1, price=120) for signal in signals]
    report = build_copy_knowledge(
        signals,
        observations,
        policy,
        now=max(signal.observed_at for signal in signals) + timedelta(days=2),
    )

    profile = report.source_profiles[0]
    assert profile.sample_size == 12
    assert profile.posterior_quality_score > 0.8
    assert profile.execution_score_cap == 0.45
    assert profile.evidence_score == 0.45
    assert profile.mirror_eligible is False


def test_missing_outcome_is_not_invented_and_fill_provenance_is_counted(tmp_path: Path) -> None:
    measured_signal, pending_signal = load_signals(tmp_path, [signal_payload(0), signal_payload(1)])
    policy = load_copy_policy(policy_path(tmp_path))
    report = build_copy_knowledge(
        [measured_signal, pending_signal],
        [observation(measured_signal, days=1, price=105, provenance="broker_fill")],
        policy,
        now=pending_signal.observed_at + timedelta(days=2),
    )

    outcomes = {item.signal_id: item for item in report.signal_outcomes}
    assert outcomes["signal-0"].status == "measured"
    assert outcomes["signal-0"].outcome_provenance == "broker_fill"
    assert outcomes["signal-1"].status == "pending"
    assert outcomes["signal-1"].selected_directional_return is None
    assert report.source_profiles[0].sample_size == 1
    assert report.source_profiles[0].provenance_counts == {"broker_fill": 1}


def test_capture_is_append_only_idempotent_and_reports_are_deterministic(tmp_path: Path) -> None:
    signal = load_signals(tmp_path, [signal_payload()])[0]
    observations_path = tmp_path / "observations.json"
    first, first_warnings = capture_signal_price_observations([signal], path=observations_path)
    second, second_warnings = capture_signal_price_observations([signal], path=observations_path)
    observations, load_warnings = load_price_observations(observations_path)

    assert first == 1
    assert second == 0
    assert first_warnings == second_warnings == load_warnings == []
    assert len(observations) == 1

    policy = load_copy_policy(policy_path(tmp_path))
    report = build_copy_knowledge([signal], observations, policy, now=signal.observed_at)
    json_path, markdown_path = write_copy_knowledge(
        report,
        tmp_path / "knowledge.json",
        tmp_path / "knowledge.md",
    )
    payload = json.loads(json_path.read_text())
    assert payload["methodology"]["look_ahead_allowed"] is False
    assert payload["summary"]["live_orders_placed"] == 0
    assert "does not claim" in markdown_path.read_text()
