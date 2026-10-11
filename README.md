# Haushaltsbuch

Local expense tracker. The welcome page, setup chat, and money chat are in this repo. Insights and Summary are placeholder pages.

Money data stays in one SQLite file on this computer. The app does not use a cloud database. The only network call during setup is an OpenAI key check.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm test` checks the local schema, setup helpers, connection JSON, the SELECT-only SQL guard, confirm/undo, signed amounts, review-row validation, bank soft-remove, reset, exports, and expense edits.

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
| **Any non-empty string** | Returning. **Open tracker** links to `/app/expenses`. **Review the data** links to `/data`. |

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

**Review the data** opens **Your data**: database on this computer, currency, active banks, and whether an OpenAI key is saved in this browser. From there: **Open tracker**, **Change keys**, **Add / Remove banks**, and, under **Start over from scratch**, **Set up completely new**.

**Change keys** stays available, including after a key expires. Leave the key field blank on Change keys to keep the saved value. Saving setup again clears the one-time PDF disclosure, so the tracker shows it once more. Adding or removing a bank updates the active bank list in this browser and does not clear that disclosure.

Removing a bank hides it from new entries. Its transactions stay. The last active bank cannot be removed. Adding a bank whose name matches a removed one reactivates that row and updates its initials. **Set up completely new** (`/data/reset`) can download `haushaltsbuch-expenses.xlsx` and, if asked, a SQLite backup, then `POST /api/setup/reset` with `confirm: true`. Setup no longer has a **Set up again** button that skipped that backup. **Change keys** only checks the OpenAI key. It does not call confirm. The browser clears `haushaltsbuch.connection` only after reset succeeds, and setup starts again at the OpenAI key. Reset then checkpoints and vacuums the file so deleted rows are not left on disk.

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
- `banks` — name, initials, `active` (1 or 0), and `removed_at`. Empty until confirm. Older files gain `active` and `removed_at` on migrate; existing rows stay active. Transactions are not rewritten.
- `transactions` — date, category, amount, bank, notes, nullable `batch_id`, empty until a review is confirmed. Amounts are signed: expenses negative, income positive. A balance is `SUM(amount)`. Dates are stored as `YYYY-MM-DD` and shown as `12th September 2026`.
- `preferences` — one row (`id` 1), currency default `EUR`

No sample transactions are inserted. Confirm updates the currency and the submitted banks. A bank left out of that list is deleted when it has no transactions, or marked removed when it does. A later confirm that names a removed bank activates it again instead of inserting a duplicate.

## Tracker

`/app` is the money chat.

The header is **Haushaltsbuch**, then **Expenses**, **Chat**, **Summary**, and **Insights ↗** (opens in a new window). Insights is a placeholder. **Open tracker** (welcome, setup, and Your data) opens Expenses at `/app/expenses`.

**Summary** opens on the latest calendar month that has a transaction. From and To pick an exact range and show a plain date such as 1 September 2026, as does the line that names the month the page opens on. The chips jump to a recent month or a whole year. Income is the sum of positive amounts. Expenses are the negative amounts, including salary stored as a negative correction. A positive refund in a spending category counts as income and is not subtracted from that category. The income list shows at most 200 rows. Cards, the category donut, the income list, the five largest expenses, and the comparison table are calculated on this computer. A largest-expense row opens that row in Expenses. Period B starts as the previous calendar month when Period A is a whole month, the previous calendar year when Period A is a whole year, and otherwise the same number of days immediately before Period A. An empty range says **No expenses in … yet** and offers **Go to Chat**.

**Expenses** lists every transaction, newest first, with the household currency in the subtitle. With no transactions it explains that rows will show up after you add them in Chat or from a statement PDF, notes that they stay on this computer unless you set up completely new, and offers **Go to Chat**. **Download as Excel** stays hidden until there is at least one row, then fetches `GET /api/export/xlsx` and shows an error on the page if that fails. Each cell saves on its own through `PATCH /api/transactions/[id]`. Typing an amount without `+` or `-` keeps that row’s sign, including a comma decimal such as `14,25`. The amount field selects its current value on focus. The bank menu lists active banks, plus that row’s bank if it was removed. There is no delete.

On an empty conversation the page shows **What did you spend?**, a short subtitle, and three suggested prompts. A prompt fills the message bar and does not send. After the first message is sent, the prompts stay hidden for that conversation. Switching tabs or reloading keeps that conversation in this browser (`haushaltsbuch.chat`). **New chat** appears once there is a message, an attached PDF, or a review card. It clears the stored conversation and brings the prompts back. It does not delete transactions already saved. **Set up completely new** removes that stored conversation as well.

The prompts are built from `haushaltsbuch.connection` (version 2): the first saved bank name, and the saved currency’s minor units for the sample amount `12.50`. The day is the 12th of the previous full month, and the month name comes from that date. If no bank is saved, the bank is left out of the first prompt.

Every new expense, including a whole statement, is a review card first: date, description, category, bank, amount, and total, then **Confirm — save N**, **Edit**, and **Cancel**. Confirm is the only write. A row flagged as a duplicate is skipped unless **Include anyway** is on, and the button count leaves those rows out. Undo deletes exactly the rows from that confirm.

The paperclip attaches a PDF. The chip shows the file name, page count, and size. The first time a statement is attached (and again after setup is saved), the page says: “The whole PDF (text and page images) is sent to OpenAI to read it. Nothing else leaves your computer.” Sending a statement shows **Reading your statement…** while it is in flight.

The OpenAI key is read from this browser and sent on the chat or PDF request. The server does not store it. Chat and PDF import use `gpt-5.6-luna` with high reasoning (`CHAT_MODEL` in `lib/chat/openai.ts`; override with `HAUSHALTSBUCH_CHAT_MODEL`). Requests set `store` to false. Questions go through a read-only `run_sql` tool, and the tool result is sent back to the model. New rows come back from `propose_transactions` and are not saved by that tool.

For a local UI check without calling OpenAI, set `HAUSHALTSBUCH_STUB_OPENAI=1`. The stub is described in [docs/chat-api.md](docs/chat-api.md). Confirm and undo are never stubbed.

## Routes

- `/` — landing
- `/data` — your data, for a returning browser
- `/data/banks` — add or soft-remove banks
- `/data/reset` — backup, then delete everything and start setup again
- `/setup` — setup chat. `?mode=keys` opens Change keys
- `/app` — money chat
- `/app/expenses` — editable expenses
- `/app/insights` — placeholder, opened in a separate window
- `/app/summary` — income, expenses, and a comparison of two date ranges
- `POST /api/setup/init` — create or migrate the local database
- `POST /api/setup/openai` — check an OpenAI key, do not store it
- `POST /api/setup/confirm` — save currency and banks; drop or soft-remove banks that are not in the list
- `POST /api/setup/reset` — delete household rows when a same-origin JSON body has `confirm: true`, checkpoint, vacuum, then reseed defaults
- `GET /api/setup/health` — whether the database is ready, plus currency and active bank count
- `GET /api/household` — currency, active and removed banks, transaction counts
- `POST /api/banks` — add one bank, or reactivate a removed bank and update its initials
- `POST /api/banks/remove` — soft-remove a bank; transactions stay; the last active bank is refused
- `POST /api/banks/restore` — make a removed bank active again
- `GET /api/export/xlsx` — Excel file of every transaction
- `GET /api/export/sqlite` — SQLite backup via `better-sqlite3` backup
- `POST /api/chat` — money chat tool loop
- `POST /api/import/pdf` — send a statement PDF to OpenAI and return a review
- `GET /api/summary` — read-only totals for two date ranges. See [docs/summary-api.md](docs/summary-api.md)
- `GET /api/transactions` — expenses, newest first
- `PATCH /api/transactions/[id]` — edit one expense; does not change `batch_id`
- `POST /api/transactions/confirm` — save a reviewed batch
- `POST /api/transactions/undo` — delete that batch

Request and response shapes for the money routes are in [docs/chat-api.md](docs/chat-api.md).
