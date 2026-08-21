from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import time
from typing import Callable, Mapping, Sequence

from ..config import CACHE_TELEMETRY_PATH, DATA_DIR, PROVIDER_BUDGET_PATH, PROVIDER_HEALTH_PATH, REPORT_DIR, ROOT, RUNTIME_ROOT
from ..market_calendar import EASTERN, MarketClock, MarketSession, market_clock


OPERATIONS_DB_PATH = DATA_DIR / "quant_operations.sqlite3"
OPERATIONS_HEARTBEAT_PATH = DATA_DIR / "quant_operations_heartbeat.json"
OPERATIONS_HEALTH_PATH = DATA_DIR / "quant_operations_health.json"
OPERATIONS_HEALTH_HISTORY_DIR = DATA_DIR / "quant_health_history"
OPERATIONS_LOG_PATH = DATA_DIR / "quant_operations.jsonl"
APP_SCHEDULER_STATUS_PATH = RUNTIME_ROOT.parent / "stock-intelligence-scheduler.json"
REDACT_PATTERN = re.compile(
    r"(?i)\b(api[_-]?key|secret|token|password|authorization|bearer)\b\s*[:=]\s*[^\s,;]+"
)


class OperatingMode(str, Enum):
    OBSERVE = "OBSERVE"
    PAPER = "PAPER"
    LIVE = "LIVE"


@dataclass(frozen=True)
class JobSpec:
    name: str
    cadence_minutes: int
    command: tuple[str, ...]
    sessions: tuple[MarketSession, ...]
    timeout_seconds: int = 900


@dataclass(frozen=True)
class JobRecord:
    id: int
    idempotency_key: str
    name: str
    session: str
    market_date: str
    command: tuple[str, ...]
    timeout_seconds: int
    attempts: int


@dataclass(frozen=True)
class CommandResult:
    ok: bool
    exit_code: int | None
    duration_ms: int
    output: str
    error: str | None = None


DEFAULT_JOB_SPECS: tuple[JobSpec, ...] = (
    JobSpec(
        "market_scan",
        3,
        (
            "evaluate",
            "--cache-first-history",
            "--history-cache-hours",
            "6",
            "--max-symbols",
            "200",
            "--rotate-count",
            "200",
        ),
        (MarketSession.REGULAR,),
    ),
    JobSpec("market_scan", 5, ("evaluate", "--cache-first-history", "--history-cache-hours", "6"), (MarketSession.PRE_MARKET,)),
    JobSpec("market_scan", 15, ("evaluate", "--cache-first-history", "--history-cache-hours", "12"), (MarketSession.AFTER_HOURS,)),
    JobSpec("deep_scan", 30, ("evaluate", "--cache-first-history", "--history-cache-hours", "36"), (MarketSession.OVERNIGHT,)),
    JobSpec("weekend_scan", 240, ("evaluate", "--cache-first-history", "--history-cache-hours", "36"), (MarketSession.WEEKEND_HOLIDAY,)),
    JobSpec("company_research", 30, ("research",), (MarketSession.PRE_MARKET,)),
    JobSpec("company_research", 60, ("research",), (MarketSession.AFTER_HOURS,)),
    JobSpec("company_research", 180, ("research",), (MarketSession.OVERNIGHT,)),
    JobSpec("company_research", 240, ("research",), (MarketSession.WEEKEND_HOLIDAY,)),
    JobSpec("provider_health", 30, ("doctor",), (MarketSession.PRE_MARKET, MarketSession.REGULAR)),
    JobSpec("provider_health", 240, ("doctor",), (MarketSession.AFTER_HOURS, MarketSession.OVERNIGHT, MarketSession.WEEKEND_HOLIDAY)),
    JobSpec(
        "quant_backtest",
        1440,
        ("quant-backtest", "--period", "5y", "--step-sessions", "20", "--minimum-sample", "30"),
        (MarketSession.OVERNIGHT, MarketSession.WEEKEND_HOLIDAY),
        timeout_seconds=1800,
    ),
    JobSpec("paper_performance", 10080, ("performance-audit",), (MarketSession.WEEKEND_HOLIDAY,)),
)


def requested_operating_mode(environment: Mapping[str, str] | None = None) -> OperatingMode:
    values = environment if environment is not None else os.environ
    requested = str(values.get("STOCK_GURU_OPERATING_MODE", "OBSERVE") or "OBSERVE").strip().upper()
    if requested == OperatingMode.PAPER.value:
        return OperatingMode.PAPER
    # The quant daemon deliberately has no broker or approval tools. Even a
    # configured LIVE request remains OBSERVE here; the existing Human Gate is
    # the only component allowed to authorize an exact order.
    return OperatingMode.OBSERVE


def scheduled_specs(clock: MarketClock, specs: Sequence[JobSpec] = DEFAULT_JOB_SPECS) -> tuple[JobSpec, ...]:
    return tuple(spec for spec in specs if clock.session in spec.sessions)


def schedule_slot(at: datetime, cadence_minutes: int) -> int:
    local = at.astimezone(EASTERN) if at.tzinfo else at.replace(tzinfo=EASTERN)
    return (local.hour * 60 + local.minute) // max(1, cadence_minutes)


def _atomic_json(path: Path, payload: Mapping[str, object]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(dict(payload), indent=2, sort_keys=True, allow_nan=False) + "\n")
    os.replace(temporary, path)
    return path


def _read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def redact(value: object, limit: int = 4000) -> str:
    return REDACT_PATTERN.sub(lambda match: f"{match.group(1)}=[REDACTED]", str(value or "")).strip()[-limit:]


def rotate_log(path: Path = OPERATIONS_LOG_PATH, *, maximum_bytes: int = 2_000_000, keep: int = 5) -> None:
    if not path.exists() or path.stat().st_size < maximum_bytes:
        return
    for index in range(max(1, keep) - 1, 0, -1):
        source = path.with_suffix(path.suffix + f".{index}")
        target = path.with_suffix(path.suffix + f".{index + 1}")
        if source.exists():
            os.replace(source, target)
    os.replace(path, path.with_suffix(path.suffix + ".1"))


def structured_log(tag: str, message: str, *, data: Mapping[str, object] | None = None, path: Path | None = None) -> None:
    path = path or OPERATIONS_LOG_PATH
    rotate_log(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tag": tag if tag in {"QUANT", "MARKET_DATA", "RISK", "SCANNER", "SENTIMENT", "PORTFOLIO", "PROVIDER", "SCHEDULER", "WATCHDOG"} else "SCHEDULER",
        "message": redact(message, 1000),
        "data": {str(key)[:80]: redact(value, 1000) for key, value in (data or {}).items()},
    }
    with path.open("a") as handle:
        handle.write(json.dumps(record, sort_keys=True, allow_nan=False) + "\n")


class OperationsStore:
    def __init__(self, path: Path = OPERATIONS_DB_PATH) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS quant_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    session TEXT NOT NULL,
                    market_date TEXT NOT NULL,
                    command_json TEXT NOT NULL,
                    timeout_seconds INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    queued_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    duration_ms INTEGER,
                    exit_code INTEGER,
                    output TEXT,
                    error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_quant_jobs_status ON quant_jobs(status, id);
                CREATE TABLE IF NOT EXISTS quant_operations_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def recover_interrupted(self, now: datetime) -> int:
        with self._connect() as connection:
            result = connection.execute(
                "UPDATE quant_jobs SET status='queued', started_at=NULL, error='recovered after daemon restart' WHERE status='running'"
            )
            connection.execute(
                "DELETE FROM quant_jobs WHERE completed_at IS NOT NULL AND completed_at < ?",
                ((now.astimezone(timezone.utc) - timedelta(days=90)).isoformat(),),
            )
        return int(result.rowcount or 0)

    def enqueue_due(self, at: datetime, specs: Sequence[JobSpec] = DEFAULT_JOB_SPECS) -> int:
        clock = market_clock(at)
        queued_at = at.astimezone(timezone.utc).isoformat()
        inserted = 0
        with self._connect() as connection:
            for spec in scheduled_specs(clock, specs):
                key = f"{clock.market_date}:{clock.session.value}:{spec.name}:{schedule_slot(at, spec.cadence_minutes)}"
                result = connection.execute(
                    """INSERT OR IGNORE INTO quant_jobs
                    (idempotency_key, name, session, market_date, command_json, timeout_seconds, status, queued_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)""",
                    (key, spec.name, clock.session.value, clock.market_date, json.dumps(spec.command), spec.timeout_seconds, queued_at),
                )
                inserted += int(result.rowcount or 0)
        return inserted

    def claim_next(self, now: datetime) -> JobRecord | None:
        stamp = now.astimezone(timezone.utc).isoformat()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM quant_jobs WHERE status='queued' ORDER BY id LIMIT 1"
            ).fetchone()
            if row is None:
                connection.commit()
                return None
            connection.execute(
                "UPDATE quant_jobs SET status='running', attempts=attempts+1, started_at=? WHERE id=? AND status='queued'",
                (stamp, row["id"]),
            )
            connection.commit()
            return JobRecord(
                id=int(row["id"]),
                idempotency_key=str(row["idempotency_key"]),
                name=str(row["name"]),
                session=str(row["session"]),
                market_date=str(row["market_date"]),
                command=tuple(json.loads(row["command_json"])),
                timeout_seconds=int(row["timeout_seconds"]),
                attempts=int(row["attempts"]) + 1,
            )
        finally:
            connection.close()

    def complete(self, job: JobRecord, result: CommandResult, now: datetime) -> None:
        status = "success" if result.ok else "failed"
        with self._connect() as connection:
            connection.execute(
                """UPDATE quant_jobs SET status=?, completed_at=?, duration_ms=?, exit_code=?, output=?, error=?
                WHERE id=? AND status='running'""",
                (
                    status,
                    now.astimezone(timezone.utc).isoformat(),
                    result.duration_ms,
                    result.exit_code,
                    redact(result.output),
                    redact(result.error, 1000) if result.error else None,
                    job.id,
                ),
            )

    def counts(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute("SELECT status, COUNT(*) AS count FROM quant_jobs GROUP BY status").fetchall()
        return {str(row["status"]): int(row["count"]) for row in rows}

    def recent_failures(self, limit: int = 10) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT name, session, completed_at, error FROM quant_jobs WHERE status='failed' ORDER BY id DESC LIMIT ?",
                (max(1, min(100, limit)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def performance(self) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT name, COUNT(*) AS runs,
                SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
                ROUND(AVG(duration_ms), 1) AS average_duration_ms,
                MAX(duration_ms) AS maximum_duration_ms
                FROM quant_jobs WHERE completed_at IS NOT NULL GROUP BY name ORDER BY name"""
            ).fetchall()
        return [dict(row) for row in rows]

    def meta(self, key: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute("SELECT value FROM quant_operations_meta WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else None

    def set_meta(self, key: str, value: str, now: datetime) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO quant_operations_meta(key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
                (key, value, now.astimezone(timezone.utc).isoformat()),
            )

    def record_daemon_start(self, now: datetime) -> int:
        cutoff = now.astimezone(timezone.utc) - timedelta(minutes=30)
        try:
            prior = json.loads(self.meta("daemon_starts") or "[]")
        except Exception:
            prior = []
        starts: list[str] = []
        for value in prior if isinstance(prior, list) else []:
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            if parsed.astimezone(timezone.utc) >= cutoff:
                starts.append(parsed.astimezone(timezone.utc).isoformat())
        starts.append(now.astimezone(timezone.utc).isoformat())
        self.set_meta("daemon_starts", json.dumps(starts[-20:]), now)
        return len(starts)


def run_stock_guru_command(job: JobRecord, *, root: Path = ROOT) -> CommandResult:
    executable = root / "bin" / "stock-guru"
    started = time.monotonic()
    try:
        completed = subprocess.run(
            [str(executable), *job.command],
            cwd=root,
            env={**os.environ, "STOCK_GURU_OPERATING_MODE": requested_operating_mode().value},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=job.timeout_seconds,
            check=False,
        )
        return CommandResult(
            ok=completed.returncode == 0,
            exit_code=completed.returncode,
            duration_ms=round((time.monotonic() - started) * 1000),
            output=redact(completed.stdout),
            error=None if completed.returncode == 0 else f"command exited {completed.returncode}",
        )
    except subprocess.TimeoutExpired as error:
        return CommandResult(False, None, round((time.monotonic() - started) * 1000), redact(error.stdout), "command timed out")
    except Exception as error:
        return CommandResult(False, None, round((time.monotonic() - started) * 1000), "", f"{type(error).__name__}: {error}")


def write_operations_heartbeat(
    *,
    at: datetime,
    clock: MarketClock,
    store: OperationsStore,
    mode: OperatingMode,
    active_job: JobRecord | None,
    last_result: CommandResult | None,
    restart_count_30m: int = 0,
    path: Path | None = None,
) -> Path:
    path = path or OPERATIONS_HEARTBEAT_PATH
    payload = {
        "version": 1,
        "updated_at": at.astimezone(timezone.utc).isoformat(),
        "market_clock": asdict(clock),
        "mode": mode.value,
        "broker_authority": False,
        "human_gate_required_for_every_live_order": True,
        "queue": store.counts(),
        "restart_count_30m": restart_count_30m,
        "active_job": asdict(active_job) if active_job else None,
        "last_result": asdict(last_result) if last_result else None,
    }
    return _atomic_json(path, payload)


def write_daily_health_report(
    *,
    at: datetime,
    clock: MarketClock,
    store: OperationsStore,
    mode: OperatingMode,
    restart_count_30m: int = 0,
    path: Path | None = None,
    history_dir: Path | None = None,
) -> tuple[Path, Path]:
    path = path or OPERATIONS_HEALTH_PATH
    history_dir = history_dir or OPERATIONS_HEALTH_HISTORY_DIR
    provider_budgets = _read_json(PROVIDER_BUDGET_PATH)
    provider_health = _read_json(PROVIDER_HEALTH_PATH)
    cache = _read_json(CACHE_TELEMETRY_PATH)
    counts = store.counts()
    failures = store.recent_failures()
    try:
        raw_evaluations = json.loads((REPORT_DIR / "evaluations.json").read_text())
    except Exception:
        raw_evaluations = []
    evaluations = raw_evaluations if isinstance(raw_evaluations, list) else []
    decision_counts: dict[str, int] = {}
    for item in evaluations:
        if not isinstance(item, dict):
            continue
        decision = str(item.get("decision") or "UNKNOWN")
        decision_counts[decision] = decision_counts.get(decision, 0) + 1
    status = "DEGRADED" if failures[-3:] or restart_count_30m >= 3 else "HEALTHY"
    payload = {
        "version": 1,
        "generated_at": at.astimezone(timezone.utc).isoformat(),
        "market_clock": asdict(clock),
        "mode": mode.value,
        "status": status,
        "execution": {"broker_authority": False, "human_gate_required": True},
        "jobs": counts,
        "job_performance": store.performance(),
        "restart_count_30m": restart_count_30m,
        "provider_budgets": provider_budgets,
        "provider_health": provider_health,
        "cache": cache,
        "scanner": {"symbols_scanned": len(evaluations), "decisions": decision_counts},
        "recent_failures": failures,
    }
    latest = _atomic_json(path, payload)
    dated = _atomic_json(history_dir / f"{clock.market_date}.json", payload)
    return latest, dated


def sunday_restart_due(at: datetime, store: OperationsStore) -> bool:
    local = at.astimezone(EASTERN) if at.tzinfo else at.replace(tzinfo=EASTERN)
    if local.weekday() != 6 or not (local.hour == 3 and 30 <= local.minute < 40):
        return False
    week = f"{local.isocalendar()[0]}-W{local.isocalendar()[1]:02d}"
    if store.meta("last_sunday_restart") == week:
        return False
    store.set_meta("last_sunday_restart", week, at)
    return True


def app_scheduler_active(at: datetime, path: Path = APP_SCHEDULER_STATUS_PATH) -> bool:
    payload = _read_json(path)
    if not payload or not path.exists():
        return False
    try:
        age_seconds = max(0.0, at.astimezone(timezone.utc).timestamp() - path.stat().st_mtime)
    except OSError:
        return False
    if age_seconds > 7200:
        return False
    if payload.get("running") is True:
        return True
    next_run = payload.get("nextRunAt")
    if not next_run:
        return False
    try:
        parsed = datetime.fromisoformat(str(next_run).replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc) > at.astimezone(timezone.utc)


class QuantOperationsDaemon:
    def __init__(
        self,
        *,
        store: OperationsStore | None = None,
        mode: OperatingMode | None = None,
        specs: Sequence[JobSpec] = DEFAULT_JOB_SPECS,
        command_runner: Callable[[JobRecord], CommandResult] = run_stock_guru_command,
        now_fn: Callable[[], datetime] | None = None,
        app_scheduler_status_path: Path = APP_SCHEDULER_STATUS_PATH,
    ) -> None:
        self.store = store or OperationsStore()
        self.mode = mode or requested_operating_mode()
        self.specs = tuple(specs)
        self.command_runner = command_runner
        self.now_fn = now_fn or (lambda: datetime.now(EASTERN))
        self.app_scheduler_status_path = app_scheduler_status_path
        self.started_at = self.now_fn()
        recovered = self.store.recover_interrupted(self.started_at)
        self.restart_count_30m = self.store.record_daemon_start(self.started_at)
        if recovered:
            structured_log("WATCHDOG", "Recovered interrupted quant jobs after restart.", data={"count": recovered})
        if self.restart_count_30m >= 3:
            structured_log("WATCHDOG", "Quant daemon restarted repeatedly within 30 minutes.", data={"count": self.restart_count_30m})

    def cycle(self) -> CommandResult | None:
        at = self.now_fn()
        clock = market_clock(at)
        if app_scheduler_active(at, self.app_scheduler_status_path):
            write_operations_heartbeat(at=at, clock=clock, store=self.store, mode=self.mode, active_job=None, last_result=None, restart_count_30m=self.restart_count_30m)
            write_daily_health_report(at=at, clock=clock, store=self.store, mode=self.mode, restart_count_30m=self.restart_count_30m)
            return None
        inserted = self.store.enqueue_due(at, self.specs)
        if inserted:
            structured_log("SCHEDULER", "Queued idempotent market-state jobs.", data={"session": clock.session.value, "count": inserted})
        job = self.store.claim_next(at)
        write_operations_heartbeat(at=at, clock=clock, store=self.store, mode=self.mode, active_job=job, last_result=None, restart_count_30m=self.restart_count_30m)
        result = None
        if job:
            structured_log("SCANNER", "Starting scheduled quant job.", data={"job": job.name, "session": job.session})
            result = self.command_runner(job)
            finished = self.now_fn()
            self.store.complete(job, result, finished)
            structured_log(
                "SCANNER" if result.ok else "WATCHDOG",
                "Scheduled quant job completed." if result.ok else "Scheduled quant job failed safely.",
                data={"job": job.name, "duration_ms": result.duration_ms, "exit_code": result.exit_code},
            )
            at = finished
            clock = market_clock(at)
        write_operations_heartbeat(at=at, clock=clock, store=self.store, mode=self.mode, active_job=None, last_result=result, restart_count_30m=self.restart_count_30m)
        write_daily_health_report(at=at, clock=clock, store=self.store, mode=self.mode, restart_count_30m=self.restart_count_30m)
        return result


def run_daemon(*, poll_seconds: float = 15.0) -> int:
    daemon = QuantOperationsDaemon()
    stopping = False

    def stop(_signum, _frame) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    structured_log("SCHEDULER", "Quant operations daemon started.", data={"mode": daemon.mode.value})
    while not stopping:
        at = daemon.now_fn()
        if sunday_restart_due(at, daemon.store):
            structured_log("WATCHDOG", "Starting scheduled Sunday self-restart.")
            return 75
        try:
            daemon.cycle()
        except Exception as error:
            structured_log("WATCHDOG", "Daemon cycle failed safely.", data={"error": f"{type(error).__name__}: {error}"})
        time.sleep(max(1.0, min(60.0, poll_seconds)))
    structured_log("SCHEDULER", "Quant operations daemon stopped cleanly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_daemon())
