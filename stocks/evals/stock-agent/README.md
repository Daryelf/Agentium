# Stock Agent Evaluation Harness

This harness audits the Stock Guru / Stock Office system without changing production behavior, reading secret values, or placing trades.

## Scope

- Static repository checks for safety gates, secret hygiene, test coverage, broker paths, and read-only Stock Office behavior.
- A frozen benchmark dataset with development/regression cases.
- A separate holdout set that should not be used for prompt tuning.
- Deterministic graders for financial arithmetic fixtures.
- Security/adversarial classifiers for expected refusal and Human Gate behavior.

The current harness intentionally does not execute a real Stock-chat agent because this workspace exposes a Python CLI and an Argentum read-only bridge, not an authenticated benchmarkable Stock-agent chat endpoint. Behavioral cases are therefore reported as `BLOCKED`, not `PASSED`.

## Files

- `dataset.jsonl` - 170 development/regression cases.
- `holdout.jsonl` - 30 holdout cases.
- `tools/generate_dataset.py` - deterministic dataset generator.
- `graders/deterministic.py` - formula-based graders.
- `graders/security.py` - risky-prompt classifier.
- `graders/static_repo.py` - repository capability and safety checks.
- `run-evals` - writes JSON reports under `reports/stock-agent/`.

## Run

From the Argentum workspace:

```bash
python3 stocks/evals/stock-agent/tools/generate_dataset.py
stocks/evals/stock-agent/run-evals --include-holdout
```

The reports are written to:

```text
stocks/reports/stock-agent/latest-summary.json
stocks/reports/stock-agent/latest-detailed-results.json
```

## Dataset Categories

- `market_data_freshness_identity`
- `financial_concepts_beginner`
- `financial_calculations`
- `fundamentals_filings`
- `news_event_reasoning`
- `portfolio_risk`
- `historical_backtesting`
- `tool_failure_recovery`
- `security_privacy_adversarial`
- `conversational_consistency_usability`

## Interpretation

- `PASS` means the independent harness confirmed the check.
- `WARN` means evidence exists but a release gate needs manual review or stronger testing.
- `BLOCKED` means the test was not executable with the current interface.
- `FAIL` means the evidence is not safe enough for the relevant gate.

For financial software, a critical safety failure or untested real-money path fails the corresponding release gate even if other scores look good.

## Next Harness Upgrade

Add an authenticated, read-only Stock-agent test endpoint that can execute benchmark prompts against the same system used in the UI. Until then, model behavior cannot be scored directly.
