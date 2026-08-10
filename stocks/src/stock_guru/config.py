from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List


ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
REPORT_DIR = ROOT / "reports"
SETTINGS_PATH = CONFIG_DIR / "settings.json"
UNIVERSE_PATH = CONFIG_DIR / "universe.txt"
LEDGER_PATH = DATA_DIR / "paper_trades.csv"
PROVIDER_KEYS_PATH = DATA_DIR / "provider_keys.json"

TRADING_MODE_INTRADAY = "INTRADAY_SAME_DAY"
TRADING_MODE_SWING = "MULTI_DAY_SWING"
TRADING_MODE_LONG_TERM = "LONG_TERM_INVESTING"
EXECUTION_POLICY_FULL_AUTO = "full_auto_orders"
EXECUTION_POLICY_APPROVAL = "approval_required"
TRADE_DIRECTION_LONG_ONLY = "long_only"


@dataclass(frozen=True)
class Settings:
    default_budget: float
    max_positions: int
    max_position_pct: float
    risk_per_trade_pct: float
    stop_loss_pct: float
    min_price: float
    min_dollar_volume: float
    market_timezone: str
    regular_market_open: str
    regular_market_close: str
    live_account_nickname: str = "Agentic"
    live_account_number: str = ""
    live_principal_dollars: float = 25.0
    live_max_total_dollars: float = 25.0
    live_max_order_dollars: float = 25.0
    live_min_order_dollars: float = 1.0
    live_cash_reserve_dollars: float = 0.0
    live_lock_profits: bool = True
    live_auto_trading_enabled: bool = False
    live_order_confirmation_policy: str = "argentum_human_gate_per_order"
    live_allow_market_notional_entries: bool = True
    live_heartbeat_stale_minutes: int = 5
    live_min_strategy_trades: int = 20
    live_min_strategy_expectancy: float = 0.0
    live_max_strategy_drawdown_pct: float = 0.08
    live_min_profit_factor_to_scale: float = 1.2
    live_scale_up_multiplier: float = 1.25
    live_max_scale_step_dollars: float = 25.0
    live_require_strategy_health_for_entries: bool = True
    live_optimization_stale_hours: int = 24
    live_require_optimization_for_entries: bool = True
    live_use_optimized_intraday_settings: bool = True
    live_require_walk_forward_optimization: bool = True
    trading_mode: str = TRADING_MODE_INTRADAY
    execution_policy: str = EXECUTION_POLICY_APPROVAL
    trade_direction: str = TRADE_DIRECTION_LONG_ONLY
    intraday_min_entry_score: int = 85
    intraday_auto_order_score: int = 90
    intraday_large_size_score: int = 95
    intraday_no_new_entries_after: str = "15:15"
    intraday_force_exit_after: str = "15:45"
    daily_loss_limit_pct: float = 0.02
    max_consecutive_losses: int = 2
    max_trades_per_day: int = 3
    max_symbol_exposure_pct: float = 1.0
    intraday_min_relative_volume: float = 1.2
    intraday_max_spread_pct: float = 0.005


def load_settings(path: Path = SETTINGS_PATH) -> Settings:
    values = json.loads(path.read_text())
    return Settings(**values)


def load_universe(path: Path = UNIVERSE_PATH) -> List[str]:
    return normalize_tickers(path.read_text().splitlines())


def normalize_tickers(tickers: Iterable[str]) -> List[str]:
    clean = []
    seen = set()
    for ticker in tickers:
        symbol = ticker.strip().upper()
        if not symbol or symbol.startswith("#"):
            continue
        if symbol not in seen:
            clean.append(symbol)
            seen.add(symbol)
    return clean
