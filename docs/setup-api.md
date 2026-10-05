# Setup API contracts

The setup chat calls these routes. Money stays in one SQLite file on this machine. The only request that leaves the machine is the OpenAI key check.

The server does not store the OpenAI key and never logs it. Responses never include a key or an absolute database path.

Money chat is not part of this API.

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

Migrates the database if needed, then upserts `preferences.currency` and each bank. Banks already stored and omitted from this body are left in place. No transaction rows are written.

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

Before init, `dbReady` is `false`, `currency` is `null`, and `banksCount` is `0`.

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

There is no project URL, anon key, service role key, or database path. Any non-empty value of that key makes the landing page show **Open tracker**. Only version 2 objects are read back as a saved setup.
