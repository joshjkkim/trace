# Cernova — Sample App

End-to-end demo: runs a real 3-step Anthropic workflow, sends traces to the FastAPI backend, and you can watch them appear live in the dashboard.

## Setup

```bash
cd sample-app
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

The backend must be running first (`npm run backend` from the repo root).

## Run

```bash
# From repo root (starts demo pointing at localhost:8000):
npm run demo

# Or seed the DB with 30 synthetic runs:
npm run seed
```

## What the demo does

Runs a 3-step chained workflow — each step feeds its output into the next:

| Step | `stepName` | What it does |
|---|---|---|
| 1 | `classify-intent` | Classifies message as `billing` or `support` |
| 2 | `draft-reply` | Uses step 1 output to draft a reply |
| 3 | `proofread` | Checks step 2 draft for grammar |

All 3 steps share the same `run_id`. The demo also fires a bad model call to verify the error trace (`status_success: false`) is recorded.

Anthropic calls are real — cost is typically under $0.001 per run.

## Seed script

Generates synthetic payloads (30 normal runs + 2 anomalous + 1 error) and POSTs them all to `/ingest`:

```bash
npm run seed                        # send 30 runs
npm run seed -- --runs 100          # send 100 runs
npm run seed -- --file-only         # write payloads.json, don't send
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing ANTHROPIC_API_KEY` | Add it to `sample-app/.env.local` |
| `Internal Server Error` from backend | Check `backend/.env` has correct `SUPABASE_SERVICE_KEY` |
| Nothing appears in dashboard | Confirm Supabase Realtime is enabled for the `CALLS` table |
