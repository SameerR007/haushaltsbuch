# Setup API contracts

The setup chat calls these routes. Money stays in one SQLite file on this machine. The only request that leaves the machine is the OpenAI key check.

The server does not store the OpenAI key and never logs it. Responses never include a key or an absolute database path.

Money chat, statement import, and saving transactions are documented in [chat-api.md](chat-api.md).

## Shared error

```json
{ "ok": false, "code": "invalid", "error": "Short message for the chat." }
```

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `invalid` | 400 | Missing or wrong-shaped input |
| `rejected` | 422 | OpenAI refused the key, OpenAI could not be reached, or the local database could not be written |

Success is HTTP 200 and `"ok": true`.

## `POST /api/setup/init`

Creates `{cwd}/data/haushaltsbuch.sqlite` (or `HAUSHALTSBUCH_DB_PATH` when that env var is set), migrates the schema, and seeds categories plus a default `EUR` preference. Safe to call more than once. A later call does not reset a saved currency or banks, and it does not insert transactions.

No request body is required. The chat sends `{}`.

```json
{
  "ok": true,
  "dbPath": "haushaltsbuch.sqlite",
  "tables": ["categories", "banks", "transactions", "preferences"]
}
```

`dbPath` is the file name only, or `"local"` when there is no safe basename. It is never an absolute path.

## `POST /api/setup/openai`

Checks an OpenAI key with OpenAI. The server does not store it. The browser writes it to `localStorage` after confirm.

```json
{ "apiKey": "sk-…" }
```

```json
{ "ok": true }
```

## `POST /api/setup/confirm`

Migrates the database if needed, then saves `preferences.currency` and the banks in this body. A name that matches a stored bank, ignoring case, reactivates that row and updates its initials. It does not insert a second copy.

Banks left out of this body are not kept around as choices:

- A left-out bank with no transactions is deleted.
- A left-out bank that still has transactions is marked removed (`active` 0, `removed_at` set). Its transactions stay linked to it.

No transaction rows are written.

```json
{
  "currency": "EUR",
  "banks": [{ "name": "ING", "initials": "IN" }]
}
```

```json
{ "ok": true }
```

`currency` is a 3-letter code. Each bank needs a name and initials of 1–4 letters or digits. The chat calls this from **Confirm**.

## `GET /api/setup/health`

Reads the database. It does not create the file.

```json
{ "ok": true, "dbReady": true, "currency": "EUR", "banksCount": 1 }
```

Before init, `dbReady` is `false`, `currency` is `null`, and `banksCount` is `0`. `banksCount` counts active banks only. Removed banks stay in the file and are not included.

## `localStorage`

Key: `haushaltsbuch.connection`

The browser writes this after confirm. The server does not.

```json
{
  "v": 2,
  "openaiApiKey": "sk-…",
  "currency": "EUR",
  "banks": [{ "name": "ING", "initials": "IN" }]
}
```

There is no project URL, anon key, service role key, or database path. Any non-empty value of that key makes the landing page show **Open tracker** and **Review the data**. Only version 2 objects are read back as a saved setup. `banks` is the active list and may be empty after every bank is removed. Removed banks are not stored in this browser.

## `GET /api/household`

Reads the database. It does not create the file. The response has no absolute path and no OpenAI key.

```json
{
  "ok": true,
  "database": "on this computer",
  "currency": "EUR",
  "currencyLabel": "euro (€)",
  "transactionCount": 14,
  "banks": [
    {
      "name": "ING",
      "initials": "IN",
      "active": true,
      "removedAt": null,
      "transactionCount": 14
    }
  ]
}
```

`banks` includes removed banks with `active: false` and a `removedAt` timestamp. `transactionCount` on the household and on each bank counts every linked transaction.

## `POST /api/banks`

Adds one bank. Other banks, including their initials, stay as they are. If the name matches an active bank, nothing is changed (`alreadyActive: true`). If it matches a removed bank, that row is activated again and its initials stay as they were (`reactivated: true`). A new name is inserted.

```json
{ "name": "N26", "initials": "N26" }
```

```json
{
  "ok": true,
  "bank": {
    "name": "N26",
    "initials": "N26",
    "active": true,
    "removedAt": null,
    "transactionCount": 0
  },
  "alreadyActive": false,
  "reactivated": false
}
```

## `POST /api/banks/remove`

Soft-removes a bank. Transactions are not deleted or edited. The bank disappears from setup lists, new-entry dropdowns, and the chat’s saved bank list. Old transactions still name it.

```json
{ "name": "Sparkasse" }
```

```json
{
  "ok": true,
  "bank": {
    "name": "Sparkasse",
    "initials": "SP",
    "active": false,
    "removedAt": "2026-10-10T12:00:00.000Z",
    "transactionCount": 14
  }
}
```

An unknown name is `invalid`. Removing a bank that is already removed returns that bank and does not change `removedAt`.

## `POST /api/banks/restore`

Sets `active` back to 1 and clears `removed_at`. Transactions are not changed.

```json
{ "name": "Sparkasse" }
```

## `POST /api/setup/reset`

Deletes every transaction, bank, category, and preference, then recreates the schema defaults (the category list and `EUR`). The body must send `confirm: true`. Any other value deletes nothing. The browser clears `haushaltsbuch.connection` only after this returns `"ok": true`.

```json
{ "confirm": true }
```

```json
{ "ok": true }
```

## `GET /api/export/xlsx`

Downloads `haushaltsbuch-expenses.xlsx`. Columns are Date (`YYYY-MM-DD`), Description, Category, Bank, and Amount. Amounts stay signed. Transactions whose bank was removed are included. The file is built with ExcelJS.

## `GET /api/export/sqlite`

Downloads `haushaltsbuch.sqlite`, a consistent snapshot from `better-sqlite3`’s `backup()` API. It is not a raw copy of the open database file. If the file does not exist yet, the response is `invalid`.
