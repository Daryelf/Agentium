from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from stock_guru.lifecycle import (
    DailyRiskState,
    IntradayLifecycleState,
    LivePositionPlan,
    TradeIntent,
    load_lifecycle_state,
    save_lifecycle_state,
)


def test_lifecycle_state_round_trips_live_position_plan(tmp_path) -> None:
    path = tmp_path / "state.json"
    state = IntradayLifecycleState(
        daily_risk=DailyRiskState(date="2026-06-08", trades_today=1),
        intents=[
            TradeIntent(
                symbol="AAPL",
                side="buy",
                setup_type="VWAP Reclaim",
                confidence_score=91,
                entry_price=100,
                entry_zone="99.80-100.20",
                stop_price=98,
                target_1=104,
                target_2=106,
                risk_reward_ratio=2,
                risk_dollars=0.25,
                status="AUTO_ORDER_READY",
            )
        ],
        positions={
            "AAPL": LivePositionPlan(
                symbol="AAPL",
                shares=0.25,
                average_cost=100,
                stop_price=98,
                target_1=104,
                target_2=106,
                profit_lock_price=102,
                thesis="test",
                opened_at="2026-06-08T10:00:00-04:00",
                force_exit_after="2026-06-08T15:45:00-04:00",
            )
        },
        updated_at="2026-06-08T10:00:00-04:00",
    )

    save_lifecycle_state(state, path)
    loaded = load_lifecycle_state(path, now=datetime(2026, 6, 8, 10, 1, tzinfo=ZoneInfo("America/New_York")))

    assert loaded.daily_risk.trades_today == 1
    assert loaded.intents[0].symbol == "AAPL"
    assert loaded.positions["AAPL"].force_exit_after.endswith("15:45:00-04:00")


def test_lifecycle_daily_risk_resets_on_new_day(tmp_path) -> None:
    path = tmp_path / "state.json"
    path.write_text(
        """
{
  "daily_risk": {"date": "2026-06-08", "realized_pnl": -1.0, "trades_today": 3},
  "intents": [],
  "order_plans": [],
  "positions": {},
  "updated_at": "2026-06-08T15:00:00-04:00"
}
""".strip()
        + "\n"
    )

    loaded = load_lifecycle_state(path, now=datetime(2026, 6, 9, 9, 30, tzinfo=ZoneInfo("America/New_York")))

    assert loaded.daily_risk.date == "2026-06-09"
    assert loaded.daily_risk.trades_today == 0
