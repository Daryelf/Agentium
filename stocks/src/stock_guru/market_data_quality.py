from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from enum import Enum
import json
import math
import os
from pathlib import Path
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

import pandas as pd

from .market_calendar import MarketSession, market_clock, previous_trading_day, trading_day, trading_days


class DataHealthState(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    DELAYED = "DELAYED"
    STALE = "STALE"
    PARTIAL = "PARTIAL"
    OFFLINE = "OFFLINE"


class AnalysisDataStatus(str, Enum):
    DATA_OK = "DATA_OK"
    DATA_PARTIAL = "DATA_PARTIAL"
    DATA_STALE = "DATA_STALE"
    DATA_CONFLICT = "DATA_CONFLICT"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


@dataclass(frozen=True)
class DataQualityIssue:
    code: str
    severity: str
    detail: str
    symbol: str | None = None
    count: int = 1


@dataclass(frozen=True)
class DataQualityReport:
    state: DataHealthState
    score: int
    checked_at: str
    newest_source_at: str | None
    age_seconds: float | None
    rows: int
    requested_symbols: tuple[str, ...]
    available_symbols: tuple[str, ...]
    issues: tuple[DataQualityIssue, ...] = ()
    analysis_status: AnalysisDataStatus = AnalysisDataStatus.DATA_INSUFFICIENT

    @property
    def is_usable(self) -> bool:
        return (
            self.state not in {DataHealthState.OFFLINE, DataHealthState.STALE}
            and self.analysis_status not in {AnalysisDataStatus.DATA_STALE, AnalysisDataStatus.DATA_CONFLICT, AnalysisDataStatus.DATA_INSUFFICIENT}
            and self.score >= 55
        )

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["state"] = self.state.value
        payload["analysis_status"] = self.analysis_status.value
        payload["is_usable"] = self.is_usable
        return payload


@dataclass(frozen=True)
class DataProvenance:
    provider: str
    data_type: str
    feed_type: str
    interval: str
    period: str
    requested_symbols: tuple[str, ...]
    received_at: str
    processed_at: str
    source_timestamp: str | None = None
    latency_ms: int | None = None
    is_realtime: bool = False
    is_delayed: bool = True
    is_stale: bool = False
    quality_score: int = 0
    health_state: DataHealthState = DataHealthState.OFFLINE
    fallback_from: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()
    endpoint: str | None = None
    request_id: str | None = None
    metadata: Mapping[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["health_state"] = self.health_state.value
        return payload


@dataclass(frozen=True)
class ProviderAttempt:
    provider: str
    status: str
    started_at: str
    completed_at: str
    latency_ms: int
    data_type: str
    interval: str
    requested_symbols: tuple[str, ...]
    returned_symbols: tuple[str, ...] = ()
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: object) -> str | None:
    if value is None:
        return None
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("UTC")
    else:
        parsed = parsed.tz_convert("UTC")
    return parsed.isoformat()


def symbols_in_frame(history: pd.DataFrame) -> tuple[str, ...]:
    if history.empty:
        return ()
    if isinstance(history.columns, pd.MultiIndex):
        level_zero = {str(value) for value in history.columns.get_level_values(0)}
        symbol_level = 1 if {"Open", "High", "Low", "Close", "Volume"} & level_zero else 0
        return tuple(sorted({str(value).upper() for value in history.columns.get_level_values(symbol_level)}))
    return ()


def field_for_symbol(history: pd.DataFrame, symbol: str, field_name: str) -> pd.Series:
    if history.empty:
        return pd.Series(dtype="float64")
    try:
        if isinstance(history.columns, pd.MultiIndex):
            if (field_name, symbol) in history.columns:
                values = history[(field_name, symbol)]
            elif (symbol, field_name) in history.columns:
                values = history[(symbol, field_name)]
            else:
                return pd.Series(dtype="float64")
        else:
            if field_name not in history.columns:
                return pd.Series(dtype="float64")
            values = history[field_name]
        return pd.to_numeric(values, errors="coerce")
    except Exception:
        return pd.Series(dtype="float64")


def interval_seconds(interval: str) -> int:
    value = str(interval or "").strip().lower()
    if value.endswith("m") and value[:-1].isdigit():
        return max(60, int(value[:-1]) * 60)
    if value.endswith("h") and value[:-1].isdigit():
        return max(3600, int(value[:-1]) * 3600)
    if value in {"1d", "1day", "day"}:
        return 86_400
    return 86_400


def expected_market_open(at: datetime) -> bool:
    return market_clock(at).session in {MarketSession.PRE_MARKET, MarketSession.REGULAR, MarketSession.AFTER_HOURS}


def stale_after_seconds(interval: str, at: datetime) -> int:
    seconds = interval_seconds(interval)
    if seconds >= 86_400:
        return 4 * 86_400
    if expected_market_open(at):
        return max(seconds * 3, 5 * 60)
    return 4 * 86_400


def _market_date(value: object, *, daily: bool) -> date | None:
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if daily and parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0:
        return parsed.date()
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("UTC")
    return parsed.tz_convert("America/New_York").date()


def _latest_completed_trading_day(at: datetime) -> date:
    local = at.astimezone(ZoneInfo("America/New_York"))
    schedule = trading_day(local.date())
    if schedule.is_trading_day and schedule.regular_close and local.time() >= schedule.regular_close:
        return local.date()
    return previous_trading_day(local.date())


def missing_daily_sessions(series: pd.Series) -> tuple[date, ...]:
    clean = series.dropna()
    if len(clean) < 2:
        return ()
    observed = {_market_date(value, daily=True) for value in clean.index}
    observed.discard(None)
    if len(observed) < 2:
        return ()
    expected = set(trading_days(min(observed), max(observed)))
    return tuple(sorted(expected - observed))


def compare_provider_closes(
    primary: pd.DataFrame,
    validation: pd.DataFrame,
    symbols: Sequence[str],
    *,
    tolerance_pct: float = 0.005,
) -> tuple[DataQualityIssue, ...]:
    issues: list[DataQualityIssue] = []
    for symbol in symbols:
        left = field_for_symbol(primary, symbol, "Close").dropna()
        right = field_for_symbol(validation, symbol, "Close").dropna()
        if left.empty or right.empty:
            continue
        left_by_day = {_market_date(index, daily=True): float(value) for index, value in left.items() if float(value) > 0}
        right_by_day = {_market_date(index, daily=True): float(value) for index, value in right.items() if float(value) > 0}
        shared = sorted(set(left_by_day) & set(right_by_day))
        if not shared:
            continue
        day = shared[-1]
        baseline = left_by_day[day]
        difference = abs(right_by_day[day] - baseline) / baseline if baseline > 0 else 0.0
        if difference > tolerance_pct:
            issues.append(DataQualityIssue(
                "PROVIDER_PRICE_CONFLICT",
                "critical",
                f"Adjusted closes disagree by {difference:.2%} on {day.isoformat()}; tolerance is {tolerance_pct:.2%}.",
                symbol=symbol,
            ))
    return tuple(issues)


def _newest_timestamp(history: pd.DataFrame) -> datetime | None:
    if history.empty or not isinstance(history.index, pd.DatetimeIndex) or len(history.index) == 0:
        return None
    try:
        newest = pd.Timestamp(history.index.max())
        if newest.tzinfo is None:
            newest = newest.tz_localize("UTC")
        else:
            newest = newest.tz_convert("UTC")
        return newest.to_pydatetime()
    except Exception:
        return None


def assess_market_data(
    history: pd.DataFrame,
    requested_symbols: Sequence[str],
    *,
    interval: str,
    now: datetime | None = None,
    minimum_history_rows: int = 0,
    external_issues: Sequence[DataQualityIssue] = (),
) -> DataQualityReport:
    checked = now or utc_now()
    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    requested = tuple(dict.fromkeys(str(symbol).upper() for symbol in requested_symbols if str(symbol).strip()))
    issues: list[DataQualityIssue] = []
    issues.extend(external_issues)
    available = symbols_in_frame(history)
    rows = int(len(history.index)) if isinstance(history, pd.DataFrame) else 0

    if history.empty:
        issues.append(DataQualityIssue("EMPTY_DATA", "critical", "No market-data rows were returned."))
        return DataQualityReport(
            state=DataHealthState.OFFLINE,
            score=0,
            checked_at=checked.isoformat(),
            newest_source_at=None,
            age_seconds=None,
            rows=0,
            requested_symbols=requested,
            available_symbols=(),
            issues=tuple(issues),
            analysis_status=AnalysisDataStatus.DATA_INSUFFICIENT,
        )

    if minimum_history_rows > 0 and rows < minimum_history_rows:
        issues.append(DataQualityIssue(
            "INSUFFICIENT_HISTORY",
            "critical",
            f"Only {rows} rows are available; at least {minimum_history_rows} are required.",
            count=max(0, minimum_history_rows - rows),
        ))

    missing_symbols = [symbol for symbol in requested if field_for_symbol(history, symbol, "Close").dropna().empty]
    if missing_symbols:
        issues.append(DataQualityIssue(
            "MISSING_SYMBOLS",
            "error",
            f"Missing usable close data for {len(missing_symbols)} requested symbol(s).",
            count=len(missing_symbols),
        ))

    if history.index.has_duplicates:
        duplicate_count = int(history.index.duplicated().sum())
        issues.append(DataQualityIssue("DUPLICATE_TIMESTAMPS", "error", "Duplicate market-data timestamps detected.", count=duplicate_count))
    if isinstance(history.index, pd.DatetimeIndex) and not history.index.is_monotonic_increasing:
        issues.append(DataQualityIssue("OUT_OF_ORDER_TIMESTAMPS", "error", "Market-data timestamps are not ordered."))

    for symbol in requested:
        values = {name: field_for_symbol(history, symbol, name) for name in ("Open", "High", "Low", "Close", "Volume")}
        missing_fields = [name for name, series in values.items() if series.dropna().empty]
        if missing_fields:
            issues.append(DataQualityIssue(
                "MISSING_FIELDS",
                "error",
                f"Missing fields: {', '.join(missing_fields)}.",
                symbol=symbol,
                count=len(missing_fields),
            ))
            continue
        # Multi-symbol providers can timestamp indexes and exchange products at
        # different times on the same market date. Rows belonging only to
        # another symbol are not missing candles for this symbol.
        price_frame = pd.concat([values[name].rename(name) for name in ("Open", "High", "Low", "Close")], axis=1).dropna(how="all")
        negative_price_count = int((price_frame <= 0).any(axis=1).sum())
        negative_volume_count = int((values["Volume"] < 0).sum())
        zero_volume_count = 0 if symbol.startswith("^") else int((values["Volume"] == 0).sum())
        impossible_count = int(((price_frame["High"] < price_frame[["Open", "Low", "Close"]].max(axis=1)) | (price_frame["Low"] > price_frame[["Open", "High", "Close"]].min(axis=1))).sum())
        missing_value_count = int(price_frame.isna().any(axis=1).sum())
        extreme_move_count = int((price_frame["Close"].pct_change(fill_method=None).abs() > 0.65).sum())
        if negative_price_count:
            issues.append(DataQualityIssue("NON_POSITIVE_PRICE", "critical", "Non-positive OHLC values detected.", symbol=symbol, count=negative_price_count))
        if negative_volume_count:
            issues.append(DataQualityIssue("NEGATIVE_VOLUME", "critical", "Negative volume values detected.", symbol=symbol, count=negative_volume_count))
        if zero_volume_count:
            issues.append(DataQualityIssue("ZERO_VOLUME", "warning", "Zero-volume candle(s) detected.", symbol=symbol, count=zero_volume_count))
        if impossible_count:
            issues.append(DataQualityIssue("IMPOSSIBLE_OHLC", "critical", "OHLC relationships are internally inconsistent.", symbol=symbol, count=impossible_count))
        if missing_value_count:
            issues.append(DataQualityIssue("MISSING_VALUES", "warning", "Rows with missing OHLC values detected.", symbol=symbol, count=missing_value_count))
        if extreme_move_count:
            issues.append(DataQualityIssue(
                "EXTREME_PRICE_MOVE",
                "warning",
                "Extreme close-to-close move detected; verify a split, corporate action, or bad tick before scoring.",
                symbol=symbol,
                count=extreme_move_count,
            ))
        if interval_seconds(interval) >= 86_400:
            missing_sessions = missing_daily_sessions(values["Close"])
            if missing_sessions:
                issues.append(DataQualityIssue(
                    "MISSING_TRADING_SESSIONS",
                    "error",
                    f"Missing {len(missing_sessions)} expected NYSE daily candle(s); holidays and weekends were excluded.",
                    symbol=symbol,
                    count=len(missing_sessions),
                ))

    newest = _newest_timestamp(history)
    age_seconds: float | None = None
    if newest is None:
        issues.append(DataQualityIssue("MISSING_SOURCE_TIMESTAMP", "error", "No trustworthy source timestamp is available."))
    else:
        age_seconds = max(0.0, (checked.astimezone(timezone.utc) - newest.astimezone(timezone.utc)).total_seconds())
        newest_market_day = _market_date(newest, daily=interval_seconds(interval) >= 86_400)
        daily_stale = (
            interval_seconds(interval) >= 86_400
            and newest_market_day is not None
            and newest_market_day < _latest_completed_trading_day(checked)
        )
        if daily_stale or (interval_seconds(interval) < 86_400 and age_seconds > stale_after_seconds(interval, checked)):
            issues.append(DataQualityIssue("STALE_DATA", "critical", "Newest market-data timestamp is outside the allowed freshness window."))
        if newest > checked.astimezone(timezone.utc) and (newest - checked.astimezone(timezone.utc)).total_seconds() > 60:
            issues.append(DataQualityIssue("FUTURE_TIMESTAMP", "critical", "Market-data timestamp is unexpectedly in the future."))

    penalties = {"warning": 5, "error": 15, "critical": 30}
    # A broad scan can contain the same limited defect on several context
    # symbols. Charge each issue type once at the batch level so five sector
    # ETFs with a missing candle do not falsely reduce otherwise usable
    # candidate data to zero. Symbol-level issues remain attached and are
    # consumed by each symbol snapshot and its confidence/red-flag gates.
    penalty_by_code: dict[str, int] = {}
    for issue in issues:
        penalty_by_code[issue.code] = max(penalty_by_code.get(issue.code, 0), penalties.get(issue.severity, 10))
    score = max(0, 100 - sum(penalty_by_code.values()))
    codes = {issue.code for issue in issues}
    if "PROVIDER_PRICE_CONFLICT" in codes:
        state = DataHealthState.DEGRADED
        analysis_status = AnalysisDataStatus.DATA_CONFLICT
    elif "STALE_DATA" in codes or "FUTURE_TIMESTAMP" in codes:
        state = DataHealthState.STALE
        analysis_status = AnalysisDataStatus.DATA_STALE
    elif "EMPTY_DATA" in codes or "INSUFFICIENT_HISTORY" in codes:
        state = DataHealthState.OFFLINE
        analysis_status = AnalysisDataStatus.DATA_INSUFFICIENT
    elif "MISSING_SYMBOLS" in codes or "MISSING_FIELDS" in codes or "PROVIDER_VALIDATION_UNAVAILABLE" in codes:
        state = DataHealthState.PARTIAL
        analysis_status = AnalysisDataStatus.DATA_PARTIAL
    elif score >= 90:
        state = DataHealthState.HEALTHY
        analysis_status = AnalysisDataStatus.DATA_OK
    elif score >= 55:
        state = DataHealthState.DEGRADED
        analysis_status = AnalysisDataStatus.DATA_PARTIAL
    else:
        state = DataHealthState.OFFLINE
        analysis_status = AnalysisDataStatus.DATA_INSUFFICIENT
    return DataQualityReport(
        state=state,
        score=score,
        checked_at=checked.isoformat(),
        newest_source_at=iso_utc(newest),
        age_seconds=age_seconds,
        rows=rows,
        requested_symbols=requested,
        available_symbols=available,
        issues=tuple(issues),
        analysis_status=analysis_status,
    )


def build_provenance(
    *,
    provider: str,
    history: pd.DataFrame,
    symbols: Sequence[str],
    period: str,
    interval: str,
    received_at: datetime,
    latency_ms: int | None,
    fallback_from: Sequence[str] = (),
    errors: Sequence[str] = (),
    endpoint: str | None = None,
    feed_type: str = "REST",
    is_realtime: bool = False,
    quality: DataQualityReport | None = None,
    metadata: Mapping[str, object] | None = None,
) -> DataProvenance:
    report = quality or assess_market_data(history, symbols, interval=interval, now=received_at)
    return DataProvenance(
        provider=provider,
        data_type="OHLCV_HISTORY",
        feed_type=feed_type,
        interval=interval,
        period=period,
        requested_symbols=tuple(symbols),
        received_at=received_at.isoformat(),
        processed_at=utc_now().isoformat(),
        source_timestamp=report.newest_source_at,
        latency_ms=latency_ms,
        is_realtime=is_realtime,
        is_delayed=not is_realtime,
        is_stale=report.state == DataHealthState.STALE,
        quality_score=report.score,
        health_state=report.state,
        fallback_from=tuple(fallback_from),
        errors=tuple(errors),
        endpoint=endpoint,
        metadata=dict(metadata or {}),
    )


def read_provider_health(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"version": 1, "updated_at": None, "providers": {}}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {"version": 1, "updated_at": None, "providers": {}}
    return payload if isinstance(payload, dict) else {"version": 1, "updated_at": None, "providers": {}}


def record_provider_attempt(path: Path, attempt: ProviderAttempt) -> None:
    payload = read_provider_health(path)
    providers = payload.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        payload["providers"] = providers
    prior = providers.get(attempt.provider, {})
    if not isinstance(prior, dict):
        prior = {}
    successes = int(prior.get("successes", 0) or 0) + (1 if attempt.status == "success" else 0)
    failures = int(prior.get("failures", 0) or 0) + (1 if attempt.status != "success" else 0)
    total = successes + failures
    providers[attempt.provider] = {
        "provider": attempt.provider,
        "status": "HEALTHY" if attempt.status == "success" else "DEGRADED",
        "last_status": attempt.status,
        "last_checked_at": attempt.completed_at,
        "last_success_at": attempt.completed_at if attempt.status == "success" else prior.get("last_success_at"),
        "last_failure_at": attempt.completed_at if attempt.status != "success" else prior.get("last_failure_at"),
        "last_latency_ms": attempt.latency_ms,
        "successes": successes,
        "failures": failures,
        "success_rate": round(successes / total, 4) if total else 0.0,
        "last_error": attempt.error,
        "data_type": attempt.data_type,
        "interval": attempt.interval,
        "requested_symbols": list(attempt.requested_symbols),
        "returned_symbols": list(attempt.returned_symbols),
    }
    payload["version"] = 1
    payload["updated_at"] = attempt.completed_at
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)
