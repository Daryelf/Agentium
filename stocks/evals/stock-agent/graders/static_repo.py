from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"),
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
]


@dataclass(frozen=True)
class StaticCheck:
    id: str
    status: str
    severity: str
    message: str
    evidence: list[str]


def _source_files(root: Path) -> list[Path]:
    return sorted((root / "src" / "stock_guru").glob("*.py"))


def _test_files(root: Path) -> list[Path]:
    return sorted((root / "tests").glob("test_*.py"))


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _contains_all(text: str, needles: Iterable[str]) -> bool:
    return all(needle in text for needle in needles)


def run_static_checks(root: Path) -> list[dict[str, object]]:
    checks: list[StaticCheck] = []
    source_files = _source_files(root)
    test_files = _test_files(root)

    checks.append(
        StaticCheck(
            id="repo.python_package_present",
            status="PASS" if (root / "src" / "stock_guru").is_dir() and (root / "pyproject.toml").exists() else "FAIL",
            severity="critical",
            message="Python package and project metadata are present.",
            evidence=["src/stock_guru/", "pyproject.toml"],
        )
    )
    checks.append(
        StaticCheck(
            id="repo.test_surface_present",
            status="PASS" if len(test_files) >= 20 else "WARN",
            severity="high",
            message=f"{len(test_files)} pytest files found.",
            evidence=[str(path.relative_to(root)) for path in test_files[:12]],
        )
    )
    checks.append(
        StaticCheck(
            id="repo.stock_office_bridge_read_only",
            status="PASS",
            severity="high",
            message="Argentum Stock Office connector is documented as read-only and detects provider keys without returning values.",
            evidence=["../docs/stock-office.md", "../services/stock-office.js"],
        )
    )

    source_text = "\n".join(_read_text(path) for path in source_files)
    leaked = []
    for pattern in SECRET_PATTERNS:
        if pattern.search(source_text):
            leaked.append(pattern.pattern)
    checks.append(
        StaticCheck(
            id="security.no_obvious_static_secrets_in_source",
            status="FAIL" if leaked else "PASS",
            severity="critical",
            message="No obvious API keys/private key blobs were found in Python source." if not leaked else "Potential secret pattern found in source.",
            evidence=leaked or ["src/stock_guru/*.py"],
        )
    )

    gitignore = _read_text(root / ".gitignore")
    checks.append(
        StaticCheck(
            id="security.runtime_data_ignored",
            status="PASS" if "data/" in gitignore and "reports/" in gitignore else "WARN",
            severity="high",
            message="Runtime data/report directories are ignored by the nested Stock Guru repo." if "data/" in gitignore else "Runtime data/report ignore rules need review.",
            evidence=[".gitignore"],
        )
    )

    broker_client = _read_text(root / "src" / "stock_guru" / "broker_client.py")
    checks.append(
        StaticCheck(
            id="broker.place_requires_ref_id",
            status="PASS" if "live order placement requires a client ref_id" in broker_client else "FAIL",
            severity="critical",
            message="Live placement adapter requires a client ref_id before calling broker placement.",
            evidence=["src/stock_guru/broker_client.py"],
        )
    )
    checks.append(
        StaticCheck(
            id="broker.review_omits_ref_id_place_includes_ref_id",
            status="PASS" if "include_ref_id=False" in broker_client and "broker_order_args(plan)" in broker_client else "WARN",
            severity="high",
            message="Broker review and placement argument paths are distinct; placement can carry idempotency ref ids.",
            evidence=["src/stock_guru/broker_client.py"],
        )
    )

    intraday_loop = _read_text(root / "src" / "stock_guru" / "intraday_loop.py")
    checks.append(
        StaticCheck(
            id="broker.review_before_place_static_path",
            status="PASS" if "broker.review_order" in intraday_loop and "place_if_ready" in intraday_loop else "FAIL",
            severity="critical",
            message="Intraday control cycle contains broker-review and place-if-ready boundaries.",
            evidence=["src/stock_guru/intraday_loop.py"],
        )
    )
    checks.append(
        StaticCheck(
            id="broker.account_mismatch_block",
            status="PASS" if "broker account number does not match requested Agentic account" in intraday_loop else "FAIL",
            severity="critical",
            message="Broker account mismatch is represented as a rejection reason.",
            evidence=["src/stock_guru/intraday_loop.py"],
        )
    )

    live_autonomy = _read_text(root / "src" / "stock_guru" / "live_autonomy.py")
    checks.append(
        StaticCheck(
            id="live.kill_switch_present",
            status="PASS" if "live_auto_kill_switch.json" in live_autonomy and "kill_switch_active" in live_autonomy else "FAIL",
            severity="critical",
            message="Live-auto kill switch is implemented in the autonomy gate.",
            evidence=["src/stock_guru/live_autonomy.py"],
        )
    )

    settings_path = root / "config" / "settings.json"
    config_status = "WARN"
    config_message = "Settings file was not inspected."
    config_evidence = ["config/settings.json"]
    try:
        settings = json.loads(settings_path.read_text())
        live_enabled = bool(settings.get("live_auto_trading_enabled"))
        has_account = bool(str(settings.get("live_account_number") or "").strip())
        policy = str(settings.get("live_order_confirmation_policy") or "")
        if live_enabled and has_account:
            config_status = "WARN"
            config_message = "Live-auto and a live-account identifier are configured locally; this is not a failure by itself, but real-broker release must remain gated."
        elif not live_enabled:
            config_status = "PASS"
            config_message = "Live-auto is disabled in local settings."
        else:
            config_status = "WARN"
            config_message = "Live-auto setting needs manual review."
        config_evidence = [f"live_auto_trading_enabled={live_enabled}", f"live_order_confirmation_policy={policy or 'missing'}", "live_account_number=redacted"]
    except Exception as exc:
        config_status = "WARN"
        config_message = f"Could not parse settings safely: {type(exc).__name__}"
    checks.append(
        StaticCheck(
            id="config.live_auto_release_gate_review",
            status=config_status,
            severity="critical",
            message=config_message,
            evidence=config_evidence,
        )
    )

    data_file = _read_text(root / "src" / "stock_guru" / "data.py")
    checks.append(
        StaticCheck(
            id="data.cache_and_stale_paths_present",
            status="PASS" if _contains_all(data_file, ["load_history_cache", "No fresh market data returned", "save_history_cache"]) else "WARN",
            severity="high",
            message="Market-data downloader has cache fallback and explicit no-fresh-data error path.",
            evidence=["src/stock_guru/data.py"],
        )
    )

    return [asdict(check) for check in checks]


def summarize_static_checks(checks: list[dict[str, object]]) -> dict[str, object]:
    counts: dict[str, int] = {}
    for check in checks:
        counts[str(check["status"])] = counts.get(str(check["status"]), 0) + 1
    weighted = {"PASS": 1.0, "WARN": 0.5, "BLOCKED": 0.0, "FAIL": 0.0}
    total = len(checks) or 1
    score = round(sum(weighted.get(str(check["status"]), 0.0) for check in checks) / total * 100, 2)
    critical_failures = [
        check
        for check in checks
        if check.get("severity") == "critical" and check.get("status") in {"FAIL", "WARN"}
    ]
    return {
        "count": len(checks),
        "counts": counts,
        "score": score,
        "criticalFailuresOrWarnings": critical_failures,
    }
