const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.join(__dirname, "..", "apps", "stock-office");

test("Stock Office UI exposes a real refresh outcome and useful filter feedback", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /id="syncButton"[^>]*>Update market data<\/button>/);
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
  assert.match(html, /data-stock-nav="mirror"[^]*<span>Research<\/span>/);
  assert.match(html, /data-stock-nav="portfolio"[^]*<span>Simulation<\/span>/);
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
  assert.match(html, /Best opportunities/);
  assert.match(html, /Market workers/);
  assert.match(html, /id="marketWorkers"/);
  assert.match(html, /id="operationsToggle"[^>]*>Minimize<\/button>/);
  assert.match(html, /id="overviewOperationsSummary"/);
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
  assert.match(script, /Official Robinhood total/);
  assert.match(script, /\["Buying power"/);
  assert.match(script, /\["Cash"/);
  assert.match(script, /\["Stocks"/);
  assert.match(script, /\["Pending"/);
  assert.match(script, /\["Unsettled"/);
  assert.match(html, /Strategy stress lab/);
  assert.match(html, /continuously tested\. No manual start buttons/);
  assert.match(script, /shadowPortfolio/);
  assert.match(script, /simulationLab/);
  assert.match(script, /strategyConfigurationsPerSecond/);
  assert.match(script, /scenarioPathsPerSecond/);
  assert.match(script, /testing automatically/);
  assert.match(script, /\/api\/stock-office\/shadow\/reset/);
  assert.doesNotMatch(`${html}\n${script}`, /data-simulation-test|Simulate now/);
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
  assert.match(html, /id="overviewTradeReadiness"/);
  assert.match(html, /id="overviewLiveClock"/);
  assert.match(html, /Company logos provided by Parqet/);
  assert.match(script, /\/api\/stock-office\/logos\/\$\{encodeURIComponent\(safeSymbol\)\}/);
  assert.match(script, /data-proposal-approve/);
  assert.match(script, /data-proposal-review/);
  assert.doesNotMatch(script, /data-proposal-paper/);
  const overviewRenderer = script.match(/function renderTradeProposals\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(overviewRenderer, /paper-test|data-simulation-test/);
  assert.match(script, /New real order/);
  assert.match(script, /REAL ORDERS/);
  assert.match(script, /Send \$\{escapeHtml\(proposal\.side\)\} \$\{escapeHtml\(formatMoney\(proposal\.requestedDollars\)\)\} to Human Gate/);
  assert.match(script, /const qualifiedCandidates = actionCandidates\.filter\(\(proposal\) => proposal\.draftEligible \|\| realOrderStates\.has\(proposal\.reviewState\)\)/);
  assert.match(script, /const visible = \[\.\.\.qualifiedCandidates\]/);
  assert.match(script, /No trade meets \$\{escapeHtml\(requiredScore\)\}\/100 yet/);
  assert.match(script, /Closest now:/);
  assert.match(script, /Fresh market scans run about every/);
  assert.doesNotMatch(script, /const visible = \[\.\.\.actionCandidates\]/);
  assert.match(script, /Current blocker:/);
  assert.match(script, /stock-office:operations-collapsed/);
  assert.doesNotMatch(script, /blockers\.slice\(0, 3\)\.join/);
  assert.match(script, /data-proposal-decline/);
  assert.match(script, /expandedProposalResearch: new Set\(\)/);
  assert.match(script, /state\.expandedProposalResearch\.has\(proposal\.id\) \? "open" : ""/);
  assert.match(script, /document\.addEventListener\("toggle"/);
  assert.match(script, /\/human-gate/);
  assert.match(script, /No broker review or order has occurred/);
  assert.match(script, /No profit date can be estimated reliably/);
  assert.match(styles, /\.company-logo/);
  assert.match(styles, /\.overview-proposal-list/);
  assert.match(html, /id="quickOrderDialog"/);
  assert.match(script, /Run checks & send to Human Gate/);
  assert.match(html, /id="secIdentityForm"/);
  assert.match(script, /sources\/sec-identity/);
});

test("Stock Office runs fast local readiness checks between full market-data scans", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(server, /STOCK_GURU_READINESS_INTERVAL_MS/);
  assert.match(server, /STOCK_GURU_READINESS_INTERVAL_MS, 1_000, 1_000, 60_000/);
  assert.match(server, /stockReadinessBrokerSnapshotAt/);
  assert.match(server, /function runStockReadinessCycle/);
  assert.match(server, /trigger: "live_readiness"/);
  assert.match(script, /decisionCadenceSeconds/);
  assert.match(script, /live checks ·/);
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

test("Research combines no-look-ahead copy evidence, consensus, and explicit source controls", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");

  assert.match(html, /RESEARCH \+ COPY TRADING/);
  assert.match(html, /Research center/);
  assert.match(html, /Methods &amp; evidence/);
  assert.match(html, /Traders &amp; funds/);
  assert.match(html, /Multi-source matches/);
  assert.match(html, /Source events/);
  assert.match(script, /knowledgeSummary\.measuredOutcomes/);
  assert.match(script, /candidate\.evidenceScore/);
  assert.match(script, /No matured outcomes/);
  assert.match(script, /Stage guarded order/);
  assert.match(script, /candidateId/);
  assert.match(script, /data-mirror-draft/);
  assert.match(script, /brokerPositionRequired/);
  assert.match(script, /data-mirror-follow/);
  assert.match(script, /data-mirror-enable/);
  assert.match(script, /mirror\/sources/);
  assert.match(script, /Copy on/);
  assert.match(script, /Symbols researched/);
  assert.match(script, /INDEPENDENT SCAN/);
  assert.match(script, /independentProposals/);
  assert.match(script, /data-proposal-drawer/);
  assert.match(script, /Send to Human Gate/);
  assert.doesNotMatch(script, /No current copy signal/);
  assert.match(html, /Market workers/);
});

test("production UI labels unavailable values and never hardcodes a live portfolio or fake score", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(appRoot, "stock-office.js"), "utf8");
  assert.match(html, /id="executionModePill"[^>]*>Checking live orders/);
  assert.match(script, /buyingPower === null \? "—"/);
  assert.match(script, /scores\.mirror \?\? "—"/);
  assert.match(script, /No qualified opportunity/);
  assert.match(script, /new EventSource\("\/api\/stock-office\/events", \{ withCredentials: true \}\)/);
  assert.match(html, /id="intelligenceDrawer"/);
  assert.doesNotMatch(script, /const\s+(?:portfolioValue|buyingPower|aiScore)\s*=\s*\d+/);
});
