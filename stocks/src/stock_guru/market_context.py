from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Mapping, Sequence

import pandas as pd

from .config import DATA_DIR
from .data import MarketData, field_for
from .quant.engine import build_quant_snapshot, build_quant_snapshots
from .quant.models import QuantFeatureSnapshot


MARKET_CONTEXT_PATH = DATA_DIR / "market_context.json"
SECTOR_ETFS: tuple[str, ...] = ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")
CONTEXT_BENCHMARKS: tuple[str, ...] = ("SPY", "QQQ", "IWM", "^VIX", "^VXN")
SECTOR_TO_ETF = {
    "basic materials": "XLB",
    "communication services": "XLC",
    "energy": "XLE",
    "financial services": "XLF",
    "financial": "XLF",
    "industrials": "XLI",
    "technology": "XLK",
    "consumer defensive": "XLP",
    "real estate": "XLRE",
    "utilities": "XLU",
    "healthcare": "XLV",
    "consumer cyclical": "XLY",
}


@dataclass(frozen=True)
class BenchmarkContext:
    symbol: str
    last: float | None
    return_5d: float | None
    return_20d: float | None
    return_60d: float | None
    above_ema20: bool | None
    above_sma50: bool | None
    above_sma200: bool | None
    trend: str
    return_126d: float | None = None
    return_252d: float | None = None
    drawdown_63d: float | None = None
    rsi14: float | None = None


@dataclass(frozen=True)
class RelativeStrengthContext:
    symbol: str
    return_5d: float | None
    return_20d: float | None
    return_60d: float | None
    versus_spy_5d: float | None
    versus_spy_20d: float | None
    versus_spy_60d: float | None
    sector_etf: str | None
    versus_sector_20d: float | None
    score: int | None
    state: str
    versus_spy_126d: float | None = None
    versus_spy_252d: float | None = None
    versus_sector_60d: float | None = None


@dataclass(frozen=True)
class MarketRegimeReport:
    version: int
    generated_at: str
    source_provider: str
    source_timestamp: str | None
    data_health_state: str
    data_quality_score: int | None
    regime: str
    trend_regime: str
    volatility_regime: str
    breadth_state: str
    breadth_above_ema20_pct: float | None
    breadth_above_sma50_pct: float | None
    breadth_above_sma200_pct: float | None
    breadth_new_highs_20: int
    breadth_new_lows_20: int
    breadth_new_high_low_balance: float | None
    vix_trend: str
    vxn_trend: str
    yield_curve_slope: float | None
    rate_state: str
    risk_state: str
    benchmarks: Mapping[str, BenchmarkContext]
    sectors: tuple[RelativeStrengthContext, ...]
    symbols: Mapping[str, RelativeStrengthContext]
    blockers: tuple[str, ...]
    regime_reasons: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _close(data: MarketData, symbol: str | None) -> pd.Series:
    if not symbol:
        return pd.Series(dtype="float64")
    try:
        return field_for(data.history, symbol, "Close")
    except Exception:
        return pd.Series(dtype="float64")


def _above(price: float | None, average: float | None) -> bool | None:
    return price > average if price is not None and average is not None else None


def _benchmark_trend(snapshot: QuantFeatureSnapshot) -> str:
    states = (snapshot.trend.short_term, snapshot.trend.medium_term, snapshot.trend.long_term)
    bullish = sum(state == "BULLISH" for state in states)
    bearish = sum(state == "BEARISH" for state in states)
    if bullish >= 2 and bearish == 0:
        return "BULLISH"
    if bearish >= 2 and bullish == 0:
        return "BEARISH"
    return "MIXED" if snapshot.price is not None else "UNKNOWN"


def benchmark_context(
    data: MarketData,
    symbol: str,
    *,
    quant_snapshot: QuantFeatureSnapshot | None = None,
) -> BenchmarkContext:
    snapshot = quant_snapshot or build_quant_snapshot(data, symbol)
    returns = snapshot.momentum.returns
    simple = snapshot.trend.simple_moving_averages
    exponential = snapshot.trend.exponential_moving_averages
    return BenchmarkContext(
        symbol=symbol,
        last=snapshot.price,
        return_5d=returns.get("5d"),
        return_20d=returns.get("20d"),
        return_60d=returns.get("3m"),
        above_ema20=_above(snapshot.price, exponential.get("ema20")),
        above_sma50=_above(snapshot.price, simple.get("sma50")),
        above_sma200=_above(snapshot.price, simple.get("sma200")),
        trend=_benchmark_trend(snapshot),
        return_126d=returns.get("6m"),
        return_252d=returns.get("12m"),
        drawdown_63d=snapshot.volatility.recent_drawdown_63,
        rsi14=snapshot.momentum.rsi14,
    )


def relative_strength_context(
    data: MarketData,
    symbol: str,
    *,
    spy: BenchmarkContext,
    sector_etf: str | None = None,
    quant_snapshot: QuantFeatureSnapshot | None = None,
) -> RelativeStrengthContext:
    snapshot = quant_snapshot or build_quant_snapshot(data, symbol, sector_etf=sector_etf)
    returns = snapshot.momentum.returns
    versus_spy = snapshot.relative_strength.versus_spy
    versus_sector = snapshot.relative_strength.versus_sector
    available = [versus_spy.get(period) for period in ("5d", "20d", "3m", "6m") if versus_spy.get(period) is not None]
    # This legacy display score remains descriptive only. Phase 4 owns the
    # authoritative normalized score and confidence model.
    score = round(50 + max(-50, min(50, sum(available) / len(available) * 500))) if available else None
    score = max(0, min(100, score)) if score is not None else None
    state = "LEADING" if score is not None and score >= 60 else "LAGGING" if score is not None and score <= 40 else "NEUTRAL" if score is not None else "UNKNOWN"
    return RelativeStrengthContext(
        symbol=symbol,
        return_5d=returns.get("5d"),
        return_20d=returns.get("20d"),
        return_60d=returns.get("3m"),
        versus_spy_5d=versus_spy.get("5d"),
        versus_spy_20d=versus_spy.get("20d"),
        versus_spy_60d=versus_spy.get("3m"),
        sector_etf=sector_etf,
        versus_sector_20d=versus_sector.get("20d"),
        score=score,
        state=state,
        versus_spy_126d=versus_spy.get("6m"),
        versus_spy_252d=versus_spy.get("12m"),
        versus_sector_60d=versus_sector.get("3m"),
    )


def _breadth(
    data: MarketData,
    symbols: Sequence[str],
    snapshots: Mapping[str, QuantFeatureSnapshot],
) -> tuple[float | None, float | None, float | None, int, int, float | None, str]:
    above20: list[bool] = []
    above50: list[bool] = []
    above200: list[bool] = []
    new_highs = 0
    new_lows = 0
    observed_extremes = 0
    for symbol in symbols:
        snapshot = snapshots[symbol]
        price = snapshot.price
        ema20 = snapshot.trend.exponential_moving_averages.get("ema20")
        sma50 = snapshot.trend.simple_moving_averages.get("sma50")
        sma200 = snapshot.trend.simple_moving_averages.get("sma200")
        for destination, value in ((above20, ema20), (above50, sma50), (above200, sma200)):
            comparison = _above(price, value)
            if comparison is not None:
                destination.append(comparison)
        close = _close(data, symbol)
        if len(close) >= 21:
            latest = float(close.iloc[-1])
            previous = close.iloc[-21:-1]
            new_highs += int(latest >= float(previous.max()))
            new_lows += int(latest <= float(previous.min()))
            observed_extremes += 1

    def fraction(values: list[bool]) -> float | None:
        return sum(values) / len(values) if values else None

    breadth20 = fraction(above20)
    breadth50 = fraction(above50)
    breadth200 = fraction(above200)
    balance = (new_highs - new_lows) / observed_extremes if observed_extremes else None
    if breadth20 is None or breadth50 is None:
        state = "UNKNOWN"
    elif breadth20 >= 0.65 and breadth50 >= 0.55 and (breadth200 is None or breadth200 >= 0.5):
        state = "STRONG"
    elif breadth20 <= 0.35 and breadth50 <= 0.45 and (breadth200 is None or breadth200 <= 0.5):
        state = "WEAK"
    else:
        state = "MIXED"
    return breadth20, breadth50, breadth200, new_highs, new_lows, balance, state


def _volatility_trend(context: BenchmarkContext) -> str:
    change = context.return_20d
    if change is None:
        return "UNKNOWN"
    if change >= 0.1:
        return "RISING"
    if change <= -0.1:
        return "FALLING"
    return "STABLE"


def _rate_context(rates: Mapping[str, float] | None) -> tuple[float | None, str]:
    if not rates:
        return None, "UNKNOWN"
    try:
        ten_year = float(rates["DGS10"])
        three_month = float(rates["DGS3MO"])
    except (KeyError, TypeError, ValueError):
        return None, "UNKNOWN"
    slope = ten_year - three_month
    state = "INVERTED" if slope < 0 else "STEEP" if slope >= 1.0 else "NORMAL"
    return round(slope, 4), state


def _classify_regime(
    *,
    trend_regime: str,
    volatility_regime: str,
    breadth_state: str,
    breadth20: float | None,
    breadth50: float | None,
    breadth200: float | None,
    vix_trend: str,
    rate_state: str,
) -> tuple[str, str, tuple[str, ...]]:
    reasons: list[str] = []
    if trend_regime == "BULLISH":
        reasons.append("SPY and QQQ trend structure is bullish.")
    elif trend_regime == "BEARISH":
        reasons.append("SPY and QQQ trend structure is bearish.")
    if breadth_state == "STRONG":
        reasons.append("Internal breadth is broadly supportive.")
    elif breadth_state == "WEAK":
        reasons.append("Internal breadth is weak.")
    if volatility_regime == "HIGH":
        reasons.append("VIX or VXN is in a high-volatility range.")
    if vix_trend == "RISING":
        reasons.append("VIX has risen at least 10% over 20 sessions.")
    if rate_state == "INVERTED":
        reasons.append("The 10-year minus 3-month Treasury curve is inverted.")

    if volatility_regime == "HIGH":
        label = "HIGH_VOLATILITY"
    elif trend_regime == "BEARISH" and breadth_state == "WEAK":
        label = "RISK_OFF"
    elif trend_regime == "BEARISH":
        label = "BEAR"
    elif breadth_state == "WEAK" or vix_trend == "RISING" or (rate_state == "INVERTED" and trend_regime != "BULLISH"):
        label = "CAUTION"
    elif (
        trend_regime == "BULLISH"
        and breadth20 is not None and breadth20 >= 0.7
        and breadth50 is not None and breadth50 >= 0.6
        and (breadth200 is None or breadth200 >= 0.5)
        and volatility_regime in {"LOW", "NORMAL"}
    ):
        label = "STRONG_BULL"
    elif trend_regime == "BULLISH" and breadth_state != "WEAK":
        label = "BULL"
    else:
        label = "NEUTRAL"
    risk_state = "RISK_OFF" if label in {"HIGH_VOLATILITY", "RISK_OFF", "BEAR"} else "RISK_ON" if label in {"STRONG_BULL", "BULL"} else "NEUTRAL"
    return label, risk_state, tuple(reasons)


def _sector_etf(value: str) -> str | None:
    normalized = str(value or "").strip()
    if normalized.upper() in SECTOR_ETFS:
        return normalized.upper()
    return SECTOR_TO_ETF.get(normalized.lower())


def build_market_regime(
    data: MarketData,
    symbols: Sequence[str],
    *,
    generated_at: datetime | None = None,
    sectors_by_symbol: Mapping[str, str] | None = None,
    rates: Mapping[str, float] | None = None,
) -> MarketRegimeReport:
    at = generated_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    normalized_symbols = list(dict.fromkeys(str(symbol).upper() for symbol in symbols if str(symbol).strip()))
    all_context_symbols = list(dict.fromkeys([*normalized_symbols, *CONTEXT_BENCHMARKS, *SECTOR_ETFS]))
    direct_sector_map = {str(key).upper(): _sector_etf(str(value)) for key, value in (sectors_by_symbol or {}).items()}
    snapshots = build_quant_snapshots(data, all_context_symbols, sectors_by_symbol={key: value for key, value in direct_sector_map.items() if value}, generated_at=at)
    benchmarks = {symbol: benchmark_context(data, symbol, quant_snapshot=snapshots[symbol]) for symbol in CONTEXT_BENCHMARKS}
    spy = benchmarks["SPY"]
    qqq = benchmarks["QQQ"]
    vix = benchmarks["^VIX"]
    vxn = benchmarks["^VXN"]
    trend_regime = "BULLISH" if spy.trend == "BULLISH" and qqq.trend == "BULLISH" else "BEARISH" if spy.trend == "BEARISH" and qqq.trend == "BEARISH" else "MIXED"
    high_volatility = (vix.last is not None and vix.last >= 30) or (vxn.last is not None and vxn.last >= 35)
    low_volatility = vix.last is not None and vix.last < 15 and (vxn.last is None or vxn.last < 20)
    volatility_regime = "HIGH" if high_volatility else "LOW" if low_volatility else "NORMAL" if vix.last is not None or vxn.last is not None else "UNKNOWN"

    excluded = {*CONTEXT_BENCHMARKS, *SECTOR_ETFS}
    breadth_symbols = [symbol for symbol in normalized_symbols if symbol not in excluded and snapshots[symbol].price is not None]
    breadth20, breadth50, breadth200, new_highs, new_lows, high_low_balance, breadth_state = _breadth(data, breadth_symbols, snapshots)
    vix_trend = _volatility_trend(vix)
    vxn_trend = _volatility_trend(vxn)
    yield_curve_slope, rate_state = _rate_context(rates)
    regime, risk_state, regime_reasons = _classify_regime(
        trend_regime=trend_regime,
        volatility_regime=volatility_regime,
        breadth_state=breadth_state,
        breadth20=breadth20,
        breadth50=breadth50,
        breadth200=breadth200,
        vix_trend=vix_trend,
        rate_state=rate_state,
    )
    blockers: list[str] = []
    quality = data.quality
    if quality is not None and not quality.is_usable:
        blockers.append(f"Market-context data quality is {quality.state.value}.")
    if spy.last is None or qqq.last is None:
        blockers.append("SPY/QQQ benchmark history is incomplete.")
    if not breadth_symbols:
        blockers.append("No candidate-universe symbols were available for internal breadth.")

    sector_contexts = tuple(sorted(
        (
            relative_strength_context(data, symbol, spy=spy, quant_snapshot=snapshots[symbol])
            for symbol in SECTOR_ETFS
            if snapshots[symbol].price is not None
        ),
        key=lambda item: item.score if item.score is not None else -1,
        reverse=True,
    ))
    symbol_contexts = {
        symbol: relative_strength_context(
            data,
            symbol,
            spy=spy,
            sector_etf=direct_sector_map.get(symbol),
            quant_snapshot=snapshots[symbol],
        )
        for symbol in breadth_symbols
    }
    provenance = data.provenance
    return MarketRegimeReport(
        version=2,
        generated_at=at.astimezone(timezone.utc).isoformat(),
        source_provider=provenance.provider if provenance else "UNKNOWN",
        source_timestamp=provenance.source_timestamp if provenance else None,
        data_health_state=quality.state.value if quality else "UNKNOWN",
        data_quality_score=quality.score if quality else None,
        regime=regime,
        trend_regime=trend_regime,
        volatility_regime=volatility_regime,
        breadth_state=breadth_state,
        breadth_above_ema20_pct=breadth20,
        breadth_above_sma50_pct=breadth50,
        breadth_above_sma200_pct=breadth200,
        breadth_new_highs_20=new_highs,
        breadth_new_lows_20=new_lows,
        breadth_new_high_low_balance=high_low_balance,
        vix_trend=vix_trend,
        vxn_trend=vxn_trend,
        yield_curve_slope=yield_curve_slope,
        rate_state=rate_state,
        risk_state=risk_state,
        benchmarks=benchmarks,
        sectors=sector_contexts,
        symbols=symbol_contexts,
        blockers=tuple(blockers),
        regime_reasons=regime_reasons,
    )


def write_market_context_report(report: MarketRegimeReport, path: Path = MARKET_CONTEXT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.to_dict(), indent=2, sort_keys=True, allow_nan=False) + "\n")
    return path
