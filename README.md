# Haushaltsbuch

Local expense tracker. The welcome page and the setup chat are in this repo. Money chat and insights are not built yet.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm test` checks the setup schema and API helpers.

## Landing

The welcome screen picks first visit or returning from `localStorage`. There is no toggle on the page.

| | |
| --- | --- |
| **Key** | `haushaltsbuch.connection` |
| **Missing or `""`** | First visit. **Get started** links to `/setup`. |
| **Any non-empty string** | Returning. **Open tracker** links to `/app`. **Set up again** links to `/setup`. |

The key is read in `app/layout.tsx` before first paint (`html[data-visit="returning"]`). The constant lives in `lib/connection.ts`.

Preview the returning screen in the browser console, then reload:

```js
localStorage.setItem("haushaltsbuch.connection", "1")
```

Return to the first-visit screen with:

```js
localStorage.removeItem("haushaltsbuch.connection")
```

## Setup

`/setup` is a four-step chat:

1. Supabase project URL and anon key. **Where do I find these?** opens the help card (supabase.com → Project Settings → API).
2. OpenAI API key, then the service role key used once to create tables.
3. Currency (default euro) and one or more banks with initials.
4. Confirm. The browser writes `haushaltsbuch.connection`, and the welcome screen shows **Open tracker**.

**Set up again** and **Change keys** stay available, including after a key expires. Leave a key field blank on Change keys to keep the saved value. The tracker stub links to **Change keys** as well.

If Supabase will not run the table SQL for that service role key, the chat shows the script and **Check tables** after you run it in the SQL editor. The key is still discarded.

## What stays in this browser

Confirm and Change keys write one JSON object to `haushaltsbuch.connection`:

| Field | Stored |
| --- | --- |
| `supabaseUrl` | Yes |
| `anonKey` | Yes |
| `openaiApiKey` | Yes |
| `currency` | Yes, default `EUR` |
| `banks` | Yes, `{ name, initials }` |
| service role key | No |

The anon key and the OpenAI key are household credentials for this machine. The app does not put them in a server database, a log line, or a chat transcript. The OpenAI key is sent once to `POST /api/setup/openai`, which checks it with OpenAI and does not save it. The service role key is sent once to `POST /api/setup/create-tables`, used to apply [`supabase/setup.sql`](supabase/setup.sql), and then dropped. It is not a field on the saved connection.

Request and response shapes are in [docs/setup-api.md](docs/setup-api.md).

## Schema

`supabase/setup.sql` is idempotent. It creates:

- `categories` — seeded with food, rent, household, grocery, bill, miscellaneous, salary
- `banks` — name and initials, empty
- `transactions` — date, category, amount, bank, notes, empty
- `preferences` — one row, currency default `EUR`

Row Level Security is on for each table. This app does not use Supabase Auth. Policies allow the `anon` role, which is the single local household. The service role is only the one-time setup credential.

## Routes

- `/` — landing
- `/setup` — setup chat
- `/app` — tracker stub
- `POST /api/setup/validate` — project URL and anon key
- `POST /api/setup/openai` — check an OpenAI key, do not store it
- `POST /api/setup/create-tables` — one-time schema apply
- `GET /api/setup/sql` — the setup script
