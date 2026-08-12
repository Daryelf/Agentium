const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.join(__dirname, "..", "apps", "stock-office");
const shellJs = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

test("Stock Office UI exposes a real refresh outcome and useful filter feedback", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /id="syncButton"[^>]*>Refresh<\/button>/);
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

test("Stock Office uses a compact left navigation shell instead of a repeated office hero", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /class="stock-sidebar"/);
  assert.match(html, /data-stock-nav="overview"/);
  assert.match(html, /data-stock-nav="trade"/);
  assert.match(html, /data-stock-view="mirror"/);
  assert.match(script, /function setStockView/);
  assert.match(script, /history\.replaceState/);
  assert.doesNotMatch(html, /<h1>Stock Guru Office<\/h1>/);
  assert.doesNotMatch(html, /class="hero-panel"/);
});

test("Stock Office UI keeps broker actions compact while preserving guarded order controls", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /class="trade-account-bar"/);
  assert.match(html, /id="tradeAccountMetrics"/);
  assert.match(html, /New order/);
  assert.match(html, /Review order/);
  assert.match(html, /Trading limits/);
  assert.match(html, /Advanced limits/);
  assert.match(html, /class="trade-workspace"/);
  assert.match(html, /id="brokerOnboarding" hidden/);
  assert.match(html, /id="overviewEquity"/);
  assert.match(html, /id="overviewPositions"/);
  assert.match(html, /Market intelligence/);
  assert.match(html, /Market workers/);
  assert.match(html, /id="marketWorkers"/);
  assert.match(html, /Trade risk/);
  assert.match(html, /Daily trades/);
  assert.match(html, /Apply approved limits/);
  assert.doesNotMatch(html, /No password scraping|No API path|Human Gate stays on|Read first|App session/);
  assert.match(script, /\/api\/stock-office\/broker-control/);
  assert.match(script, /\/api\/stock-office\/orders\/draft/);
  assert.match(script, /\/api\/stock-office\/guardrails\/human-gate/);
  assert.match(script, /\/api\/stock-office\/guardrails\/apply/);
  assert.match(script, /portfolioPlan/);
  assert.match(script, /renderOverviewDashboard/);
  assert.match(script, /renderMarketWorkers/);
  assert.match(script, /marketWorkers/);
  assert.match(script, /Day P&L/);
  assert.match(html, /Simulation and learning/);
  assert.match(html, /Paper ledger only/);
  assert.match(script, /shadowPortfolio/);
  assert.match(script, /\/api\/stock-office\/shadow\/reset/);
  assert.match(script, /No Robinhood call or money movement occurred/);
  assert.match(html, /Market data freshness/);
  assert.match(html, /This loop cannot place orders/);
  assert.match(script, /intelligenceScheduler/);
  assert.match(script, /SEC Form 4/);
  assert.match(script, /SEC 13F/);
  assert.match(script, /Continuous refresh active/);
  assert.match(script, /Send exact order to Human Gate/);
  assert.match(script, /Prepare 2-minute Robinhood handoff/);
  assert.match(script, /Complete Robinhood OAuth on desktop/);
  assert.match(script, /\/api\/stock-office\/robinhood\/oauth\/start/);
  assert.match(script, /openRobinhoodOAuth/);
  assert.match(script, /Robinhood opened\. Approve it there, then return here\./);
  assert.match(script, /Robinhood did not finish the link/);
  assert.match(script, /oauthReturnStatus/);
  assert.doesNotMatch(script, /window\.location\.href = payload\.authorizationUrl/);
  assert.match(script, /\/api\/stock-office\/robinhood\/refresh/);
  assert.match(script, /Review and execute once with Robinhood/);
  assert.match(script, /\/dispatch\/execute/);
  assert.match(script, /Final action-time confirmation/);
  assert.match(script, /Copy exact Robinhood job/);
  assert.match(script, /\/dispatch\/claim/);
  assert.match(script, /\/dispatch\/result/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /window\.setInterval\(tickLivePortfolio, 1_000\)/);
  assert.match(script, /api\("\/api\/stock-office\/live"\)/);
  assert.match(script, /window\.setInterval\(pollLivePortfolio, 1_000\)/);
  assert.match(script, /window\.setInterval\(pollBrokerControl, 5_000\)/);
  assert.doesNotMatch(script.match(/function brokerHandoffJob[\s\S]*?\n\}/)?.[0] || "", /claim\.token/);
  assert.match(script, /toolContract\.registered/);
  assert.match(script, /No settled buying power\. Add funds in Robinhood, then refresh\./);
  assert.match(script, /target\.hidden = true/);
  assert.doesNotMatch(`${html}\n${script}`, /Robinhood password|enter your Robinhood login/i);
});

test("Overview shows branded, evidence-backed trade proposals without promising profit timing", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");
  const styles = fs.readFileSync(path.join(appRoot, "stock-office.css"), "utf8");

  assert.match(html, /id="tradeProposalsTitle">Trade proposals/);
  assert.match(html, /id="overviewProposalList"/);
  assert.match(html, /id="overviewLiveClock"/);
  assert.match(html, /id="overviewCycleRail"/);
  assert.match(html, /Company logos provided by Parqet/);
  assert.match(script, /\/api\/stock-office\/logos\/\$\{encodeURIComponent\(safeSymbol\)\}/);
  assert.match(script, /data-proposal-approve/);
  assert.match(script, /data-proposal-decline/);
  assert.match(script, /expandedProposalResearch: new Set\(\)/);
  assert.match(script, /state\.expandedProposalResearch\.has\(proposal\.id\) \? "open" : ""/);
  assert.match(script, /document\.addEventListener\("toggle"/);
  assert.match(script, /\/human-gate/);
  assert.match(script, /No broker review or order has occurred/);
  assert.match(script, /No profit date can be estimated reliably/);
  assert.match(script, /Next full cycle/);
  assert.match(script, /Copy watch/);
  assert.match(script, /Human Gate pending/);
  assert.match(styles, /\.company-logo/);
  assert.match(styles, /\.overview-proposal-list/);
});

test("Stock Office UI exposes secure approval-gated Telegram alerts for verified broker events", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /id="telegramConfigForm"/);
  assert.match(html, /Stored in Mac Keychain/);
  assert.match(html, /Request approval/);
  assert.match(html, /Enable approved alerts/);
  assert.match(script, /notifications\/telegram\/configure/);
  assert.match(script, /notifications\/telegram\/human-gate/);
  assert.match(script, /notifications\/telegram\/enable/);
  assert.match(script, /telegramAction\("test"\)/);
  assert.doesNotMatch(script, /STOCK_GURU_TELEGRAM_BOT_TOKEN/);
});

test("Control Floor Stock Office card is data-first and loads the live broker snapshot", () => {
  assert.match(shellJs, /api\("\/api\/stock-office\/broker-control"\)/);
  assert.match(shellJs, /stock-office-account-summary/);
  assert.match(shellJs, /Live portfolio/);
  assert.match(shellJs, /Largest position/);
  assert.match(shellJs, /New buys paused/);
  assert.doesNotMatch(shellJs, /Security boundary<\/h4>/);
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
  assert.match(script, /Stage guarded order/);
  assert.match(script, /candidateId/);
  assert.match(script, /data-mirror-draft/);
  assert.match(script, /brokerPositionRequired/);
  assert.match(html, /Market workers/);
});
