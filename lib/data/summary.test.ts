import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GET } from "../../app/api/summary/route";
import { closeDb, ensureMigrated, saveHousehold } from "../db";
import { SUMMARY_EMPTY, summaryAmountsNote, summaryEmptyRange, summaryOpensOn } from "./copy";
import {
  applySingleDate,
  clearSummaryView,
  clickRangeDay,
  compareSearch,
  initialCompare,
  moveCalendarDay,
  openRangeDraft,
  periodSearch,
  previewRange,
  readSummaryView,
  SUMMARY_STORAGE_KEY,
  writeSummaryView,
} from "./summary-state";
import {
  categoryComparison,
  formatPeriodChangeText,
  isWholeMonth,
  periodChange,
  monthYearLabel,
  plainRangeLabel,
  previousPeriod,
  rangeLabel,
  sharePercent,
  wholeYearLabel,
} from "./summary-range";

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-summary-"));
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  process.env.HAUSHALTSBUCH_DB_PATH = join(dir, "household.sqlite");
  closeDb();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      closeDb();
      if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
      else process.env.HAUSHALTSBUCH_DB_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    });
}

function seed(): void {
  const saved = saveHousehold({
    currency: "EUR",
    banks: [
      { name: "North Bank", initials: "NB" },
      { name: "Removed Bank", initials: "RB" },
    ],
  });
  assert.equal(saved.ok, true);
  const database = ensureMigrated();
  database.prepare("INSERT INTO categories (name) VALUES ('other income')").run();
  const insert = database.prepare(
    "INSERT INTO transactions (date, category, amount, bank, notes) VALUES (?, ?, ?, ?, ?)",
  );
  const september: [string, string, number, string, string][] = [
    ["2026-09-28", "salary", 2850, "North Bank", "Pay"],
    ["2026-09-17", "other income", 60, "Removed Bank", "Gift"],
    ["2026-09-03", "rent", -850, "North Bank", "City Landlord"],
    ["2026-09-12", "grocery", -162, "North Bank", "Market"],
    ["2026-09-20", "grocery", -74.2, "North Bank", "Weekly shop"],
    ["2026-09-09", "food", -118.5, "North Bank", "Dinner"],
    ["2026-09-05", "miscellaneous", -85, "North Bank", "Misc"],
    ["2026-09-08", "bill", -64.9, "North Bank", "Power"],
    ["2026-09-14", "household", -58, "North Bank", "Hardware"],
  ];
  const august: [string, string, number, string, string][] = [
    ["2026-08-28", "salary", 2850, "North Bank", "Pay"],
    ["2026-08-03", "rent", -850, "North Bank", "City Landlord"],
    ["2026-08-12", "grocery", -205.1, "North Bank", "Market"],
    ["2026-08-09", "food", -142, "North Bank", "Dinner"],
    ["2026-08-08", "bill", -61.2, "North Bank", "Power"],
    ["2026-08-14", "household", -40, "North Bank", "Hardware"],
  ];
  for (const row of [...september, ...august]) insert.run(...row);
  database.prepare("UPDATE banks SET active = 0, removed_at = '2026-08-01' WHERE name = ?").run("Removed Bank");
}

async function getSummary(query = ""): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new Request(`http://localhost/api/summary${query}`));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("summary ranges use exact months and the same length otherwise", () => {
  assert.equal(isWholeMonth("2026-09-01", "2026-09-30"), true);
  assert.deepEqual(previousPeriod("2026-09-01", "2026-09-30"), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(previousPeriod("2026-01-01", "2026-12-31"), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(previousPeriod("2026-09-10", "2026-09-20"), { from: "2026-08-30", to: "2026-09-09" });
  assert.equal(previousPeriod("2026-09-20", "2026-09-01"), null);
  assert.equal(monthYearLabel("2026-09-01"), "September 2026");
  assert.equal(wholeYearLabel(2026), "Whole year 2026");
  assert.equal(rangeLabel("2026-09-03", "2026-09-03"), "3rd September 2026 – 3rd September 2026");
  assert.equal(plainRangeLabel("2026-09-01", "2026-09-30"), "1 September 2026 – 30 September 2026");
  assert.equal(sharePercent(-850, -1412.6), 60);
  const expenseChange = periodChange(-1412.6, -1298.3, "magnitude");
  assert.equal(expenseChange.amount, -114.3);
  assert.deepEqual(expenseChange.marker, { kind: "percent", value: -8.1 });
  assert.equal(SUMMARY_EMPTY.includes("today"), false);
  assert.equal(/this month/i.test(summaryEmptyRange("1st September 2026 – 30th September 2026")), false);
  assert.equal(
    summaryEmptyRange(plainRangeLabel("2025-03-01", "2025-03-31")),
    "No expenses in 1 March 2025 – 31 March 2025 yet",
  );
  assert.equal(
    summaryOpensOn("1 September 2026 – 30 September 2026"),
    "Opens on the latest month that has data. Showing 1 September 2026 – 30 September 2026",
  );
  assert.match(summaryAmountsNote("euro (€)"), /^Amounts in /);
});

test("summary totals keep the sign, include a removed bank, and default to the latest month", async () => {
  await withTempDb(async () => {
    seed();
    const loaded = await getSummary();
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.ok, true);
    assert.equal(loaded.body.scope, "period");
    assert.equal(loaded.body.from, "2026-09-01");
    assert.equal(loaded.body.to, "2026-09-30");
    assert.equal("compareFrom" in loaded.body, false);
    assert.equal("compareIncome" in loaded.body, false);
    assert.equal(loaded.body.latestFrom, "2026-09-01");
    assert.equal(loaded.body.latestTo, "2026-09-30");
    assert.equal(loaded.body.income, 2910);
    assert.equal(loaded.body.expenses, -1412.6);
    assert.equal(loaded.body.net, 1497.4);
    assert.equal(loaded.body.incomeCount, 2);
    assert.equal(loaded.body.expenseCount, 7);
    const categories = loaded.body.categories as { category: string; amount: number }[];
    assert.deepEqual(
      categories.map((row) => row.category),
      ["rent", "grocery", "food", "miscellaneous", "bill", "household"],
    );
    assert.equal(categories.some((row) => row.category === "salary" || row.category === "other income"), false);
    assert.equal(categories.find((row) => row.category === "grocery")?.amount, -236.2);
    const incomeRows = loaded.body.incomeRows as { category: string; bank: string; bankInitials: string; amount: number }[];
    assert.deepEqual(
      incomeRows.map((row) => row.category),
      ["salary", "other income"],
    );
    assert.equal(incomeRows[1]?.bank, "Removed Bank");
    assert.equal(incomeRows[1]?.bankInitials, "RB");
    const largest = loaded.body.largest as { amount: number; notes: string }[];
    assert.deepEqual(
      largest.map((row) => row.amount),
      [-850, -162, -118.5, -85, -74.2],
    );
    assert.equal(largest[0]?.notes, "City Landlord");
    const comparedResponse = await getSummary(
      "?scope=compare&from=2026-09-01&to=2026-09-30&compareFrom=2026-08-01&compareTo=2026-08-31",
    );
    assert.equal(comparedResponse.body.compareIncome, 2850);
    assert.equal(comparedResponse.body.compareExpenses, -1298.3);
    assert.equal(comparedResponse.body.compareNet, 1551.7);
    const compared = categoryComparison(
      categories,
      comparedResponse.body.compareCategories as { category: string; amount: number }[],
    );
    const grocery = compared.find((row) => row.category === "grocery");
    assert.equal(grocery?.periodA, -236.2);
    assert.equal(grocery?.periodB, -205.1);
    const groceryChange = periodChange(grocery?.periodA ?? 0, grocery?.periodB ?? 0, "magnitude");
    assert.equal(groceryChange.amount, -31.1);
    assert.deepEqual(groceryChange.marker, { kind: "percent", value: -13.2 });

    const july = await getSummary("?from=2026-07-01&to=2026-07-31");
    assert.equal(july.status, 200);
    assert.equal(july.body.income, 0);
    assert.equal(july.body.expenses, 0);
    assert.equal(july.body.net, 0);
    assert.equal(july.body.incomeCount, 0);
    assert.equal(july.body.expenseCount, 0);
    assert.equal("compareIncome" in july.body, false);
    assert.deepEqual(july.body.incomeRows, []);
    assert.deepEqual(july.body.largest, []);
    assert.deepEqual(july.body.categories, []);
  });
});

test("summary rejects a reversed range and classifies by the amount sign", async () => {
  await withTempDb(async () => {
    seed();
    const reversed = await getSummary("?from=2026-09-30&to=2026-09-01");
    assert.equal(reversed.status, 400);
    assert.equal(reversed.body.ok, false);
    const missing = await getSummary("?from=2026-09-01");
    assert.equal(missing.status, 400);
    const bad = await getSummary("?from=2026-13-01&to=2026-13-02");
    assert.equal(bad.status, 400);

    const database = ensureMigrated();
    const insert = database.prepare(
      "INSERT INTO transactions (date, category, amount, bank, notes) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("2026-06-02", "salary", -10, "North Bank", "Correction");
    insert.run("2026-06-03", "grocery", -40, "North Bank", "Shop");
    insert.run("2026-06-04", "grocery", 15, "North Bank", "Refund");
    const june = await getSummary("?from=2026-06-01&to=2026-06-30");
    assert.equal(june.body.income, 15);
    assert.equal(june.body.expenses, -50);
    assert.equal(june.body.net, -35);
    const incomeRows = june.body.incomeRows as { category: string; notes: string }[];
    const expenseCategories = june.body.categories as { category: string; amount: number }[];
    assert.deepEqual(incomeRows.map((row) => row.category), ["grocery"]);
    assert.equal(incomeRows[0]?.notes, "Refund");
    assert.equal(expenseCategories.find((row) => row.category === "grocery")?.amount, -40);
    assert.equal(expenseCategories.find((row) => row.category === "salary")?.amount, -10);
    assert.equal(june.body.incomeCount, 1);
    assert.equal(june.body.expenseCount, 2);
  });
});

test("the income list stops at 200 rows and the total still includes every positive amount", async () => {
  await withTempDb(async () => {
    seed();
    const database = ensureMigrated();
    const insert = database.prepare(
      "INSERT INTO transactions (date, category, amount, bank, notes) VALUES (?, ?, ?, ?, ?)",
    );
    for (let amount = 1; amount <= 201; amount += 1) {
      insert.run("2026-05-01", "salary", amount, "North Bank", `Pay ${amount}`);
    }
    const may = await getSummary("?from=2026-05-01&to=2026-05-31");
    assert.equal(may.status, 200);
    assert.equal(may.body.income, (201 * 202) / 2);
    const rows = may.body.incomeRows as { amount: number }[];
    assert.equal(rows.length, 200);
    assert.equal(rows[0]?.amount, 201);
    assert.equal(rows[199]?.amount, 2);
    assert.equal(rows.some((row) => row.amount === 1), false);
  });
});

test("an empty household has no default month", async () => {
  await withTempDb(async () => {
    const saved = saveHousehold({ currency: "EUR", banks: [{ name: "North Bank", initials: "NB" }] });
    assert.equal(saved.ok, true);
    const loaded = await getSummary();
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.latestFrom, null);
    assert.equal(loaded.body.from, null);
    assert.equal(loaded.body.income, 0);
    assert.equal(loaded.body.expenses, 0);
  });
});

test("one period and compare stay on separate requests", async () => {
  const september = { from: "2026-09-01", to: "2026-09-30" };
  const august = { from: "2026-08-01", to: "2026-08-31" };
  const july = { from: "2026-07-01", to: "2026-07-31" };
  const period = periodSearch(september);
  assert.equal(period.includes("compareFrom"), false);
  assert.equal(periodSearch(september), period);
  const compare = compareSearch({ a: september, b: august });
  const shifted = compareSearch({ a: september, b: july });
  assert.notEqual(compare, shifted);
  assert.equal(periodSearch(september), period);
  assert.equal(initialCompare(september)?.b.from, "2026-08-01");

  const saved = september;
  const opened = openRangeDraft(saved.from);
  const first = clickRangeDay(opened, "2026-09-14");
  assert.equal(first.kind, "draft");
  if (first.kind !== "draft") return;
  assert.equal(first.draft.step, "end");
  assert.equal(first.draft.start, "2026-09-14");
  const clickedEnd = clickRangeDay(first.draft, "2026-09-30");
  assert.deepEqual(clickedEnd, { kind: "commit", range: { from: "2026-09-14", to: "2026-09-30" } });
  const alreadySelected = clickRangeDay(openRangeDraft(saved.to), saved.to);
  assert.equal(alreadySelected.kind, "draft");
  if (alreadySelected.kind !== "draft") return;
  const reclick = clickRangeDay(alreadySelected.draft, saved.to);
  assert.equal(reclick.kind, "commit");
  const swapped = clickRangeDay(first.draft, "2026-09-01");
  assert.deepEqual(swapped, { kind: "commit", range: { from: "2026-09-01", to: "2026-09-14" } });
  assert.deepEqual(previewRange(saved, first.draft, "2026-09-23"), { from: "2026-09-14", to: "2026-09-23" });
  assert.deepEqual(applySingleDate(saved, "to", "2026-09-30"), saved);
  assert.deepEqual(applySingleDate(saved, "from", "2026-09-01"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(applySingleDate(saved, "from", "2026-10-01"), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(applySingleDate(saved, "to", "2026-09-01"), { from: "2026-09-01", to: "2026-09-01" });
  assert.equal(moveCalendarDay("2026-09-14", "ArrowRight"), "2026-09-15");
  assert.equal(moveCalendarDay("2026-09-14", "ArrowDown"), "2026-09-21");

  await withTempDb(async () => {
    seed();
    const alone = await getSummary(`?${period}`);
    assert.equal(alone.body.income, 2910);
    assert.equal("compareIncome" in alone.body, false);
    const other = await getSummary(`?${shifted}`);
    assert.equal(other.status, 200);
    assert.equal(other.body.scope, "compare");
    assert.equal(other.body.compareIncome, 0);
    assert.equal("incomeRows" in other.body, false);
    assert.equal("largest" in other.body, false);
    const again = await getSummary(`?${period}`);
    assert.equal(again.body.income, 2910);
    assert.equal(again.body.from, "2026-09-01");
    const paired = await getSummary(`?${compare}`);
    assert.equal(paired.body.compareIncome, 2850);
    assert.equal(paired.body.income, 2910);
    const ignored = await getSummary(`?${period}&compareFrom=2026-01-01&compareTo=2026-01-31`);
    assert.equal(ignored.body.income, 2910);
    assert.equal("compareFrom" in ignored.body, false);
  });
});

test("summary dates persist in this browser and clear on a full reset", () => {
  const store = new Map<string, string>();
  const previousStorage = globalThis.localStorage;
  Object.assign(globalThis, {
    localStorage: {
      setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    writeSummaryView({
      v: 1,
      mode: "compare",
      one: { from: "2026-09-01", to: "2026-09-30" },
      compare: {
        a: { from: "2026-09-01", to: "2026-09-30" },
        b: { from: "2026-07-01", to: "2026-07-31" },
      },
    });
    const stored = readSummaryView();
    assert.equal(stored.mode, "compare");
    assert.equal(stored.one?.from, "2026-09-01");
    assert.equal(stored.compare?.b.from, "2026-07-01");
    assert.equal(periodSearch(stored.one), periodSearch({ from: "2026-09-01", to: "2026-09-30" }));
    clearSummaryView();
    assert.equal(store.has(SUMMARY_STORAGE_KEY), false);
    assert.equal(readSummaryView().mode, "one");
    assert.equal(readSummaryView().compare, null);
  } finally {
    Object.assign(globalThis, { localStorage: previousStorage });
  }
});

test("summary route stays read-only and has no bank breakdown", () => {
  const route = readFileSync("app/api/summary/route.ts", "utf8");
  const query = readFileSync("lib/data/summary.ts", "utf8");
  const page = readFileSync("components/tracker/summary-board.tsx", "utf8");
  const css = readFileSync("app/app/tracker.css", "utf8");
  assert.equal(route.includes("guardStateChange"), false);
  assert.equal(route.includes("openai"), false);
  assert.equal(query.includes("openai"), false);
  assert.equal(query.includes("INSERT "), false);
  assert.equal(query.includes("UPDATE "), false);
  assert.equal(query.includes("DELETE "), false);
  assert.equal(page.includes("Spending by bank"), false);
  assert.equal(page.includes("vs Period B ("), false);
  assert.equal(page.includes("compareFrom"), false);
  assert.equal(page.includes("onDoubleClick"), false);
  assert.match(page, /periodSearch\(/);
  assert.match(page, /compareSearch\(/);
  assert.match(page, /clickRangeDay\(/);
  assert.match(page, /applySingleDate\(/);
  assert.match(page, /Change \(B/);
  assert.match(page, /formatPeriodChangeText\(/);
  assert.equal(/this month|today/i.test(page), false);
  assert.equal(page.includes("€"), false);
  assert.equal(page.includes("summary-date-wrap"), true);
  assert.equal(page.includes("formatRowDate(summary."), false);
  assert.match(page, /plainRangeLabel\(summary\.latestFrom/);
  assert.equal(page.includes("summaryEmptyRange(plainRangeLabel("), true);
  assert.equal(page.includes("summaryEmptyRange(rangeLabel("), false);
  assert.equal(page.includes("formatRowDate(row.date)"), true);
  assert.equal(page.includes("formatSummaryMoney"), true);
  assert.match(page, /hidden=\{mode !== "one"\}/);
  assert.match(page, /hidden=\{mode !== "compare"\}/);
  assert.match(css, /\.summary-date-wrap \{[^}]*position:\s*relative/);
  assert.match(css, /\.summary-date-wrap \.summary-calendar \{[^}]*position:\s*absolute/);
  assert.match(css, /\.summary-lines li > div,\s*\.summary-lines a \{[^}]*min-width:\s*0/);
  assert.match(css, /\.summary-line-amount \{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.summary-legend-name \{[^}]*overflow-wrap:\s*break-word/);
  assert.equal(/\.summary-legend-name \{[^}]*overflow-wrap:\s*anywhere/.test(css), false);
  assert.match(css, /\.summary-card-amount \{[^}]*clamp\(16px, 8\.2cqi, 28px\)/);
  assert.match(css, /\.summary-card-amount\.is-expense \{[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.summary-card-amount\.is-net \{[^}]*color:\s*var\(--teal\)/);
  assert.equal(/\.summary-card-amount\.is-expense \{[^}]*#9f2d22/.test(css), false);
});

test("change is period B minus period A, with a percentage on every row", () => {
  const MINUS = "\u2212";
  assert.equal(formatPeriodChangeText(periodChange(4400, 4950, "signed"), "EUR"), "+€550.00 (+12.5%)");
  assert.equal(formatPeriodChangeText(periodChange(100, 100, "signed"), "EUR"), "±€0.00 (±0.0%)");
  assert.equal(formatPeriodChangeText(periodChange(0, 0, "signed"), "EUR"), "±€0.00");
  assert.equal(formatPeriodChangeText(periodChange(0, 40, "signed"), "EUR"), "+€40.00 (new)");
  assert.equal(formatPeriodChangeText(periodChange(0, -25, "signed"), "EUR"), `${MINUS}€25.00 (new)`);
  assert.equal(formatPeriodChangeText(periodChange(-200, -50, "signed"), "EUR"), "+€150.00 (+75.0%)");
  assert.equal(formatPeriodChangeText(periodChange(-200, -350, "signed"), "EUR"), `${MINUS}€150.00 (${MINUS}75.0%)`);
  assert.equal(formatPeriodChangeText(periodChange(3, 4, "signed"), "EUR"), "+€1.00 (+33.3%)");
  assert.equal(formatPeriodChangeText(periodChange(3, 1, "signed"), "EUR"), `${MINUS}€2.00 (${MINUS}66.7%)`);
  assert.equal(
    formatPeriodChangeText(periodChange(-236.2, -205.1, "magnitude"), "EUR"),
    `${MINUS}€31.10 (${MINUS}13.2%)`,
  );
  const moreSpend = periodChange(-100, -180, "magnitude");
  assert.equal(moreSpend.amount, 80);
  assert.equal(formatPeriodChangeText(moreSpend, "EUR"), "+€80.00 (+80.0%)");
});

test("calendar clicks keep the local day in Berlin and Los Angeles", () => {
  const file = fileURLToPath(new URL("./summary-date-tz.test.ts", import.meta.url));
  for (const tz of ["Europe/Berlin", "America/Los_Angeles"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
      cwd: join(file, "..", "..", ".."),
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${tz}\n${result.stdout}\n${result.stderr}`);
  }
});
