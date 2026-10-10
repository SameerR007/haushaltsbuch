# Chat API contracts

The tracker chat calls these routes. Money stays in the SQLite file on this machine. The browser sends the OpenAI key on each chat or PDF request. The server uses it as a bearer token and does not store it, log it, or return it.

Amounts are signed. An expense is negative. Income, including salary and other incoming money, is positive. A balance is `SUM(amount)`.

Nothing is written until `POST /api/transactions/confirm`.

## Shared error

```json
{ "ok": false, "code": "invalid", "error": "Short message for the chat." }
```

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `invalid` | 400 | Missing or wrong-shaped input, including a PDF over 25 MB |
| `rejected` | 422 | OpenAI failed, or the local database could not finish the write |

Success is HTTP 200 and `"ok": true`.

## Model

Chat and statement import both call the OpenAI Responses API. The model id is the single constant `CHAT_MODEL` in `lib/chat/openai.ts` (`gpt-5.6-sol`, the current GPT-5.x flagship). Every request sets `reasoning.effort` to `high`.

The server runs a tool loop. Responses are plain JSON. There is no streaming.

## `POST /api/chat`

```json
{
  "apiKey": "sk-…",
  "messages": [
    { "role": "user", "content": "How much did I spend on food in September?" }
  ]
}
```

`messages` is the conversation so far, at most 40 turns. The last turn is the user. The key is not part of `messages`.

```json
{
  "ok": true,
  "reply": "You spent …",
  "proposal": null
}
```

When the model proposes rows, `proposal` is a review card and `reply` may be empty. `proposal.rows` are validated. They are not saved.

```json
{
  "ok": true,
  "reply": "",
  "proposal": {
    "sourceName": null,
    "currency": "EUR",
    "categories": ["food", "grocery"],
    "banks": [{ "name": "ING", "initials": "IN" }],
    "rows": [
      {
        "date": "2026-09-12",
        "dateInput": "2026-09-12",
        "description": "Groceries",
        "category": "grocery",
        "bank": "ING",
        "bankInitials": "IN",
        "amount": -12.5,
        "amountInput": "-12.5",
        "flags": [],
        "duplicateOf": null,
        "duplicateKey": null
      }
    ]
  }
}
```

## `POST /api/import/pdf`

Multipart form fields:

| Field | |
| --- | --- |
| `apiKey` | OpenAI key. Not stored. |
| `instruction` | What to do with the statement. |
| `file` | The PDF. About 25 MB maximum. |
| `messages` | Optional JSON array of earlier chat turns. |

The server sends the PDF bytes to the Responses API as an `input_file` with base64 `file_data` and `detail` `"auto"`. It does not extract the statement text locally. The model may answer only through `propose_transactions`.

A file over 25 MB is rejected with: `That PDF is larger than 25 MB. Attach a smaller statement.`

```json
{
  "ok": true,
  "proposal": { "sourceName": "statement-november.pdf", "currency": "EUR", "categories": [], "banks": [], "rows": [] }
}
```

`sourceName` is the file name only.

## Tools

The chat turn can call both tools. The PDF turn can call only `propose_transactions`.

### `run_sql`

```json
{ "query": "SELECT SUM(amount) AS total FROM transactions" }
```

The query runs on a separate read-only SQLite connection (`query_only`, `fileMustExist`). It must be one `SELECT` or `WITH … SELECT`. The guard prepares the statement and requires `statement.reader`, so `WITH … INSERT` is rejected. Extra statements are rejected. Results stop at 200 rows (`truncated: true` when there are more). The process is stopped if it runs longer than 1.5 seconds.

```json
{ "ok": true, "columns": ["total"], "rows": [{ "total": -12.5 }], "truncated": false }
```

The system prompt tells the model to call `run_sql` before any money figure and not to answer from memory.

### `propose_transactions`

```json
{
  "rows": [
    {
      "date": "2026-09-12",
      "description": "Groceries",
      "category": "grocery",
      "bank": "ING",
      "amount": -12.5,
      "uncertain": false
    }
  ]
}
```

This tool never writes. The server validates each row and returns it on the proposal:

| Check | Flag |
| --- | --- |
| Date is not a real `YYYY-MM-DD` | `invalid_date` |
| Amount is not a finite number | `invalid_amount` |
| Category is not in `categories` | `unknown_category` |
| Bank is not in `banks` | `unknown_bank` |
| Same date, amount, bank, and notes as a saved row | `duplicate` |
| Model set `uncertain`, or the only saved bank replaced a different name | `uncertain` |

When exactly one bank is saved, that bank is filled in if the row does not already name it. When several banks are saved and the name does not match, the row is flagged and the model is told to ask instead of guessing. Relative dates such as “today” are left to the model. This version does not parse them in the app.

Rows with `invalid_date`, `invalid_amount`, `unknown_category`, or `unknown_bank` cannot be confirmed until they are fixed. Duplicates and uncertain rows are shown on the card and can still be saved.

## `POST /api/transactions/confirm`

Parameterised insert of the whole batch in one database transaction. Category and bank are checked against the tables. A bad row saves nothing.

```json
{
  "rows": [
    {
      "date": "2026-09-12",
      "description": "Groceries",
      "category": "grocery",
      "bank": "ING",
      "amount": -12.5
    }
  ]
}
```

```json
{ "ok": true, "ids": [1], "batchId": "…" }
```

`batch_id` is a nullable column added by the idempotent migrate in `lib/db.ts`. New rows from this route set it. Older rows stay `NULL`.

## `POST /api/transactions/undo`

Deletes exactly the ids that belong to that `batchId`. Ids from another batch are not deleted, and a mismatch deletes nothing. Calling it again after a successful undo deletes nothing else.

```json
{ "ids": [1], "batchId": "…" }
```

```json
{ "ok": true, "deletedIds": [1] }
```

## Local verification stub

`HAUSHALTSBUCH_STUB_OPENAI=1` skips the network call to OpenAI. Confirm, undo, the SQL guard, and row validation still run. The stub is off unless that variable is set.

| Input | Stub result |
| --- | --- |
| A chat message that does not end with `?` | One proposed grocery: day 12 of the previous month, description `Groceries`, category `grocery`, amount `-12.50`, bank left blank so the single saved bank is used |
| A chat message that ends with `?` | `run_sql` of `SUM(amount)`, then a reply that quotes that result |
| A PDF | The same grocery row, plus rent of `-850.00` on day 3 of that month. The PDF response waits about a second so the reading state is visible. Set `HAUSHALTSBUCH_STUB_DELAY_MS=0` to skip the wait |

The PDF is still uploaded to this server. The stub does not send it to OpenAI.
