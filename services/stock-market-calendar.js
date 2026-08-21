const MARKET_TIME_ZONE = "America/New_York";

function isoDay(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateParts(value) {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay() };
}

function addDays(value, count) {
  return new Date(value.getTime() + count * 86_400_000);
}

function nthWeekday(year, month, weekday, occurrence) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const value = addDays(first, offset + (occurrence - 1) * 7);
  const parts = dateParts(value);
  return isoDay(parts.year, parts.month, parts.day);
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const value = addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
  const parts = dateParts(value);
  return isoDay(parts.year, parts.month, parts.day);
}

function observedDay(year, month, day) {
  const value = utcDate(year, month, day);
  if (value.getUTCDay() === 6) return addDays(value, -1);
  if (value.getUTCDay() === 0) return addDays(value, 1);
  return value;
}

function westernEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const ell = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * ell) / 451);
  const month = Math.floor((h + ell - 7 * m + 114) / 31);
  const day = ((h + ell - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

const SPECIAL_CLOSURES = new Map([
  ["2001-09-11", "September 11 closure"],
  ["2001-09-12", "September 11 closure"],
  ["2001-09-13", "September 11 closure"],
  ["2001-09-14", "September 11 closure"],
  ["2004-06-11", "President Reagan national day of mourning"],
  ["2007-01-02", "President Ford national day of mourning"],
  ["2012-10-29", "Hurricane Sandy closure"],
  ["2012-10-30", "Hurricane Sandy closure"],
  ["2018-12-05", "President George H.W. Bush national day of mourning"],
]);

function nyseHolidayMap(year) {
  const values = new Map();
  const addDate = (value, name) => {
    const parts = dateParts(value);
    values.set(isoDay(parts.year, parts.month, parts.day), name);
  };
  addDate(observedDay(year, 1, 1), "New Year's Day");
  values.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  values.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  addDate(addDays(westernEaster(year), -2), "Good Friday");
  values.set(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) addDate(observedDay(year, 6, 19), "Juneteenth National Independence Day");
  addDate(observedDay(year, 7, 4), "Independence Day");
  values.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  values.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  addDate(observedDay(year, 12, 25), "Christmas Day");
  const nextNewYear = observedDay(year + 1, 1, 1);
  if (nextNewYear.getUTCFullYear() === year) addDate(nextNewYear, "New Year's Day");
  for (const [day, name] of SPECIAL_CLOSURES.entries()) {
    if (day.startsWith(`${year}-`)) values.set(day, name);
  }
  return values;
}

function nyseEarlyCloseMap(year) {
  const holidays = nyseHolidayMap(year);
  const values = new Map();
  const thanksgiving = utcDate(year, 11, Number(nthWeekday(year, 11, 4, 4).slice(-2)));
  const friday = addDays(thanksgiving, 1);
  const fridayParts = dateParts(friday);
  const fridayKey = isoDay(fridayParts.year, fridayParts.month, fridayParts.day);
  if (!holidays.has(fridayKey)) values.set(fridayKey, "Day after Thanksgiving");
  const julyThird = isoDay(year, 7, 3);
  const julyThirdDate = utcDate(year, 7, 3);
  if (![0, 6].includes(julyThirdDate.getUTCDay()) && !holidays.has(julyThird)) values.set(julyThird, "Day before Independence Day");
  const christmasEve = isoDay(year, 12, 24);
  const christmasEveDate = utcDate(year, 12, 24);
  if (![0, 6].includes(christmasEveDate.getUTCDay()) && !holidays.has(christmasEve)) values.set(christmasEve, "Christmas Eve");
  return values;
}

function zonedParts(at = new Date(), timeZone = MARKET_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function marketSession(at = new Date(), timeZone = MARKET_TIME_ZONE) {
  const parts = zonedParts(at, timeZone);
  const marketDate = isoDay(parts.year, parts.month, parts.day);
  const holiday = nyseHolidayMap(parts.year).get(marketDate) || null;
  const weekend = ["Sat", "Sun"].includes(parts.weekday);
  const isTradingDay = !weekend && !holiday;
  const earlyClose = isTradingDay && nyseEarlyCloseMap(parts.year).has(marketDate);
  const closeMinute = earlyClose ? 13 * 60 : 16 * 60;
  const minutes = parts.hour * 60 + parts.minute;
  let status = "closed";
  let label = "Overnight research";
  let session = "OVERNIGHT";
  let regular = false;
  if (!isTradingDay) {
    status = "weekend";
    label = holiday ? `${holiday} research` : "Weekend research";
    session = "WEEKEND_HOLIDAY";
  } else if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    status = "premarket";
    label = "Premarket research";
    session = "PRE_MARKET";
  } else if (minutes >= 9 * 60 + 30 && minutes < closeMinute) {
    status = "regular";
    label = earlyClose ? "Regular market open · early close" : "Regular market open";
    session = "REGULAR";
    regular = true;
  } else if (minutes >= closeMinute && minutes < 20 * 60) {
    status = "afterhours";
    label = "After-hours research";
    session = "AFTER_HOURS";
  }
  return { status, label, regular, session, marketDate, holiday, earlyClose, regularCloseMinute: isTradingDay ? closeMinute : null };
}

function marketWindow(at = new Date(), timeZone = MARKET_TIME_ZONE) {
  const current = marketSession(at, timeZone);
  const label = current.status === "regular" ? "market_open"
    : current.status === "premarket" ? "premarket_research"
      : current.status === "afterhours" ? "after_hours_research"
        : current.status === "weekend" ? "weekend_research" : "night_research";
  const session = current.session === "REGULAR" ? "regular"
    : current.session === "PRE_MARKET" ? "premarket"
      : current.session === "AFTER_HOURS" ? "afterhours"
        : current.session === "WEEKEND_HOLIDAY" ? "weekend" : "overnight";
  return { active: current.regular, label, session, marketDate: current.marketDate, holiday: current.holiday, earlyClose: current.earlyClose };
}

module.exports = {
  MARKET_TIME_ZONE,
  marketSession,
  marketWindow,
  nyseEarlyCloseMap,
  nyseHolidayMap,
  zonedParts,
};
