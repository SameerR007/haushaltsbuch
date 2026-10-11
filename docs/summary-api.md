# Summary API

`GET /api/summary` reads the local SQLite file. It does not call OpenAI and it does not write. The Summary page has two views, and each one calls this route with only the dates that view owns.

Amounts stay signed. A positive amount is income. A negative amount is an expense. Salary and other income count as income when their amounts are positive. A negative salary is an expense. A positive refund stored in a spending category, such as grocery, also counts as income. It is not subtracted from that category’s spend: category totals add up only the negative amounts. Removed banks stay in the result.

Dates in the query are `YYYY-MM-DD`. The From and To fields, the line that says which month the page opens on, and an empty range use a plain date such as `1 September 2026` or `No expenses in 1 March 2025 – 31 March 2025 yet`. Lists such as Largest expenses, and the Expenses page, keep the ordinal form `3rd September 2026`. Negative amounts on Summary use the minus sign −. `currencyLabel` is the household label: `euro (€)` for EUR, the code and symbol when they differ (`INR (₹)`, `USD ($)`), and the code alone when the symbol is the code (`CHF`).

## One period

`scope=period`, which is also the default when `scope` is omitted.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `from`, `to` | together | The range for this view. When both are omitted, the range is the calendar month of the latest transaction. |

`compareFrom` and `compareTo` are ignored. A One period request does not compute Period B.

`from` after `to` is HTTP 400. A value that is not a real `YYYY-MM-DD` date is HTTP 400. One end without the other is HTTP 400.

HTTP 200:

```json
{
  "ok": true,
  "scope": "period",
  "currency": "EUR",
  "currencyLabel": "euro (€)",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "latestFrom": "2026-09-01",
  "latestTo": "2026-09-30",
  "income": 2910,
  "expenses": -1412.6,
  "net": 1497.4,
  "incomeCount": 2,
  "expenseCount": 7,
  "categories": [{ "category": "rent", "amount": -850 }],
  "incomeRows": [],
  "largest": []
}
```

`income` is the sum of positive amounts. `expenses` is the sum of negative amounts. `net` is the sum of every amount in the range. `incomeCount` and `expenseCount` count those rows. `categories` groups only negative amounts, so a refund does not reduce the category it was filed under. `incomeRows` lists up to 200 positive rows, largest amount first, salary and other income together, including a removed bank’s initials. The income total still includes every positive amount when the list is capped. `largest` is the five most negative amounts. `latestFrom` and `latestTo` are the calendar month of the newest transaction, or null when the file has no transactions.

There is no spending-by-bank block and no comparison block.

## Compare two periods

`scope=compare`. All four dates are required. This response has the two totals and the two category lists. It does not include income rows or the largest expenses.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `from`, `to` | yes | Period A |
| `compareFrom`, `compareTo` | yes | Period B |

The page chooses Period B itself. The first time Compare opens, Period A matches the One period range and Period B is the previous range: the previous calendar month, the previous calendar year for a whole year (`YYYY-01-01` through `YYYY-12-31`), or the same number of days ending the day before `from`. Later edits stay on this request and do not change the One period request.

Dates are calendar days (`YYYY-MM-DD`), built from the year, month, and day. A click is that calendar day in every timezone. On Compare, the field you click keeps that day. If the day would put the start after the end, the other field moves to the same day so the range stays ordered.

The response does not include a change amount or a percentage. The page computes the Change column as Period B minus Period A. Period A is the left column and the base.

- Expense categories and total expenses use the spending amounts (absolute values). A larger spend in Period B is a positive change and is shown in red. A smaller spend is green.
- Income and net use the signed totals. A higher income or net in Period B is green. A lower one is red.

The percentage is `(B − A) / |A| × 100`, shown to one decimal place, with the sign of `B − A`. Dividing by the absolute value of A keeps that sign when net in Period A is negative. When A is 0 and B is not, the cell shows the word "new" instead of a percentage. When both are 0, the cell shows the zero amount and no percentage. An example is `+€550.00 (+12.5%)`.

HTTP 200:

```json
{
  "ok": true,
  "scope": "compare",
  "currency": "EUR",
  "currencyLabel": "euro (€)",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "compareFrom": "2026-08-01",
  "compareTo": "2026-08-31",
  "latestFrom": "2026-09-01",
  "latestTo": "2026-09-30",
  "income": 2910,
  "expenses": -1412.6,
  "net": 1497.4,
  "compareIncome": 2850,
  "compareExpenses": -1298.3,
  "compareNet": 1551.7,
  "categories": [{ "category": "rent", "amount": -850 }],
  "compareCategories": [{ "category": "rent", "amount": -850 }]
}
```

When the household file does not exist yet, either scope still returns `"ok": true` with empty totals and null dates.
