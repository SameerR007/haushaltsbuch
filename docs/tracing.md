# Tracing with Langfuse

Optional. Tracing is off unless both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set when the server starts. Without them nothing is registered, nothing is exported, and the app behaves exactly as before.

When it is on, every chat message and every statement import becomes one trace in [Langfuse](https://langfuse.com), so you can audit what the assistant was asked, what it was given, which SQL it ran, and what came back.

## Turn it on

1. Create a Langfuse project, either on [Langfuse Cloud](https://cloud.langfuse.com) or [self-hosted](https://langfuse.com/self-hosting) (for example `docker compose up` from the Langfuse repository, which serves `http://localhost:3000`, so start this app on another port).
2. In the project settings, create an API key pair.
3. Put the keys in `.env.local` in the repository root (gitignored by `.env*`):

```bash
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_SECRET_KEY="sk-lf-..."
# EU cloud (default). US: https://us.cloud.langfuse.com. Self-hosted: your URL.
LANGFUSE_BASE_URL="https://cloud.langfuse.com"
# Optional, shown as the trace environment. Default: local
# LANGFUSE_TRACING_ENVIRONMENT="local"
```

4. Restart `npm run dev` (or `npm run build && npm start`). Send a chat message and open **Tracing** in Langfuse.

To turn it off again, remove the two keys and restart.

## What a trace shows

Each request is one trace. Turns of the same conversation share a **session** (the browser creates a random id per conversation and **New chat** starts a new one), so Langfuse **Sessions** shows a whole chat in order.

```
chat-turn                         agent      user messages in, reply and proposed row count out
└─ invoke_agent <model>                      the AI SDK generateText call
   ├─ step 1
   │  ├─ chat <model>             generation system prompt, messages, tool definitions, response, tokens
   │  └─ execute_tool run_sql     tool       SQL the model wrote, result sent back to the model
   │     ├─ sql-guard             guardrail  allowed, or the error the model saw
   │     └─ sql-execute                      columns, rows, truncated, durationMs, rowCount
   └─ step 2
      └─ chat <model>             generation final answer
└─ review-rows                               propose_transactions arguments in, validated review rows out
```

A statement import is the same shape under a `pdf-import` trace, with `propose_transactions` as the only tool.

| Trace name | Route | Tags |
| --- | --- | --- |
| `chat-turn` | `POST /api/chat` | `chat` plus `openai`, `local`, or `endpoint` |
| `pdf-import` | `POST /api/import/pdf` | `pdf` plus the assistant type |
| `pdf-read` | `POST /api/import/pdf` with `step=read` (Import, local only) | `pdf`, `local` |
| `pdf-propose` | `POST /api/import/pdf` with `step=propose` (the user's note, local only) | `pdf`, `local` |

Model calls are recorded through the AI SDK telemetry integration (`@langfuse/vercel-ai-sdk`), with `functionId` `haushaltsbuch-chat` or `haushaltsbuch-pdf`. The SQL guard, the query process, and row validation are recorded with `@langfuse/tracing`.

Confirm, undo, edits, exports, and setup are not traced. They do not call the model.

## What leaves this computer

With tracing on, the trace content is sent to the Langfuse server you configured:

- the household instructions (currency, categories, bank names, today's date)
- the conversation sent to the model, and the model's replies
- SQL queries and their result rows, which can include amounts and descriptions
- proposed and validated transaction rows
- for a statement import, the PDF itself as part of the model input

API keys are not sent. The OpenAI or endpoint key is never put in a span, and every exported attribute is also passed through a mask that replaces anything shaped like `sk-…` or `Bearer …` with `[redacted]`. The database path is not sent.

If money data must stay on this machine, run Langfuse self-hosted on this machine and point `LANGFUSE_BASE_URL` at it.

## Files

| File | Role |
| --- | --- |
| `instrumentation.ts` | Next.js startup hook. Loads the tracing setup on the Node.js runtime. |
| `lib/tracing/register.ts` | Registers the OpenTelemetry provider, the `LangfuseSpanProcessor` with the secret mask, and the AI SDK integration. Does nothing without keys. |
| `lib/tracing/langfuse.ts` | `withTrace`, `withSpan`, the flush after each request, and the mask. Each helper runs the callback directly when tracing is off. |
