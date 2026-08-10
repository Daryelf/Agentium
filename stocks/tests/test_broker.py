from __future__ import annotations

from stock_guru.broker import BrokerGuardrails, BrokerMission, build_mission_lines, write_mission_report


def guardrails() -> BrokerGuardrails:
    return BrokerGuardrails(
        account_nickname="Agentic",
        principal_dollars=25,
        max_total_dollars=25,
        max_order_dollars=25,
        min_order_dollars=1,
        cash_reserve_dollars=0,
        lock_profits=True,
    )


def test_guardrails_cap_next_order_by_total_and_order_limits() -> None:
    rules = guardrails()

    assert rules.cap_order(requested_dollars=25, buying_power=25, account_value=25, deployed_dollars=0) == 25
    assert rules.cap_order(requested_dollars=25, buying_power=25, account_value=25, deployed_dollars=18) == 7
    assert rules.cap_order(requested_dollars=25, buying_power=25, account_value=25, deployed_dollars=24.5) == 0


def test_guardrails_lock_profits_above_principal() -> None:
    rules = guardrails()

    assert rules.profit_reserve(account_value=27) == 2
    assert rules.working_bankroll(account_value=27) == 25
    assert rules.cap_order(requested_dollars=27, buying_power=27, account_value=27, deployed_dollars=0) == 25


def test_mission_lines_show_next_allowed_ticket() -> None:
    mission = BrokerMission(account_label="Agentic", account_value=25, cash=25, buying_power=25)

    lines = build_mission_lines(mission, guardrails())

    assert "Mission state: ready" in lines
    assert "Account value: $25.00" in lines
    assert "Working bankroll: $25.00" in lines
    assert "Locked profit reserve: $0.00" in lines
    assert "Next allowed ticket: $25.00" in lines


def test_write_mission_report(tmp_path) -> None:
    path = tmp_path / "mission.md"
    mission = BrokerMission(account_label="Agentic", account_value=25, cash=25, buying_power=25)

    write_mission_report(mission, guardrails(), path=path)

    content = path.read_text()
    assert "# Growth Mission" in content
    assert "Telegram before any Robinhood action" in content
