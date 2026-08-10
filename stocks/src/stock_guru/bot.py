from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping

from .config import DATA_DIR, Settings
from .evaluator import TradeEvaluation, VALID_BUY_SETUP, VALID_SELL_SIGNAL
from .paper import record_trade
from .scoring import Candidate


BOT_STATE_PATH = DATA_DIR / "paper_bot_state.json"


@dataclass(frozen=True)
class BotPosition:
    ticker: str
    shares: float
    avg_cost: float
    high_price: float | None = None
    stop_price: float | None = None
    take_profit_price: float | None = None

    @property
    def cost_basis(self) -> float:
        return self.shares * self.avg_cost


@dataclass(frozen=True)
class BotState:
    starting_cash: float
    cash: float
    positions: dict[str, BotPosition]

    @property
    def invested_cost(self) -> float:
        return sum(position.cost_basis for position in self.positions.values())


@dataclass(frozen=True)
class BotDecision:
    action: str
    ticker: str | None
    reason: str
    shares: float = 0.0
    price: float = 0.0
    notional: float = 0.0
    stop_price: float | None = None
    take_profit_price: float | None = None


@dataclass(frozen=True)
class BotSnapshot:
    state: BotState
    equity: float
    unrealized_pnl: float
    decision: BotDecision
    candidates: list[Candidate]


def load_bot_state(path: Path = BOT_STATE_PATH, *, starting_cash: float = 20.0) -> BotState:
    if not path.exists():
        return BotState(starting_cash=starting_cash, cash=starting_cash, positions={})

    raw = json.loads(path.read_text())
    positions = {
        ticker: BotPosition(
            ticker=ticker,
            shares=float(values["shares"]),
            avg_cost=float(values["avg_cost"]),
            high_price=float(values.get("high_price", values["avg_cost"])),
            stop_price=(
                float(values["stop_price"]) if values.get("stop_price") is not None else float(values["avg_cost"]) * 0.98
            ),
            take_profit_price=(
                float(values["take_profit_price"]) if values.get("take_profit_price") is not None else float(values["avg_cost"]) * 1.03
            ),
        )
        for ticker, values in raw.get("positions", {}).items()
    }
    return BotState(
        starting_cash=float(raw.get("starting_cash", starting_cash)),
        cash=float(raw.get("cash", starting_cash)),
        positions=positions,
    )


def save_bot_state(state: BotState, path: Path = BOT_STATE_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "starting_cash": state.starting_cash,
        "cash": state.cash,
        "positions": {ticker: asdict(position) for ticker, position in state.positions.items()},
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def reset_bot_state(starting_cash: float, path: Path = BOT_STATE_PATH) -> BotState:
    state = BotState(starting_cash=starting_cash, cash=starting_cash, positions={})
    save_bot_state(state, path)
    return state


def mark_to_market(state: BotState, prices: Mapping[str, float]) -> tuple[float, float]:
    market_value = 0.0
    unrealized_pnl = 0.0
    for ticker, position in state.positions.items():
        price = prices.get(ticker, position.avg_cost)
        value = position.shares * price
        market_value += value
        unrealized_pnl += value - position.cost_basis
    return state.cash + market_value, unrealized_pnl


def refresh_position_highs(state: BotState, prices: Mapping[str, float]) -> tuple[BotState, bool]:
    positions: dict[str, BotPosition] = {}
    changed = False
    for ticker, position in state.positions.items():
        price = prices.get(ticker)
        prior_high = position.high_price if position.high_price is not None else position.avg_cost
        high_price = max(prior_high, price) if price is not None and price > 0 else prior_high
        if high_price != position.high_price:
            changed = True
        positions[ticker] = BotPosition(
            position.ticker,
            position.shares,
            position.avg_cost,
            high_price,
            position.stop_price,
            position.take_profit_price,
        )
    if not changed:
        return state, False
    return BotState(starting_cash=state.starting_cash, cash=state.cash, positions=positions), True


def candidate_prices(candidates: list[Candidate]) -> dict[str, float]:
    return {candidate.ticker: candidate.price for candidate in candidates}


def candidate_map(candidates: list[Candidate]) -> dict[str, Candidate]:
    return {candidate.ticker: candidate for candidate in candidates}


def planned_exit_prices(
    *,
    price: float,
    stop_loss_pct: float,
    take_profit_pct: float,
    evaluation: TradeEvaluation | None = None,
) -> tuple[float, float]:
    fallback_stop = price * (1 - stop_loss_pct)
    fallback_target = price * (1 + take_profit_pct)
    stop = evaluation.stop_loss if evaluation and 0 < evaluation.stop_loss < price else fallback_stop
    target = evaluation.target_1 if evaluation and evaluation.target_1 > price else fallback_target
    return stop, target


def run_bot_once(
    *,
    candidates: list[Candidate],
    settings: Settings,
    starting_cash: float = 20.0,
    entry_score: float = 72.0,
    exit_score: float = 55.0,
    stop_loss_pct: float = 0.02,
    take_profit_pct: float = 0.03,
    min_trade_dollars: float = 1.0,
    trade_dollars: float | None = None,
    evaluations: Mapping[str, TradeEvaluation] | None = None,
    dry_run: bool = False,
    state_path: Path = BOT_STATE_PATH,
) -> BotSnapshot:
    state = load_bot_state(state_path, starting_cash=starting_cash)
    prices = candidate_prices(candidates)
    by_ticker = candidate_map(candidates)

    if not candidates:
        equity, pnl = mark_to_market(state, prices)
        return BotSnapshot(state, equity, pnl, BotDecision("HOLD", None, "no candidates"), candidates)

    decision = maybe_sell(
        state=state,
        candidates=by_ticker,
        prices=prices,
        settings=settings,
        exit_score=exit_score,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
        evaluations=evaluations,
        dry_run=dry_run,
    )
    if decision.action == "SELL":
        if dry_run:
            equity, pnl = mark_to_market(state, prices)
            return BotSnapshot(state, equity, pnl, decision, candidates)
        else:
            state = apply_sell(state, decision)
            record_trade("SELL", decision.ticker or "", decision.shares, decision.price, decision.reason, settings.market_timezone)
            save_bot_state(state, state_path)
        equity, pnl = mark_to_market(state, prices)
        return BotSnapshot(state, equity, pnl, decision, candidates)

    highs_changed = False
    if not dry_run:
        state, highs_changed = refresh_position_highs(state, prices)

    decision = maybe_buy(
        state=state,
        candidates=candidates,
        settings=settings,
        entry_score=entry_score,
        min_trade_dollars=min_trade_dollars,
        trade_dollars=trade_dollars,
        evaluations=evaluations,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
    )
    if decision.action == "BUY":
        if dry_run:
            equity, pnl = mark_to_market(state, prices)
            return BotSnapshot(state, equity, pnl, decision, candidates)
        else:
            state = apply_buy(state, decision)
            record_trade("BUY", decision.ticker or "", decision.shares, decision.price, decision.reason, settings.market_timezone)
            save_bot_state(state, state_path)
        equity, pnl = mark_to_market(state, prices)
        return BotSnapshot(state, equity, pnl, decision, candidates)

    if highs_changed:
        save_bot_state(state, state_path)
    equity, pnl = mark_to_market(state, prices)
    return BotSnapshot(state, equity, pnl, decision, candidates)


def maybe_sell(
    *,
    state: BotState,
    candidates: Mapping[str, Candidate],
    prices: Mapping[str, float],
    settings: Settings,
    exit_score: float,
    stop_loss_pct: float,
    take_profit_pct: float,
    evaluations: Mapping[str, TradeEvaluation] | None = None,
    dry_run: bool,
) -> BotDecision:
    for ticker, position in state.positions.items():
        price = prices.get(ticker, position.avg_cost)
        score = candidates.get(ticker).score if ticker in candidates else 0.0
        evaluation = evaluations.get(ticker) if evaluations else None
        high_price = max(position.high_price or position.avg_cost, price)
        hard_stop = position.avg_cost * (1 - stop_loss_pct)
        planned_stop = position.stop_price if position.stop_price and position.stop_price > 0 else None
        technical_stop = evaluation.stop_loss if evaluation and evaluation.stop_loss > 0 else None
        stop_candidates = [hard_stop]
        if planned_stop is not None:
            stop_candidates.append(planned_stop)
        if technical_stop is not None:
            stop_candidates.append(technical_stop)
        effective_stop = max(stop_candidates)

        if evaluation and evaluation.decision == VALID_SELL_SIGNAL:
            reason = evaluation.main_reason_valid or evaluation.main_risk or "sell alert"
            return BotDecision("SELL", ticker, f"sell alert: {reason}", position.shares, price, position.shares * price)
        if price <= effective_stop:
            if price <= hard_stop:
                reason = "paper bot stop loss"
            elif planned_stop is not None and effective_stop == planned_stop:
                reason = "paper bot planned stop"
            else:
                reason = "paper bot technical stop"
            return BotDecision("SELL", ticker, reason, position.shares, price, position.shares * price)

        profit_trigger = (
            position.take_profit_price
            if position.take_profit_price and position.take_profit_price > position.avg_cost
            else position.avg_cost * (1 + take_profit_pct)
        )
        trailing_stop = max(position.avg_cost * 1.005, high_price * (1 - stop_loss_pct))
        if high_price >= profit_trigger and price <= trailing_stop:
            return BotDecision("SELL", ticker, "paper bot trailing profit lock", position.shares, price, position.shares * price)
        if price >= profit_trigger and (not evaluation or evaluation.decision != VALID_BUY_SETUP or score < max(65.0, exit_score + 10.0)):
            return BotDecision("SELL", ticker, "paper bot take profit", position.shares, price, position.shares * price)
        if score < exit_score:
            return BotDecision("SELL", ticker, f"paper bot score exit {score:.1f}", position.shares, price, position.shares * price)

    reason = "dry run" if dry_run else "no exit rule triggered"
    return BotDecision("HOLD", None, reason)


def maybe_buy(
    *,
    state: BotState,
    candidates: list[Candidate],
    settings: Settings,
    entry_score: float,
    min_trade_dollars: float,
    trade_dollars: float | None = None,
    evaluations: Mapping[str, TradeEvaluation] | None = None,
    stop_loss_pct: float = 0.02,
    take_profit_pct: float = 0.03,
) -> BotDecision:
    if len(state.positions) >= settings.max_positions:
        return BotDecision("HOLD", None, "max paper positions reached")

    available = [candidate for candidate in candidates if candidate.ticker not in state.positions]
    if evaluations is not None:
        valid = [candidate for candidate in available if evaluations.get(candidate.ticker) and evaluations[candidate.ticker].decision == VALID_BUY_SETUP]
        if not valid:
            top = available[0] if available else candidates[0]
            return BotDecision("HOLD", top.ticker, "no valid buy setup from evaluator")
        available = valid

    top = available[0] if available else candidates[0]
    if top.score < entry_score:
        return BotDecision("HOLD", top.ticker, f"top score {top.score:.1f} below entry {entry_score:.1f}")
    if state.cash < min_trade_dollars:
        return BotDecision("HOLD", top.ticker, "cash below minimum trade")

    target_trade = trade_dollars if trade_dollars is not None else state.cash
    deployable = max(0.0, min(state.cash, target_trade))
    if deployable < min_trade_dollars:
        return BotDecision("HOLD", top.ticker, "ticket size below minimum trade")
    shares = deployable / top.price if top.price > 0 else 0.0
    if shares <= 0:
        return BotDecision("HOLD", top.ticker, "cannot size trade")
    evaluation = evaluations.get(top.ticker) if evaluations else None
    stop_price, take_profit_price = planned_exit_prices(
        price=top.price,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
        evaluation=evaluation,
    )
    plan_text = f"stop ${stop_price:.2f}; target ${take_profit_price:.2f}"
    if evaluations and top.ticker in evaluations:
        reason = f"buy alert score {evaluations[top.ticker].score}; {plan_text}"
    else:
        reason = f"paper bot entry score {top.score:.1f}; {plan_text}"
    return BotDecision(
        "BUY",
        top.ticker,
        reason,
        shares,
        top.price,
        shares * top.price,
        stop_price,
        take_profit_price,
    )


def apply_buy(state: BotState, decision: BotDecision) -> BotState:
    if not decision.ticker:
        return state
    positions = dict(state.positions)
    positions[decision.ticker] = BotPosition(
        decision.ticker,
        decision.shares,
        decision.price,
        decision.price,
        decision.stop_price,
        decision.take_profit_price,
    )
    cash = state.cash - decision.notional
    if abs(cash) < 0.000001:
        cash = 0.0
    return BotState(
        starting_cash=state.starting_cash,
        cash=max(0.0, cash),
        positions=positions,
    )


def apply_sell(state: BotState, decision: BotDecision) -> BotState:
    if not decision.ticker:
        return state
    positions = dict(state.positions)
    positions.pop(decision.ticker, None)
    cash = state.cash + decision.notional
    if abs(cash) < 0.000001:
        cash = 0.0
    return BotState(
        starting_cash=state.starting_cash,
        cash=cash,
        positions=positions,
    )
