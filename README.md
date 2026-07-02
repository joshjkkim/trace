# Cernova

Datadog + Sentry for AI workflows. Wraps LLM calls to capture tokens, latency, and cost in real time, streams traces to a FastAPI backend, and displays them live on a Next.js dashboard.

## Repo layout

| Directory | What it is |
|---|---|
| `sdk/` | TypeScript tracing SDK (`/sdk`) |
| `backend/` | FastAPI ingest API + Supabase integration |
| `frontend/` | Next.js live dashboard (Supabase Realtime) |
| `sample-app/` | End-to-end demo using the SDK against the real backend |

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- A [Supabase](https://supabase.com) project with a `CALLS` table
- An Anthropic API key (for the demo)

---

## One-time setup

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r ../requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # Settings → API → service_role key
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # Settings → API → anon key
```

### 3. SDK (build once, or after any change to sdk/src/)

```bash
cd sdk
npm install
npm run build
```

### 4. Sample app

```bash
cd sample-app
npm install
cp .env.local.example .env.local
```

Edit `sample-app/.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Running everything

All commands run from the **repo root**:

```bash
# Terminal 1 — FastAPI backend on :8000
npm run backend

# Terminal 2 — Next.js dashboard on :3000
npm run frontend

# Terminal 3 — SDK demo (real Anthropic calls → backend → Supabase → dashboard)
npm run demo

# Or seed the CALLS table with synthetic data
npm run seed
```

---

## How it works

```
Your app
  └─ /sdk (wrapAnthropic)
       ├─ calls Anthropic normally → returns response unchanged
       └─ fire-and-forget POST /ingest → FastAPI backend
                                              └─ Supabase INSERT into CALLS
                                                      └─ Realtime → Next.js dashboard
```

Every `messages.create` call is intercepted, wall-clock latency is measured, token usage and cost are extracted from the response, and a trace payload is sent to `/ingest` without blocking the caller.