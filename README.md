# Haushaltsbuch

Your household's money in a database on your computer that you can **ask questions in plain language**: *"How much did we spend on groceries in March?"*, *"Which month was the most expensive this year?"*. The answers come straight from your data.

Keep the database up to date whenever you like, by chatting (*"Rent 850 on the 3rd"*) or by dropping in a bank statement PDF. **It stays saved between visits.**

![A 55-second tour: add expenses by chat or statement PDF, confirm them, see them in the Expenses table, ask a question, and open the monthly summary.](promo/tour.gif)

- **Ask your database anything.** Totals, comparisons, biggest expenses, trends: any question your saved data can answer.
- **Add data any time.** One expense in a chat message or a whole statement PDF. It all goes into the same database.
- **Your money data stays local.** Everything is saved in one SQLite file on your computer. There is no cloud database.
- **You pick the AI.** Use OpenAI, a model on your computer (Ollama), or any OpenAI-compatible endpoint.
- **Nothing is saved without you.** The assistant only *proposes* rows. You review them and press **Confirm**, and you can undo.
- **Optional tracing.** Turn on [Langfuse](#optional-tracing-with-langfuse) to see every prompt, SQL query and model call.

---

## Quick start

You need [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org) 20+. In a terminal, git clone the repository and start the app:

```bash
git clone https://github.com/SameerR007/haushaltsbuch.git
cd haushaltsbuch
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Get started**. A short setup chat asks four things:

1. **Where the assistant runs:** OpenAI (API key), your computer (Ollama), or an OpenAI-compatible endpoint
2. **Currency:** EUR by default, or INR, USD, or any ISO code
3. **Your banks:** for example *Sparkasse (SP)*
4. **Confirm:** the local database is ready and the tracker opens

> **Running locally?** Install [Ollama](https://ollama.com) and pull a chat model, for example `ollama pull bonsai-2:9b`. If you want to read **scanned** statements too, also pull an OCR model such as `glm-ocr`.

---

## How you use it

```mermaid
flowchart LR
    ADD["Add data<br/>chat or statement PDF"] -->|"you confirm"| DB[("Your database<br/>on your computer")]
    DB <-->|"question in,<br/>answer out"| ASK["Ask questions<br/>in plain language"]
    DB --> VIEW["Browse it<br/>Expenses and Summary"]
```

After a one-time setup, everything works on the same database, in any order, as often as you like:

- **Ask** about anything already in it.
- **Add** more whenever new spending comes in.
- **Browse** it as a table or a summary.

It stays saved between visits: just run `npm run dev` again.

| Page | What it's for |
| --- | --- |
| **Chat** | Add expenses or income in plain language, attach a statement PDF, ask questions about your money |
| **Expenses** | Every transaction, newest first. Edit any cell in place, remove a row, download as Excel |
| **Summary** | Income, expenses and net for one period, or two periods side by side, with a category chart and the largest expenses |
| **Your data** | Change the assistant or keys, add or remove banks, back up, or start over |

---

## How it works

### Where everything lives

```mermaid
flowchart LR
    B["Your browser<br/>settings and chat history"] <--> A["The app<br/>runs on your computer"]
    A <--> D[("Database file<br/>on your computer")]
    A <--> AI["AI assistant<br/>OpenAI, Ollama or endpoint"]
    A -.-> L["Langfuse<br/>optional"]
```

- **Your browser** keeps your settings (including any API key) and the chat history.
- **The app** runs on your computer. It talks to the AI assistant and to the database.
- **The database** is one SQLite file on your computer. Something is only written to it when you press **Confirm**, edit a row, undo, or reset.
- **The AI assistant** is whichever one you picked during setup. It can read your data, but it cannot change it.
- **Langfuse** is only used if you turn on tracing.

### Asking a question

```mermaid
sequenceDiagram
    actor You
    participant App
    participant AI as AI assistant
    You->>App: How much on groceries in March?
    App->>AI: Your question
    AI->>App: Please look up the March grocery total
    Note over App,AI: The app reads your database (read-only)
    App->>AI: €184.20
    AI->>App: You spent €184.20 on groceries in March.
    App->>You: The answer
```

The AI only *asks* for data. The app checks that every query is read-only before running it.

### Adding spending

When you write *"Rent 850 on the 3rd"* or attach a statement, the AI suggests rows. The app checks them (date, category, bank, possible duplicates) and shows them on a **review card**. You can edit or remove any row. Nothing is saved until you press **Confirm**, and **Undo** removes that batch again.

### Reading a statement PDF

```mermaid
flowchart TD
    P["Statement PDF"] --> Q{"Where does<br/>your AI run?"}
    Q -->|Online| O["Sent to OpenAI or your endpoint,<br/>after you agree"]
    Q -->|Your computer| L["Read on your computer.<br/>Scanned pages use the OCR model"]
    O --> R["Review card"]
    L --> R
    R -->|Confirm| S[("Saved")]
```

With an assistant on your computer, the PDF never leaves your computer. To read scanned (image-only) statements, add an OCR model such as `glm-ocr` during setup.

---

## Choosing an assistant

| | On OpenAI | On your computer | OpenAI-compatible endpoint |
| --- | --- | --- | --- |
| **You enter** | API key | Address (default `http://localhost:11434`), model, optional OCR model | Base URL, key, model |
| **Default model** | `gpt-5.6-luna` | `bonsai-2:9b` | your choice |
| **Statement PDFs** | Sent to OpenAI (asks first) | Read locally | Sent to the endpoint (asks first) |
| **Data leaves your computer?** | Prompts and query results go to OpenAI | No | Prompts and query results go to the endpoint |

Switch at any time under **Your data → Change assistant**. Your banks, currency and transactions stay.

---

## Routes

### Pages

| Route | Page |
| --- | --- |
| `/` | Welcome page with **Get started** |
| `/setup/chat` | Four-step setup chat (`?mode=keys` opens **Change keys**) |
| `/setup` | Setup card for returning visitors |
| `/chat` | Money chat: add expenses, import PDFs, ask questions |
| `/expenses` | Editable list of all transactions, Excel download |
| `/summary` | One period, or compare two periods |
| `/insights` | Placeholder (opens in a new window) |
| `/data` | **Your data**: overview and settings |
| `/data/assistant` | Change the assistant |
| `/data/banks` | Add or remove banks |
| `/data/reset` | Back up, then delete everything and start over |

Old paths (`/app/...`, `/welcome`, `/setup?mode=keys`) redirect to the ones above.

### API

All routes run on the local Next.js server. Requests that change data must come from the same origin.

| Method & route | What it does |
| --- | --- |
| **Setup** | |
| `POST /api/setup/init` | Create or migrate the local database |
| `GET  /api/setup/health` | Is the database ready? Currency and active bank count |
| `POST /api/setup/openai` | Check an OpenAI key (not stored) |
| `POST /api/setup/assistant` | Test a local model or endpoint (not stored) |
| `POST /api/setup/confirm` | Save currency and banks |
| `POST /api/setup/reset` | Delete all household data (`{ "confirm": true }`) |
| **Household & banks** | |
| `GET  /api/household` | Currency, banks, transaction counts |
| `POST /api/banks` | Add a bank, or bring a removed one back |
| `POST /api/banks/remove` | Hide a bank from new entries (its transactions stay) |
| `POST /api/banks/restore` | Make a removed bank active again |
| **Assistant** | |
| `POST /api/chat` | One chat turn: the tool loop with `run_sql` and `propose_transactions` |
| `POST /api/import/pdf` | Read a statement PDF and return a review card (multipart) |
| **Transactions** | |
| `GET    /api/transactions` | All transactions, newest first |
| `PATCH  /api/transactions/[id]` | Edit one transaction |
| `DELETE /api/transactions/[id]` | Remove one transaction |
| `POST   /api/transactions/confirm` | Save a reviewed batch |
| `POST   /api/transactions/undo` | Delete that batch again |
| **Reports & export** | |
| `GET /api/summary` | Totals for one or two date ranges |
| `GET /api/export/xlsx` | Excel file of every transaction |
| `GET /api/export/sqlite` | Backup copy of the database |

Request and response shapes: [setup](docs/setup-api.md) · [chat, import & transactions](docs/chat-api.md) · [summary](docs/summary-api.md).

---

## Configuration

Everything is optional. Copy `.env.example` to `.env.local` (gitignored) and edit it, or pass variables on the command line.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAUSHALTSBUCH_DB_PATH` | `data/haushaltsbuch.sqlite` | Where the database file lives |
| `HAUSHALTSBUCH_CHAT_MODEL` | `gpt-5.6-luna` | OpenAI model for chat and PDF import |
| `HAUSHALTSBUCH_STUB_OPENAI` | off | Set to `1` to fake OpenAI replies for UI testing (no network) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | unset | Turn on tracing (see below) |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse server |

```bash
HAUSHALTSBUCH_DB_PATH=~/Documents/haushaltsbuch.sqlite npm run dev
```

---

## Optional: tracing with Langfuse

Want to see exactly what the assistant did: the prompt, every model call, each SQL query and its rows? Turn on [Langfuse](https://langfuse.com) tracing. **It's off by default**, and without keys nothing is traced or sent.

Langfuse uses port 3000 by default, the same as this app, so run it on **3040** instead. You need [Docker](https://www.docker.com/products/docker-desktop/).

**1. Start Langfuse on your computer** (in a separate folder, not inside `haushaltsbuch`):

```bash
git clone https://github.com/langfuse/langfuse.git
cd langfuse
```

Open `docker-compose.yml`, find the line `- 3000:3000` under `langfuse-web`, and change it to `- 3040:3000`. Then:

```bash
NEXTAUTH_URL=http://localhost:3040 docker compose up -d
```

**2. Get keys.** Open [http://localhost:3040](http://localhost:3040), sign up (the account is local), create a project, then **Settings → API Keys → Create new API keys**.

**3. Add the keys.** In the `haushaltsbuch` folder:

```bash
cp .env.example .env.local
```

Paste the two keys into `.env.local`. `LANGFUSE_BASE_URL` already points to `http://localhost:3040`.

**4. Restart** `npm run dev`, send a chat message and open **Tracing** in Langfuse.

> Prefer not to run Docker? Use [Langfuse Cloud](https://cloud.langfuse.com) instead: skip step 1, get keys there, and switch `LANGFUSE_BASE_URL` in `.env.local` to the cloud line.

Each chat message and each statement import shows up as one trace. All messages from one conversation are grouped together. In a trace you can see:

- what was sent to the model, and what it answered
- each database query the model asked for, whether it was allowed, and the rows it got back
- the rows the model suggested, before and after the app checked them

> ⚠️ **Privacy:** with tracing on, prompts, SQL results (amounts, payees) and attached PDFs are sent to the Langfuse server you configured. API keys are masked. With Langfuse on your computer (steps above), nothing leaves it.

To turn it off, remove the two keys and restart. Full details: [docs/tracing.md](docs/tracing.md).

---

## Your data and privacy

| What | Where it's kept |
| --- | --- |
| Transactions, banks, categories, currency | SQLite file on your computer (`data/` is gitignored) |
| Assistant choice, API key, chat history | Your browser's `localStorage` |
| API key on the server | Never stored, logged, or written to the database |

- Amounts are signed: expenses are negative and income is positive.
- **Set up completely new** offers an Excel and SQLite backup first, then wipes and vacuums the file.

---

## Project layout

```
app/
  (tracker)/        chat, expenses, summary, insights pages
  setup/  data/     setup chat and "Your data" pages
  api/              all server routes (see table above)
components/         React UI (tracker, setup, data, nav)
lib/
  db.ts             SQLite schema and migrations
  llm/              model selection, tool loop, local PDF reading and OCR
  chat/             prompts, SQL guard, row validation, transactions
  data/             banks, ledger edits, summary maths, exports
  setup/            setup chat logic and guards
  tracing/          optional Langfuse integration
docs/               API and tracing reference
```

## Development

```bash
npm test        # schema, SQL guard, confirm/undo, PDF import, summaries, tracing
npm run lint
npm run build
```

Built with Next.js 15, React 19, the Vercel AI SDK, better-sqlite3 and unpdf.
