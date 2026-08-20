const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OFFICE_ROUTES,
  discoverOfficeDisplayPort,
  displayOfficeSnapshot,
  encodeDisplaySnapshot,
  parseDisplayCommand,
} = require("../desktop/office-display-bridge");

function measuredPayload() {
  return {
    generatedAt: "2026-08-18T23:10:00.000Z",
    partial: true,
    summary: { activeOffices: 2, approvalsPending: 3, outputsReady: 9 },
    nodes: [
      {
        id: "office:stock-office",
        kind: "office",
        label: "Stock Office",
        lifecycle: "waiting_approval",
        availability: "degraded",
        refs: { officeId: "stock-office" },
        counts: { trackedRecords: 14, activeResearch: 1, outputs: 2, approvalsPending: 3 },
        blockedWork: ["place trades"],
        source: { system: "stock-office", secret: "must-not-cross-usb" },
      },
      {
        id: "gate:human",
        kind: "approval",
        counts: { pending: 3 },
      },
    ],
  };
}

test("office display serial payload contains only the compact measured projection", () => {
  const compact = displayOfficeSnapshot(measuredPayload());
  assert.equal(compact.offices.length, Object.keys(OFFICE_ROUTES).length);
  assert.equal(compact.offices.find((office) => office.id === "clips-office").outputs, -1);
  const stock = compact.offices.find((office) => office.id === "stock-office");
  assert.deepEqual(stock, {
    id: "stock-office",
    label: "Stock Office",
    lifecycle: "waiting_approval",
    availability: "degraded",
    tasks: 14,
    active: 1,
    outputs: 2,
    approvals: 3,
  });

  const wire = encodeDisplaySnapshot(measuredPayload());
  assert.match(wire, /^BEGIN\|1\|2026-08-18T23:10:00\.000Z\|1\|2\|3\|9\n/);
  assert.match(wire, /OFFICE\|stock-office\|Stock Office\|waiting_approval\|degraded\|14\|1\|2\|3\n/);
  assert.match(wire, /\nEND\n$/);
  assert.doesNotMatch(wire, /must-not-cross-usb|place trades|blockedWork|source/);
});

test("touchscreen commands are read-only navigation or refresh only", () => {
  assert.deepEqual(parseDisplayCommand("OPEN|clips-office"), {
    type: "open",
    officeId: "clips-office",
    route: "/apps/clipping-office/",
  });
  assert.deepEqual(parseDisplayCommand("REFRESH"), { type: "refresh" });
  assert.deepEqual(parseDisplayCommand("HELLO|ARGENTUM-DISPLAY|1"), { type: "hello" });
  assert.equal(parseDisplayCommand("OPEN|../../private"), null);
  assert.equal(parseDisplayCommand("APPROVE|approval-1"), null);
  assert.equal(parseDisplayCommand("TRADE|AAPL|BUY"), null);
  assert.equal(parseDisplayCommand("PUBLISH|etsy-office"), null);
});

test("configured serial display port must be an explicit device path", () => {
  assert.equal(discoverOfficeDisplayPort({ configuredPort: "/dev/cu.usbserial-110" }), "/dev/cu.usbserial-110");
  assert.equal(discoverOfficeDisplayPort({ configuredPort: "../usbserial-110" }), "");
});

test("desktop serial bridge uses nonblocking I/O so app shutdown cannot wait on touch input", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../desktop/office-display-bridge.js"), "utf8");
  assert.match(source, /O_NONBLOCK/);
  assert.match(source, /\["EAGAIN", "EWOULDBLOCK"\]/);
});
