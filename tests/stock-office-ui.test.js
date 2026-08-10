const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.join(__dirname, "..", "apps", "stock-office");

test("Stock Office UI exposes a real refresh outcome and useful filter feedback", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /Refresh Stock Office/);
  assert.match(html, /Filter records/);
  assert.match(html, /refreshFeedback[^]*aria-live="polite"/);
  assert.match(html, /filterFeedback[^]*aria-live="polite"/);
  assert.match(script, /\/api\/stock-office\/refresh-status/);
  assert.match(script, /No records match these filters/);
  assert.match(script, /Loaded \$\{count\} evaluator record/);
  assert.match(script, /button\.textContent = "Filter records"/);
  assert.doesNotMatch(script, /stock-guru copy-refresh-sec|continuous watcher/);
  assert.doesNotMatch(`${html}\n${script}`, /scanner\/evaluator outside Argentum|Sync local files/);
});

test("Stock Office UI exposes official Robinhood onboarding, capital policy, and guarded order drafting", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /Robinhood Agentic Trading/);
  assert.match(html, /Build an exact buy\/sell draft/);
  assert.match(html, /Allocated principal/);
  assert.match(html, /Kill switch/);
  assert.match(script, /\/api\/stock-office\/broker-control/);
  assert.match(script, /\/api\/stock-office\/orders\/draft/);
  assert.match(script, /\/api\/stock-office\/guardrails\/human-gate/);
  assert.match(script, /Send exact order to Human Gate/);
  assert.match(html, /No password scraping, private API/);
  assert.doesNotMatch(`${html}\n${script}`, /type="password"|enter your login/i);
});

test("Stock Office UI exposes no-look-ahead copy knowledge and evidence scores", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /Copy knowledge/);
  assert.match(html, /Scores start at 0\.500/);
  assert.match(html, /prices observed after disclosure/);
  assert.match(script, /knowledgeSummary\.measuredOutcomes/);
  assert.match(script, /candidate\.evidenceScore/);
  assert.match(script, /No matured outcomes/);
});
