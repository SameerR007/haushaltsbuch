# Haushaltsbuch

Local expense tracker. The welcome page, setup chat, and money chat are in this repo. Insights and Summary are placeholder pages.

Money data stays in one SQLite file on this computer. The app does not use a cloud database. The only network call during setup is an OpenAI key check.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm test` checks the local schema, setup helpers, connection JSON, the SELECT-only SQL guard, confirm/undo, signed amounts, and review-row validation.

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

**Set up again** and **Change keys** stay available, including after a key expires. Leave the key field blank on Change keys to keep the saved value. Saving setup again clears the one-time PDF disclosure, so the tracker shows it once more.

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
- `transactions` — date, category, amount, bank, notes, nullable `batch_id`, empty until a review is confirmed. Amounts are signed: expenses negative, income positive. A balance is `SUM(amount)`.
- `preferences` — one row (`id` 1), currency default `EUR`

No sample transactions are inserted. Confirm updates the currency and upserts banks.

## Tracker

`/app` is the money chat.

The header is **Haushaltsbuch**, **Chat**, **Insights ↗** (opens in a new window), and **Summary**. Insights and Summary are placeholders.

On an empty conversation the page shows **What did you spend?**, a short subtitle, and three suggested prompts. A prompt fills the message bar and does not send. After the first message is sent, the prompts stay hidden for that conversation.

The prompts are built from `haushaltsbuch.connection` (version 2): the first saved bank name, and the saved currency’s minor units for the sample amount `12.50`. The day is the 12th of the previous full month, and the month name comes from that date. If no bank is saved, the bank is left out of the first prompt.

Every new expense, including a whole statement, is a review card first: date, description, category, bank, amount, and total, then **Confirm — save N**, **Edit**, and **Cancel**. Confirm is the only write. Undo deletes exactly the rows from that confirm.

The paperclip attaches a PDF. The chip shows the file name, page count, and size. The first time a statement is attached (and again after setup is saved), the page says: “The whole PDF (text and page images) is sent to OpenAI to read it. Nothing else leaves your computer.” Sending a statement shows **Reading your statement…** while it is in flight.

The OpenAI key is read from this browser and sent on the chat or PDF request. The server does not store it. Chat and PDF import use `gpt-5.6-sol` with high reasoning (`CHAT_MODEL` in `lib/chat/openai.ts`). Questions go through a read-only `run_sql` tool. New rows come back from `propose_transactions` and are not saved by that tool.

For a local UI check without calling OpenAI, set `HAUSHALTSBUCH_STUB_OPENAI=1`. The stub is described in [docs/chat-api.md](docs/chat-api.md). Confirm and undo are never stubbed.

## Routes

- `/` — landing
- `/setup` — setup chat
- `/app` — money chat
- `/app/insights` — placeholder, opened in a separate window
- `/app/summary` — placeholder
- `POST /api/setup/init` — create or migrate the local database
- `POST /api/setup/openai` — check an OpenAI key, do not store it
- `POST /api/setup/confirm` — save currency and banks
- `GET /api/setup/health` — whether the database is ready, plus currency and bank count
- `POST /api/chat` — money chat tool loop
- `POST /api/import/pdf` — send a statement PDF to OpenAI and return a review
- `POST /api/transactions/confirm` — save a reviewed batch
- `POST /api/transactions/undo` — delete that batch

Request and response shapes for the money routes are in [docs/chat-api.md](docs/chat-api.md).
