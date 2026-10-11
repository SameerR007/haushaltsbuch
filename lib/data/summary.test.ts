import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GET } from "../../app/api/summary/route";
import { closeDb, ensureMigrated, saveHousehold } from "../db";
import { SUMMARY_EMPTY, summaryAmountsNote, summaryEmptyRange, summaryOpensOn } from "./copy";
import {
  categoryComparison,
  changePercent,
  isWholeMonth,
  magnitudeChange,
  monthYearLabel,
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
  assert.equal(sharePercent(-850, -1412.6), 60);
  assert.equal(magnitudeChange(-1412.6, -1298.3), 114.3);
  assert.equal(changePercent(114.3, 1298.3), 8.8);
  assert.equal(SUMMARY_EMPTY.includes("today"), false);
  assert.equal(/this month/i.test(summaryEmptyRange("1st September 2026 – 30th September 2026")), false);
  assert.match(summaryOpensOn("1st September 2026 – 30th September 2026"), /^Opens on the latest month that has data: /);
  assert.match(summaryAmountsNote("euro (€)"), /^Amounts in /);
});

test("summary totals keep the sign, include a removed bank, and default to the latest month", async () => {
  await withTempDb(async () => {
    seed();
    const loaded = await getSummary();
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.ok, true);
    assert.equal(loaded.body.from, "2026-09-01");
    assert.equal(loaded.body.to, "2026-09-30");
    assert.equal(loaded.body.compareFrom, "2026-08-01");
    assert.equal(loaded.body.compareTo, "2026-08-31");
    assert.equal(loaded.body.latestFrom, "2026-09-01");
    assert.equal(loaded.body.latestTo, "2026-09-30");
    assert.equal(loaded.body.income, 2910);
    assert.equal(loaded.body.expenses, -1412.6);
    assert.equal(loaded.body.net, 1497.4);
    assert.equal(loaded.body.compareIncome, 2850);
    assert.equal(loaded.body.compareExpenses, -1298.3);
    assert.equal(loaded.body.compareNet, 1551.7);
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
    const compared = categoryComparison(categories, loaded.body.compareCategories as { category: string; amount: number }[]);
    const grocery = compared.find((row) => row.category === "grocery");
    assert.equal(grocery?.periodA, -236.2);
    assert.equal(grocery?.periodB, -205.1);
    assert.equal(magnitudeChange(grocery?.periodA ?? 0, grocery?.periodB ?? 0), 31.1);

    const july = await getSummary("?from=2026-07-01&to=2026-07-31");
    assert.equal(july.status, 200);
    assert.equal(july.body.income, 0);
    assert.equal(july.body.expenses, 0);
    assert.equal(july.body.net, 0);
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

test("summary route stays read-only and has no bank breakdown", () => {
  const route = readFileSync("app/api/summary/route.ts", "utf8");
  const query = readFileSync("lib/data/summary.ts", "utf8");
  const page = readFileSync("components/tracker/summary-board.tsx", "utf8");
  assert.equal(route.includes("guardStateChange"), false);
  assert.equal(route.includes("openai"), false);
  assert.equal(query.includes("openai"), false);
  assert.equal(query.includes("INSERT "), false);
  assert.equal(query.includes("UPDATE "), false);
  assert.equal(query.includes("DELETE "), false);
  assert.equal(page.includes("Spending by bank"), false);
  assert.equal(/this month|today/i.test(page), false);
  assert.equal(page.includes("€"), false);
});
