const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const bubbleScript = fs.readFileSync(path.join(root, "human-gate-bubble.js"), "utf8");
const bubbleStyles = fs.readFileSync(path.join(root, "human-gate-bubble.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const shellScript = fs.readFileSync(path.join(root, "script.js"), "utf8");

test("global Human Gate bubble polls a narrow authenticated approval endpoint", () => {
  assert.match(server, /GET" && url\.pathname === "\/api\/human-gate\/pending"/);
  assert.match(server, /filter\(\(approval\) => approval\?\.status === "pending"\)/);
  assert.match(bubbleScript, /fetch\("\/api\/human-gate\/pending"/);
  assert.match(bubbleScript, /credentials: "same-origin"/);
  assert.match(bubbleScript, /window\.setInterval/);
  assert.doesNotMatch(bubbleScript, /\/api\/state/);
});

test("approval tray reuses existing exact Human Gate decisions", () => {
  assert.match(bubbleScript, /data-gate-decision="approve"/);
  assert.match(bubbleScript, /data-gate-decision="revise"/);
  assert.match(bubbleScript, /data-gate-decision="block"/);
  assert.match(bubbleScript, /\/api\/approvals\/\$\{encodeURIComponent\(approvalId\)\}\/\$\{action\}/);
  assert.match(bubbleScript, /Scope and evidence/);
  assert.match(bubbleScript, /argentum:approval-changed/);
  assert.match(shellScript, /window\.openArgentumHumanGate/);
});

test("bubble is installed across Argentum office surfaces", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = [
    "index.html",
    "apps/stock-office/index.html",
    "CLIPPING OFFICE /public/index.html",
  ];
  files.forEach((file) => {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /\/human-gate-bubble\.css/);
    assert.match(html, /\/human-gate-bubble\.js/);
  });
  assert.match(bubbleStyles, /position: fixed/);
  assert.match(bubbleStyles, /bottom: 16px/);
  assert.match(bubbleStyles, /left: 16px/);
  if (Array.isArray(packageJson.build?.files)) {
    assert.ok(packageJson.build.files.includes("human-gate-bubble.js"));
    assert.ok(packageJson.build.files.includes("human-gate-bubble.css"));
  }
});

test("new requests are visible without weakening Human Gate semantics", () => {
  assert.match(bubbleScript, /argentum\.humanGate\.seen\.v1/);
  assert.match(bubbleScript, /classList\.add\("has-new"\)/);
  assert.match(bubbleScript, /setOpen\(true/);
  assert.match(server, /exactScope: redactSensitiveText/);
  assert.doesNotMatch(bubbleScript, /approve_limited|dispatch\/execute|robinhood\/orders/);
});
