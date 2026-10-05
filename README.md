# Haushaltsbuch

Local expense tracker. The welcome page and the setup chat are in this repo. Money chat and insights are not built yet.

Money data stays in one SQLite file on this computer. The app does not use a cloud database. The only network call during setup is an OpenAI key check.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm test` checks the local schema, setup helpers, and connection JSON.

## Local database

The file is created on the first call to `POST /api/setup/init` (the setup chat does this for you).

| | |
| --- | --- |
| **Default path** | `data/haushaltsbuch.sqlite` in the directory where you start the app |
| **Override** | `HAUSHALTSBUCH_DB_PATH` — optional absolute or relative path. The setup chat never asks for it. |
| **Git** | `data/` and `*.sqlite` are gitignored. Do not commit the file. |

```bash
HAUSHALTSBUCH_DB_PATH=/path/to/haushaltsbuch.sqlite npm run dev
```

The file holds categories, banks, transactions, and the currency preference. It is not uploaded. Setup responses include the file name only, never the directory.

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

`/setup` is a three-step chat:

1. OpenAI API key, checked once. The local database file is created in the background.
2. Currency (default euro) and one or more banks with initials.
3. Confirm. The browser writes `haushaltsbuch.connection`, and the welcome screen shows **Open tracker**.

**Set up again** and **Change keys** stay available, including after a key expires. Leave the key field blank on Change keys to keep the saved value. The tracker stub links to **Change keys** as well.

## What stays in this browser

Confirm and Change keys write one JSON object to `haushaltsbuch.connection`:

| Field | Stored |
| --- | --- |
| `v` | `2` |
| `openaiApiKey` | Yes |
| `currency` | Yes, default `EUR` |
| `banks` | Yes, `{ name, initials }` |
| database path | No |

The OpenAI key is a household credential for this browser. The app does not put it in the SQLite file, a log line, or a chat transcript. It is sent to `POST /api/setup/openai`, which checks it with OpenAI and does not save it.

Request and response shapes are in [docs/setup-api.md](docs/setup-api.md).

## Schema

The migrate in `lib/db.ts` is idempotent. It creates:

- `categories` — seeded with food, rent, household, grocery, bill, miscellaneous, salary
- `banks` — name and initials, empty until confirm
- `transactions` — date, category, amount, bank, notes, empty
- `preferences` — one row (`id` 1), currency default `EUR`

No sample transactions are inserted. Confirm updates the currency and upserts banks.

## Routes

- `/` — landing
- `/setup` — setup chat
- `/app` — tracker stub
- `POST /api/setup/init` — create or migrate the local database
- `POST /api/setup/openai` — check an OpenAI key, do not store it
- `POST /api/setup/confirm` — save currency and banks
- `GET /api/setup/health` — whether the database is ready, plus currency and bank count
