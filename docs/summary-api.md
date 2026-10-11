# Summary API

`GET /api/summary` reads the local SQLite file and returns totals for two inclusive date ranges. It does not call OpenAI and it does not write.

Amounts stay signed. A positive amount is income. A negative amount is an expense. Salary and other income count as income when their amounts are positive. A negative salary is an expense. A positive refund stored in a spending category, such as grocery, also counts as income. It is not subtracted from that category’s spend: category totals add up only the negative amounts. Removed banks stay in the result.

Dates in the query are `YYYY-MM-DD`. The From and To fields, and the line that says which month the page opens on, use a plain date such as `1 September 2026`. Lists such as Largest expenses, and the Expenses page, keep the ordinal form `3rd September 2026`. Negative amounts on Summary use the minus sign −.

## Query

| Parameter | Required | Meaning |
| --- | --- | --- |
| `from`, `to` | together | Period A. When both are omitted, Period A is the calendar month of the latest transaction. |
| `compareFrom`, `compareTo` | together | Period B. When both are omitted, Period B is chosen from Period A. |

A whole calendar month compares with the previous calendar month. A whole year (`YYYY-01-01` through `YYYY-12-31`) compares with the previous calendar year. Any other range compares with the same number of days ending the day before `from`.

`from` after `to`, or `compareFrom` after `compareTo`, is HTTP 400. A value that is not a real `YYYY-MM-DD` date is HTTP 400. One end of a pair without the other is HTTP 400.

## Response

HTTP 200:

```json
{
  "ok": true,
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
  "compareCategories": [{ "category": "rent", "amount": -850 }],
  "incomeRows": [],
  "largest": []
}
```

`income` is the sum of positive amounts. `expenses` is the sum of negative amounts. `net` is the sum of every amount in the range. `categories` groups only negative amounts, so a refund does not reduce the category it was filed under. `incomeRows` lists up to 200 positive rows, largest amount first, including a removed bank’s initials. The income total still includes every positive amount when the list is capped. `largest` is the five most negative amounts. `latestFrom` and `latestTo` are the calendar month of the newest transaction, or null when the file has no transactions.

There is no spending-by-bank block.

When the household file does not exist yet, the route still returns `"ok": true` with empty totals and null dates.
