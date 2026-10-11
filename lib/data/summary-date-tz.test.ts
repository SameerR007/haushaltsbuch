import assert from "node:assert/strict";
import test from "node:test";
import { formatPlainDate } from "../chat/money";
import { addDays, isoDate, monthRangeContaining, yearRange } from "./summary-range";
import { applySingleDate, clickRangeDay, openRangeDraft } from "./summary-state";

test("picking the 1st, the last day, and a start after the end stays on the calendar day", () => {
  const zone = process.env.TZ ?? "";
  assert.ok(zone === "Europe/Berlin" || zone === "America/Los_Angeles", zone);
  assert.notEqual(new Date(2026, 9, 1).getTimezoneOffset(), 0);

  assert.equal(isoDate(2026, 10, 1), "2026-10-01");
  assert.equal(isoDate(2026, 10, 31), "2026-10-31");
  assert.equal(formatPlainDate(isoDate(2026, 10, 1)), "1 October 2026");
  assert.equal(formatPlainDate(isoDate(2026, 9, 30)), "30 September 2026");
  assert.equal(formatPlainDate(isoDate(2026, 10, 31)), "31 October 2026");

  const octoberFirst = new Date(2026, 9, 1);
  assert.equal(isoDate(octoberFirst.getFullYear(), octoberFirst.getMonth() + 1, octoberFirst.getDate()), "2026-10-01");
  const octoberLast = new Date(2026, 9, 31);
  assert.equal(isoDate(octoberLast.getFullYear(), octoberLast.getMonth() + 1, octoberLast.getDate()), "2026-10-31");

  const utcFirst = new Date("2026-10-01T00:00:00.000Z");
  const utcLast = new Date("2026-10-31T00:00:00.000Z");
  assert.equal(isoDate(utcFirst.getUTCFullYear(), utcFirst.getUTCMonth() + 1, utcFirst.getUTCDate()), "2026-10-01");
  assert.equal(isoDate(utcLast.getUTCFullYear(), utcLast.getUTCMonth() + 1, utcLast.getUTCDate()), "2026-10-31");

  const sliced = octoberFirst.toISOString().slice(0, 10);
  const readAsLocal = isoDate(utcFirst.getFullYear(), utcFirst.getMonth() + 1, utcFirst.getDate());
  assert.ok(sliced !== "2026-10-01" || readAsLocal !== "2026-10-01");

  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.deepEqual(monthRangeContaining("2026-10-15"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(yearRange("2026-10-01"), { from: "2026-01-01", to: "2026-12-31" });

  const september = { from: "2026-09-01", to: "2026-09-30" };
  assert.deepEqual(applySingleDate(september, "from", isoDate(2026, 10, 1)), {
    from: "2026-10-01",
    to: "2026-10-01",
  });
  assert.deepEqual(applySingleDate({ from: "2026-10-01", to: "2026-10-15" }, "to", isoDate(2026, 10, 31)), {
    from: "2026-10-01",
    to: "2026-10-31",
  });

  const started = clickRangeDay(openRangeDraft("2026-10-31"), isoDate(2026, 10, 31));
  assert.equal(started.kind, "draft");
  if (started.kind !== "draft") return;
  assert.deepEqual(clickRangeDay(started.draft, isoDate(2026, 10, 1)), {
    kind: "commit",
    range: { from: "2026-10-01", to: "2026-10-31" },
  });
});
