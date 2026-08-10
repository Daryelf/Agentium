const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  answerStockQuestion,
  getMirrorCandidate,
  getStockRecord,
  listStockRecords,
  loadStockOfficeSnapshot,
  safeJoin,
  stockOverview,
} = require("../services/stock-office");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-office-"));
  const stockRoot = path.join(root, "stocks");
  writeJson(path.join(stockRoot, "reports/evaluations.json"), [
    {
      ticker: "BAC",
      decision: "VALID_BUY_SETUP",
      score: 75,
      current_price: 40.12,
      setup_type: "Breakout pullback",
      entry_zone: "39.80-40.20",
      stop_loss: 38.9,
      target_1: 42,
      target_2: 44,
      main_risk: "Needs operator review because market data can stale quickly.",
      data_fresh: true,
      liquidity_passed: true,
      spread_passed: true,
      trend_confirmation: true,
      volume_confirmation: true,
    },
    {
      ticker: "XYZ",
      decision: "REJECT",
      score: 12,
      rejection_reason: "Liquidity failed.",
      data_fresh: false,
    },
  ]);
  writeText(path.join(stockRoot, "config/universe.txt"), "BAC\nMSFT\nNVDA\n");
  writeJson(path.join(stockRoot, "config/settings.json"), { mode: "paper" });
  writeJson(path.join(stockRoot, "config/copy_trader.json"), {
    execution_mode: "paper_and_human_gate_only",
    max_trade_dollars: 5,
  });
  writeJson(path.join(stockRoot, "config/copy_trader_watchlist.json"), {
    version: 1,
    sec_form4: [{ cik: "0000000123", label: "Example insider", enabled: true }],
  });
  writeJson(path.join(stockRoot, "data/copy_import_status.json"), {
    version: 1,
    generated_at: "2026-06-19T11:40:00Z",
    source: "official SEC EDGAR submissions and filing documents",
    watchlist_entries: 1,
    enabled_entries: 1,
    filings_scanned: 1,
    signals_imported: 1,
    signals_retained: 1,
    live_orders_placed: 0,
    warnings: [],
  });
  writeJson(path.join(stockRoot, "data/sec_13f_import_status.json"), {
    version: 1,
    generated_at: "2026-06-19T11:41:00Z",
    source: "official SEC EDGAR Form 13F submissions and XML information tables",
    watchlist_entries: 4,
    enabled_entries: 4,
    filings_scanned: 8,
    signals_imported: 12,
    signals_retained: 13,
    research_only: true,
    live_orders_placed: 0,
    warnings: ["13F is delayed research only."],
  });
  writeJson(path.join(stockRoot, "data/broker_status.json"), {
    account_number: "123456789012",
    account_value: 24.99,
    cash: 0,
    buying_power: 0,
    positions: [{ symbol: "BAC", quantity: 1, average_buy_price: 39.5, current_price: 40.12 }],
    open_orders: [],
    updated_at: "2026-06-19T11:44:30Z",
    connector: {
      registered: true,
      oauth_authenticated: true,
      endpoint: "https://agent.robinhood.com/mcp/trading",
      observed_at: "2026-06-19T11:44:30Z",
      tools: [
        "get_accounts", "get_portfolio", "get_equity_positions", "get_equity_orders",
        "get_equity_quotes", "get_equity_tradability", "review_equity_order",
        "place_equity_order", "cancel_equity_order",
      ],
    },
  });
  writeJson(path.join(stockRoot, "data/live_auto_arm_plan.json"), {
    action: "NOT_ARMABLE",
    ready_for_live_auto: false,
    blockers: ["buying_power is zero"],
    warnings: ["market data needs refresh"],
  });
  writeJson(path.join(stockRoot, "data/live_auto_launch_checklist.json"), {
    ready_for_live_auto: false,
    readiness: {
      checks: [{ name: "Broker buying power", passed: false, severity: "blocker", detail: "buying_power is zero" }],
    },
  });
  writeJson(path.join(stockRoot, "data/provider_keys.json"), {
    polygon_api_key: "super-secret-provider-key-1234567890",
  });
  writeJson(path.join(stockRoot, "reports/copy_trader_plan.json"), {
    version: 1,
    generated_at: "2026-06-19T11:45:00Z",
    mode: "paper_and_human_gate_only",
    policy: {
      total_budget_dollars: 25,
      max_trade_dollars: 5,
      max_daily_notional_dollars: 10,
      max_source_allocation_pct: 0.4,
      minimum_confidence: 0.7,
      max_price_drift_pct: 0.03,
      max_signal_age_hours: 96,
      allowed_asset_types: ["equity"],
      research_only_asset_types: ["event_contract"],
    },
    sources: [
      {
        id: "sec_form4",
        name: "SEC Form 4",
        source_type: "official_disclosure",
        enabled: true,
        mirror_eligible: true,
        max_disclosure_lag_hours: 96,
      },
    ],
    summary: {
      signals_received: 1,
      paper_ready: 1,
      research_only: 0,
      rejected: 0,
      duplicate: 0,
      planned_paper_notional_dollars: 5,
      live_orders_placed: 0,
      human_gate_required_for_live: true,
    },
    candidates: [
      {
        id: "mirror-bac-form4",
        fingerprint: "a".repeat(64),
        source_id: "sec_form4",
        source_name: "SEC Form 4",
        trader_name: "Example insider",
        asset_type: "equity",
        symbol: "BAC",
        side: "BUY",
        transaction_code: "P",
        transaction_at: "2026-06-18T14:00:00Z",
        disclosed_at: "2026-06-19T10:00:00Z",
        observed_at: "2026-06-19T10:05:00Z",
        source_url: "https://www.sec.gov/Archives/edgar/data/example",
        disclosure_lag_hours: 20,
        signal_age_hours: 1.75,
        signal_price: 40,
        current_price: 40.12,
        price_drift_pct: 0.003,
        confidence: 0.95,
        evidence_score: 0.514,
        evidence_status: "small_sample",
        source_evidence_samples: 3,
        trader_evidence_samples: 2,
        ranking_score: 0.7974,
        status: "paper_ready",
        mirror_notional_dollars: 5,
        mirror_shares: 0.1246,
        human_gate_eligible: true,
        reasons: ["Passed delay and bankroll checks.", "No live broker order is available."],
      },
    ],
    warnings: ["No live order, account action, deposit, or money movement is available from this plan."],
  });
  writeJson(path.join(stockRoot, "data/copy_knowledge.json"), {
    version: 1,
    generated_at: "2026-06-19T11:46:00Z",
    methodology: {
      outcome_clock: "first real price observed at or after public disclosure",
      sample_prior_strength: 20,
      minimum_samples_for_gate: 8,
      score_neutral: 0.5,
      look_ahead_allowed: false,
      profit_guarantee: false,
    },
    summary: {
      signals_seen: 4,
      observations_seen: 9,
      measured_outcomes: 3,
      pending_outcomes: 1,
      missing_baselines: 0,
      live_orders_placed: 0,
    },
    source_profiles: [{
      profile_id: "source:sec_form4",
      source_id: "sec_form4",
      trader_name: null,
      source_type: "official_disclosure",
      mirror_eligible: true,
      sample_size: 3,
      wins: 2,
      losses: 1,
      hit_rate: 0.666667,
      mean_directional_return: 0.02,
      return_volatility: 0.03,
      average_maximum_adverse_excursion: -0.01,
      risk_adjusted_return: 0.666667,
      posterior_quality_score: 0.514,
      delay_reliability: 0.8,
      execution_score_cap: 1,
      evidence_score: 0.5112,
      evidence_status: "small_sample",
      provenance_counts: { market_snapshot: 3 },
      regime_breakdown: { bull: { sample_size: 3, hit_rate: 0.666667, mean_directional_return: 0.02 } },
    }],
    trader_profiles: [],
    signal_outcomes: [],
    warnings: ["Small samples are shrunk toward neutral."],
  });
  writeText(path.join(stockRoot, "reports/latest_ticket.md"), "- Action: PAPER_REVIEW\n- Ticker: BAC\n- Reason: Valid setup only\n");
  writeText(path.join(stockRoot, "reports/mission.md"), "Local Stock Guru mission.");
  return { root, stockRoot };
}

test("Stock Office loads local records without exposing secrets", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.sources.find((source) => source.id === "provider_keys").status, "configured");
  assert.match(snapshot.broker.account, /\*{4,}\d{4}$/);
  assert.equal(serialized.includes("super-secret-provider-key"), false);
  assert.equal(serialized.includes("123456789012"), false);
  assert.equal(snapshot.metrics.readyForLiveAuto, false);
  assert.equal(snapshot.metrics.mirrorPaperReady, 1);
  assert.equal(snapshot.mirror.summary.liveOrdersPlaced, 0);
  assert.equal(snapshot.mirror.importer.enabledEntries, 1);
  assert.equal(snapshot.mirror.importer.liveOrdersPlaced, 0);
  assert.equal(snapshot.mirror.importer13f.enabledEntries, 4);
  assert.equal(snapshot.mirror.importer13f.signalsImported, 12);
  assert.equal(snapshot.mirror.importer13f.liveOrdersPlaced, 0);
  assert.equal(snapshot.mirror.knowledge.summary.measuredOutcomes, 3);
  assert.equal(snapshot.mirror.knowledge.methodology.lookAheadAllowed, false);
  assert.equal(snapshot.mirror.candidates[0].evidenceStatus, "small_sample");
});

test("Stock Office record APIs filter and retrieve sanitized records", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const listed = listStockRecords(snapshot, { status: "valid_setup", q: "bac", pageSize: 10 });
  const record = getStockRecord(snapshot, "BAC");
  const overview = stockOverview(snapshot);

  assert.equal(listed.total, 1);
  assert.equal(listed.records[0].ticker, "BAC");
  assert.equal(record.status, "valid_setup");
  assert.equal(overview.broker.buyingPower, "$0.00");
  assert.equal(overview.readiness.blockers.length > 0, true);
  assert.equal(overview.mirror.summary.paperReady, 1);
  assert.equal(overview.mirror.importer.signalsImported, 1);
  assert.equal(getMirrorCandidate(snapshot, "mirror-bac-form4").symbol, "BAC");
});

test("Stock Office assistant answers from local data with citations", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const answer = answerStockQuestion(snapshot, "What are the top setups and blockers?");

  assert.match(answer.answer, /research support only|Live auto is not armable/i);
  assert.equal(answer.citations.length > 0, true);
  assert.equal(answer.safeMode, "read_only");
});

test("Stock Office explains public-signal copy trading without claiming execution", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const answer = answerStockQuestion(snapshot, "Can it copy famous traders and prediction-market bets?");

  assert.match(answer.answer, /paper-ready/i);
  assert.match(answer.answer, /0 live orders/i);
  assert.match(answer.answer, /event contracts.*research-only/i);
  assert.equal(answer.citations.some((citation) => citation.id === "copy_trader_plan"), true);
  assert.equal(answer.citations.some((citation) => citation.id === "copy_knowledge"), true);
  assert.match(answer.answer, /small samples are shrunk toward neutral/i);
});

test("safeJoin blocks path traversal outside Stock Guru workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-safejoin-"));
  assert.throws(() => safeJoin(root, "../outside.json"), /escaped/);
  assert.equal(safeJoin(root, "reports/evaluations.json").startsWith(root), true);
});

test("missing optional Stock Office sources stay missing instead of becoming read errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-office-missing-"));
  fs.mkdirSync(path.join(root, "stocks"), { recursive: true });
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-08-10T12:00:00.000Z" });

  assert.equal(snapshot.sourceHealth.error, 0);
  assert.equal(snapshot.sourceHealth.missing > 0, true);
  assert.equal(snapshot.sources.every((source) => source.status === "missing"), true);
});

test("approved local guardrail overrides survive normalization and replace inert file defaults", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({
    rootDir: root,
    now: "2026-06-19T12:00:00.000Z",
    state: {
      stockOffice: {
        activeGuardrails: {
          principalDollars: 250,
          maxTotalDollars: 125,
          maxOrderDollars: 25,
          minOrderDollars: 1,
          cashReserveDollars: 50,
          dailyLossLimitPct: 0.015,
          riskPerTradePct: 0.005,
          maxPositions: 5,
          maxTradesPerDay: 2,
          minEntryScore: 90,
        },
        guardrailsAppliedAt: "2026-06-19T11:59:00.000Z",
        guardrailsApprovalId: "approval-limits",
      },
    },
  });

  assert.equal(snapshot.guardrails.principalDollars, 250);
  assert.equal(snapshot.guardrails.maxTotalDollars, 125);
  assert.equal(snapshot.guardrails.riskPerTradePct, 0.005);
  assert.equal(snapshot.guardrails.maxTradesPerDay, 2);
  assert.equal(snapshot.guardrailsSource.type, "human_gate_override");
  assert.equal(snapshot.guardrailsSource.approvalId, "approval-limits");
  assert.equal(stockOverview(snapshot).guardrailsSource.type, "human_gate_override");
});
