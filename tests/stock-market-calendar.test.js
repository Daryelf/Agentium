const assert = require("node:assert/strict");
const test = require("node:test");

const { marketSession, marketWindow } = require("../services/stock-market-calendar");

test("NYSE calendar identifies regular, holiday, and early-close sessions", () => {
  const regular = marketSession(new Date("2026-08-12T14:00:00.000Z"));
  assert.equal(regular.session, "REGULAR");
  assert.equal(regular.regular, true);

  const christmas = marketSession(new Date("2026-12-25T15:00:00.000Z"));
  assert.equal(christmas.session, "WEEKEND_HOLIDAY");
  assert.equal(christmas.holiday, "Christmas Day");

  const earlyCloseOpen = marketSession(new Date("2026-11-27T17:30:00.000Z"));
  const earlyCloseAfter = marketSession(new Date("2026-11-27T18:30:00.000Z"));
  assert.equal(earlyCloseOpen.regular, true);
  assert.equal(earlyCloseOpen.earlyClose, true);
  assert.equal(earlyCloseAfter.status, "afterhours");
  assert.equal(marketWindow(new Date("2026-12-25T15:00:00.000Z")).active, false);
});
