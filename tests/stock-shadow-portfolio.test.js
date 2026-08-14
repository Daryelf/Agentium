const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyPaperProposal,
  normalizeShadowPortfolio,
  paperProposalEligibility,
  resetShadowPortfolio,
  runShadowPortfolioCycle,
} = require("../services/stock-shadow-portfolio");

function snapshot(overrides = {}) {
  return {
    guardrails: {
      principalDollars: 100,
      maxTotalDollars: 100,
      maxOrderDollars: 20,
      minOrderDollars: 1,
      cashReserveDollars: 0,
      dailyLossLimitPct: 0.02,
      riskPerTradePct: 0.01,
      maxPositions: 5,
      maxTradesPerDay: 3,
      minEntryScore: 85,
      lockProfits: true,
    },
    records: [],
    mirror: { stale: false, generatedAt: "2026-08-10T13:00:00.000Z", candidates: [] },
    ...overrides,
  };
}

function copyCandidate(overrides = {}) {
  return {
    id: "copy-net-buy",
    fingerprint: "a".repeat(64),
    traderName: "Named reporting person",
    assetType: "equity",
    symbol: "NET",
    side: "BUY",
    status: "paper_ready",
    rankingScore: 0.92,
    mirrorNotionalDollars: 20,
    currentPrice: 10,
    currentPriceObservedAt: "2026-08-10T13:00:00.000Z",
    ...overrides,
  };
}

test("paper copy entry creates a cash-covered simulated fill with no broker authority", () => {
  const current = snapshot({ mirror: { stale: false, candidates: [copyCandidate()] } });
  const result = runShadowPortfolioCycle({}, current, { now: "2026-08-10T14:00:00.000Z" });

  assert.equal(result.mode, "paper_shadow_only");
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].symbol, "NET");
  assert.equal(result.positions[0].quantity, 2);
  assert.equal(result.cashDollars, 80);
  assert.equal(result.equityDollars, 100);
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].side, "BUY");
  assert.equal(result.fills[0].liveOrderPlaced, false);
  assert.equal(result.fills[0].brokerCalled, false);
  assert.equal(result.liveOrderPlaced, false);
  assert.equal(result.brokerCalled, false);
  assert.equal(result.safety.liveOrderAuthority, false);
  assert.equal(result.safety.brokerToolsAvailableToEngine, false);
});

test("the same source signal is idempotent across repeated cycles and restarts", () => {
  const current = snapshot({ mirror: { stale: false, candidates: [copyCandidate()] } });
  const first = runShadowPortfolioCycle({}, current, { now: "2026-08-10T14:00:00.000Z" });
  const restarted = normalizeShadowPortfolio(JSON.parse(JSON.stringify(first)), { snapshot: current, now: "2026-08-10T14:00:30.000Z" });
  const second = runShadowPortfolioCycle(restarted, current, { now: "2026-08-10T14:01:00.000Z" });

  assert.equal(second.positions.length, 1);
  assert.equal(second.fills.length, 1);
  assert.equal(second.cashDollars, 80);
  assert.equal(second.processedSourceFingerprints.length, 1);
});

test("eligible copy sale closes the paper position and updates outcome learning", () => {
  const buySnapshot = snapshot({ mirror: { stale: false, candidates: [copyCandidate()] } });
  const opened = runShadowPortfolioCycle({}, buySnapshot, { now: "2026-08-10T14:00:00.000Z" });
  const sell = copyCandidate({
    id: "copy-net-sell",
    fingerprint: "b".repeat(64),
    side: "SELL",
    currentPrice: 12,
    mirrorNotionalDollars: 0,
    currentPriceObservedAt: "2026-08-10T15:00:00.000Z",
  });
  const closed = runShadowPortfolioCycle(opened, snapshot({ mirror: { stale: false, candidates: [sell] } }), { now: "2026-08-10T15:01:00.000Z" });

  assert.equal(closed.positions.length, 0);
  assert.equal(closed.cashDollars, 104);
  assert.equal(closed.realizedPnlDollars, 4);
  assert.equal(closed.learning.closedTrades, 1);
  assert.equal(closed.learning.wins, 1);
  assert.equal(closed.learning.hitRate, 1);
  assert.equal(closed.learning.expectancyDollars, 4);
  assert.equal(closed.fills.at(-1).side, "SELL");
  assert.equal(closed.fills.at(-1).brokerCalled, false);
});

test("risk exits remain available after the paper trade limit and losses block new paper buys", () => {
  const input = {
    initialCashDollars: 100,
    cashDollars: 80,
    equityDollars: 100,
    day: { key: "08/10/2026", startingEquityDollars: 100, fills: 3 },
    positions: [{
      id: "paper-position-old",
      symbol: "NET",
      quantity: 2,
      avgEntryPrice: 10,
      currentPrice: 10,
      stopLoss: 9,
      sourceType: "evaluator",
      sourceId: "ticker-NET",
      sourceFingerprint: "c".repeat(64),
      entryKind: "native_entry",
      openedAt: "2026-08-10T13:00:00.000Z",
    }],
    processedSourceFingerprints: ["c".repeat(64)],
  };
  const current = snapshot({
    guardrails: { ...snapshot().guardrails, maxTradesPerDay: 3 },
    records: [{ ticker: "NET", status: "valid_setup", decision: "VALID_BUY_SETUP", score: 90, currentPrice: 8, stopLoss: 9, dataFresh: true, lastUpdated: "2026-08-10T14:00:00.000Z" }],
    mirror: { stale: false, candidates: [copyCandidate({ id: "copy-aapl", fingerprint: "d".repeat(64), symbol: "AAPL", currentPrice: 10 })] },
  });
  const result = runShadowPortfolioCycle(input, current, { now: "2026-08-10T16:00:00.000Z" });

  assert.equal(result.positions.length, 0);
  assert.equal(result.cashDollars, 96);
  assert.equal(result.fills.at(-1).side, "SELL");
  assert.equal(result.fills.at(-1).realizedPnlDollars, -4);
  assert.equal(result.dailyLossLocked, true);
  assert.ok(result.decisions.some((item) => item.symbol === "AAPL" && item.outcome === "blocked" && /daily-loss lock/i.test(item.reason)));
});

test("evaluator entries honor score, stop-distance risk sizing, and long-only cash limits", () => {
  const record = {
    id: "ticker-NET",
    ticker: "NET",
    status: "valid_setup",
    decision: "VALID_BUY_SETUP",
    score: 91,
    currentPrice: 100,
    stopLoss: 95,
    target1: 120,
    dataFresh: true,
    lastUpdated: "2026-08-10T13:55:00.000Z",
  };
  const result = runShadowPortfolioCycle({}, snapshot({ records: [record] }), { now: "2026-08-10T14:00:00.000Z" });

  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].costBasisDollars, 20);
  assert.equal(result.cashDollars, 80);
  assert.ok(result.positions.every((position) => position.quantity > 0));
  assert.ok(result.cashDollars >= 0);
});

test("normalization bounds persisted history and forcibly clears claimed live side effects", () => {
  const malformed = {
    initialCashDollars: 50,
    cashDollars: -100,
    liveOrderPlaced: true,
    brokerCalled: true,
    positions: [{ symbol: "BAD", quantity: -5, avgEntryPrice: 10 }],
    fills: Array.from({ length: 300 }, (_, index) => ({ side: "BUY", symbol: "AAPL", quantity: 1, price: 1, notionalDollars: 1, filledAt: `2026-08-10T12:${String(index % 60).padStart(2, "0")}:00.000Z`, liveOrderPlaced: true, brokerCalled: true })),
    decisions: Array.from({ length: 400 }, () => ({ action: "BUY", symbol: "AAPL", outcome: "blocked", reason: "bounded" })),
  };
  const result = normalizeShadowPortfolio(malformed, { snapshot: snapshot(), now: "2026-08-10T14:00:00.000Z" });

  assert.equal(result.cashDollars, 0);
  assert.equal(result.positions.length, 0);
  assert.equal(result.fills.length, 240);
  assert.equal(result.decisions.length, 320);
  assert.equal(result.liveOrderPlaced, false);
  assert.equal(result.brokerCalled, false);
  assert.ok(result.fills.every((fill) => !fill.liveOrderPlaced && !fill.brokerCalled));
});

test("explicit paper reset uses only simulated starting cash", () => {
  const result = resetShadowPortfolio(snapshot(), { startingCashDollars: 250, now: "2026-08-10T14:00:00.000Z" });
  assert.equal(result.initialCashDollars, 250);
  assert.equal(result.cashDollars, 250);
  assert.equal(result.positions.length, 0);
  assert.equal(result.fills.length, 0);
  assert.equal(result.liveOrderPlaced, false);
  assert.equal(result.brokerCalled, false);
});

test("an operator can paper-test one current proposal without broker authority", () => {
  const record = {
    id: "ticker-NET",
    ticker: "NET",
    status: "valid_setup",
    decision: "VALID_BUY_SETUP",
    score: 92,
    currentPrice: 10,
    stopLoss: 9,
    target1: 12,
    dataFresh: true,
    lastUpdated: "2026-08-10T13:55:00.000Z",
  };
  const current = snapshot({ records: [record] });
  const proposal = {
    id: "portfolio-proposal-net",
    fingerprint: "e".repeat(64),
    kind: "native_entry",
    symbol: "NET",
    side: "BUY",
    requestedDollars: 5,
    referencePrice: 10,
    outlook: { stopPrice: 9, targetPrice: 12 },
  };
  const readiness = paperProposalEligibility({}, current, proposal, { now: "2026-08-10T14:00:00.000Z" });
  const result = applyPaperProposal({}, current, proposal, { now: "2026-08-10T14:00:00.000Z" });

  assert.equal(readiness.eligible, true);
  assert.equal(readiness.requestedDollars, 5);
  assert.equal(result.action.outcome, "filled");
  assert.equal(result.portfolio.positions.length, 1);
  assert.equal(result.portfolio.positions[0].symbol, "NET");
  assert.equal(result.portfolio.cashDollars, 95);
  assert.equal(result.portfolio.fills[0].notionalDollars, 5);
  assert.equal(result.liveOrderPlaced, false);
  assert.equal(result.brokerCalled, false);
  assert.ok(result.portfolio.fills.every((fill) => !fill.liveOrderPlaced && !fill.brokerCalled));
});

test("paper-test readiness blocks stale evidence and duplicate paper positions", () => {
  const proposal = {
    id: "portfolio-proposal-net",
    fingerprint: "f".repeat(64),
    kind: "native_entry",
    symbol: "NET",
    side: "BUY",
    requestedDollars: 5,
    referencePrice: 10,
    outlook: {},
  };
  const stale = paperProposalEligibility({}, snapshot({ records: [{ ticker: "NET", status: "valid_setup", score: 92, currentPrice: 10, dataFresh: false }] }), proposal);
  assert.equal(stale.eligible, false);
  assert.match(stale.reason, /no longer fresh/i);

  const current = snapshot({ records: [{ ticker: "NET", status: "valid_setup", score: 92, currentPrice: 10, dataFresh: true }] });
  const opened = applyPaperProposal({}, current, proposal, { now: "2026-08-10T14:00:00.000Z" });
  const duplicate = paperProposalEligibility(opened.portfolio, current, proposal, { now: "2026-08-10T14:01:00.000Z" });
  assert.equal(duplicate.eligible, false);
  assert.match(duplicate.reason, /already held/i);
});

test("explicit paper testing can measure a fresh setup below the automatic entry score", () => {
  const current = snapshot({ records: [{ ticker: "ANET", status: "valid_setup", score: 75, currentPrice: 100, stopLoss: 90, dataFresh: true }] });
  const proposal = {
    id: "portfolio-proposal-anet",
    fingerprint: "1".repeat(64),
    kind: "native_entry",
    symbol: "ANET",
    side: "BUY",
    requestedDollars: 5,
    referencePrice: 100,
    outlook: { stopPrice: 90 },
  };
  const readiness = paperProposalEligibility({}, current, proposal, { now: "2026-08-10T14:00:00.000Z" });

  assert.equal(readiness.eligible, true);
  assert.equal(readiness.belowAutomaticScore, true);
  assert.equal(readiness.liveOrderPlaced, false);
  assert.equal(readiness.brokerCalled, false);
});

test("the automatic paper engine has no Robinhood client, network, review, or placement call", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "services", "stock-shadow-portfolio.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const timerBody = server.match(/const shadowTimer = setInterval\(\(\) => \{([\s\S]*?)\n\s+\}, 60_000\);/)?.[1] || "";

  assert.match(timerBody, /refreshStockShadowPortfolio/);
  assert.doesNotMatch(service, /robinhoodMcpClient|place_equity_order|review_equity_order|fetch\(|https?:|node:http/);
  assert.doesNotMatch(timerBody, /robinhoodMcpClient|place|review|dispatch|approval/i);
});
