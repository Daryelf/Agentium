const assert = require("node:assert/strict");
const test = require("node:test");

const { createStockEventBus } = require("../services/stock-event-bus");

test("stock event bus persists correlation metadata and streams SSE updates", () => {
  const persisted = [];
  const writes = [];
  const bus = createStockEventBus({ persist: (event) => persisted.push(event) });
  const detach = bus.attachSse({ write: (value) => writes.push(value) });
  const observed = [];
  const unsubscribe = bus.subscribe("trade.approved", (event) => observed.push(event));
  const event = bus.publish("trade.approved", { proposalId: "proposal-one", symbol: "NET", status: "approved" }, { id: "event-one", correlationId: "correlation-one", actorType: "TELEGRAM", actorId: "42" });

  assert.equal(event.correlationId, "correlation-one");
  assert.equal(persisted[0].proposalId, "proposal-one");
  assert.equal(persisted[0].actorType, "TELEGRAM");
  assert.equal(observed.length, 1);
  assert.match(writes.join(""), /event: connected/);
  assert.match(writes.join(""), /event: trade\.approved/);
  assert.match(writes.join(""), /correlation-one/);
  unsubscribe();
  detach();
  assert.equal(bus.clientCount(), 0);
});
