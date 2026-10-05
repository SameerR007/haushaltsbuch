# Haushaltsbuch

Local expense tracker. This repo currently ships the landing page only. Chat, setup, insights, and Supabase are not implemented.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Landing states

The welcome screen picks first visit or returning from `localStorage`. There is no toggle on the page.

| | |
| --- | --- |
| **Key** | `haushaltsbuch.connection` |
| **Missing or `""`** | First visit. **Get started** links to `/setup`. |
| **Any non-empty string** | Returning. **Open tracker** links to `/app`. **Set up again** links to `/setup`. |

The key is read in `app/layout.tsx` before first paint (`html[data-visit="returning"]`). The constant lives in `lib/connection.ts`. Nothing in the app writes the key yet.

Preview the returning screen in the browser console, then reload:

```js
localStorage.setItem("haushaltsbuch.connection", "1")
```

Return to the first-visit screen with:

```js
localStorage.removeItem("haushaltsbuch.connection")
```

## Routes

- `/` — landing
- `/setup` — stub
- `/app` — stub
