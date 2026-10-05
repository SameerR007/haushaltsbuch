# Setup API contracts

The setup chat calls these routes. Keys are used for the request and then dropped. Responses never include a key. The service role key is not written to disk or `localStorage`.

Money chat is not part of this API.

## Shared error

```json
{ "ok": false, "code": "invalid", "error": "Short message for the chat." }
```

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `invalid` | 400 | Missing or wrong-shaped input |
| `rejected` | 422 | The project or provider refused the key |
| `ddl_unavailable` | 422 | Service role was accepted, then discarded. Tables still need the setup SQL |
| `incomplete` | 422 | SQL was sent, but the tables are not readable yet |

Success is HTTP 200 and `"ok": true`.

## `POST /api/setup/validate`

Checks the project URL and anon (or publishable) key. A service role key in this field is refused.

```json
{ "supabaseUrl": "https://xxxx.supabase.co", "anonKey": "eyJ…" }
```

```json
{ "ok": true }
```

## `POST /api/setup/openai`

Checks an OpenAI key with OpenAI. The server does not store it. The browser writes it to `localStorage` after `"ok": true`.

```json
{ "apiKey": "sk-…" }
```

```json
{ "ok": true }
```

## `POST /api/setup/create-tables`

Verifies the service role (or secret) key, runs [`supabase/setup.sql`](../supabase/setup.sql) once, checks that the tables are readable, and drops the key.

```json
{ "supabaseUrl": "https://xxxx.supabase.co", "serviceRoleKey": "eyJ…" }
```

```json
{
  "ok": true,
  "tables": ["categories", "banks", "transactions", "preferences"]
}
```

The script is idempotent. It seeds categories (`food`, `rent`, `household`, `grocery`, `bill`, `miscellaneous`, `salary`) and a single `preferences` row defaulting to `EUR`. It does not insert banks or transactions.

If this returns `ddl_unavailable` or `incomplete`, the chat shows the SQL from `GET /api/setup/sql`. The user runs it in the Supabase SQL editor. The browser then reads the tables with the anon key.

## `GET /api/setup/sql`

`text/plain` body of `supabase/setup.sql`. No keys.

## Browser writes after confirm

These go from the browser to the user’s project, not to Haushaltsbuch routes.

| Call | Body |
| --- | --- |
| `POST {origin}/rest/v1/preferences?on_conflict=id` | `{ "id": 1, "currency": "EUR" }` |
| `POST {origin}/rest/v1/banks?on_conflict=name` | `[{ "name": "ING", "initials": "IN" }]` |

Header `Prefer: resolution=merge-duplicates,return=minimal`, plus the anon key. No transaction rows.

## `localStorage`

Key: `haushaltsbuch.connection`

```json
{
  "v": 1,
  "supabaseUrl": "https://xxxx.supabase.co",
  "anonKey": "eyJ…",
  "openaiApiKey": "sk-…",
  "currency": "EUR",
  "banks": [{ "name": "ING", "initials": "IN" }]
}
```

Any non-empty value of that key makes the landing page show **Open tracker**. There is no `serviceRoleKey` field.
