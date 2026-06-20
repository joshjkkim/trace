# Sample App Demo

End-to-end demo for the `@trace-ai/sdk`. Runs a real multi-step Anthropic workflow against a local mock ingest server so you can see exactly what trace payloads look like before connecting to the real backend.

---

## What the demo does

1. Starts a local HTTP server on port 8000 that acts as the ingest endpoint
2. Wraps a real Anthropic client with the trace.ai SDK
3. Runs a 3-step chained workflow where each step feeds into the next
4. Verifies every trace payload matches the raw Anthropic response
5. Exercises the error path (bad model name)
6. Exercises ingest resilience (backend returns 500 — SDK must not throw)
7. Prints a summary of total tokens and cost across the run

---

## Chained workflow

| Step | `stepName` | What it does |
|---|---|---|
| 1 | `classify-intent` | Classifies user message as `billing` or `support` |
| 2 | `draft-reply` | Uses step 1's classification to draft a reply |
| 3 | `proofread` | Uses step 2's draft to check grammar |

All 3 steps share the same `run_id` — this is how the anomaly engine groups them into one workflow.

---

## What gets verified

After each successful step, `[VERIFY]` cross-checks the received trace payload against the raw Anthropic response:

| Check | What it confirms |
|---|---|
| `input_tokens` + `output_tokens` | Exact match with `response.usage` |
| `total_tokens` | Equals `input_tokens + output_tokens` |
| `model` | Matches `response.model` (the model Anthropic actually used) |
| `cost_usd` | Matches `getCost(model, input, output)` from the SDK's pricing table |

For the error step, it confirms `status === 'error'`, `total_tokens === 0`, and `cost_usd === 0`.

For the ingest-failure step, it confirms the caller's `await create()` does not throw even when the backend returns 500.

---

## Setup

```bash
cd sample-app
cp .env.local.example .env.local    # then add your real key
npm install
```

`.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

`TRACE_API_KEY` is not needed — the demo sets it to `'demo-key'` since traces go to localhost, not the real backend.

---

## Run

```bash
npm run demo
```

---

## Expected output

```
Mock ingest server  →  http://localhost:8000/ingest

═══ CHAINED WORKFLOW (3 steps, same run_id) ═══

[1/3] classify-intent
  → "billing"  (26 in / 16 out)
┌ ────────────────────────────────────────────────────
│  TRACE  classify-intent
│  ...
└ ────────────────────────────────────────────────────
  [VERIFY] classify-intent: ✓ all fields match

[2/3] draft-reply  (uses step 1 output)
  ...
  [VERIFY] draft-reply: ✓ all fields match

[3/3] proofread  (uses step 2 output)
  ...
  [VERIFY] proofread: ✓ all fields match

[+] bad-model-call  (verifying error trace)
  [VERIFY] bad-model-call: ✓ correct error trace

[+] ingest-failure  (verifying SDK is resilient when backend is down)
  [VERIFY] ingest-failure: ✓ caller did not throw

═══ SUMMARY ═══
run_id:          <uuid>
traces received: 4
total tokens:    251
total cost:      $0.000447
[trace-ai] ingest failed: ...    ← expected console.warn from the ingest-failure test
```

The `[trace-ai] ingest failed` at the end is expected — it is the SDK's `console.warn` from the ingest-failure test, printed after the server closes.

---

## Notes

- Anthropic calls are **real** — you will be charged a fraction of a cent per run (typically under $0.001).
- The `[VERIFY]` checks use `getCost()` from the SDK directly, so they stay in sync with the SDK's pricing table automatically.
- Trace payloads include the full `system` prompt (if any) alongside `messages` — this is what the anomaly engine uses to detect bloated system prompts.
- Verification waits on a promise resolved by the server rather than an arbitrary sleep, so it is not affected by machine load or network latency.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing ANTHROPIC_API_KEY` | Create `.env.local` with your key (see Setup above) |
| `Authentication fails` | Verify the key is active at console.anthropic.com |
| `Port 8000 already in use` | Kill whatever is on 8000: `lsof -ti:8000 \| xargs kill` |
| `Timed out waiting for trace` | The ingest POST took over 5 seconds — check for network issues |
| `[VERIFY] ✗ MISMATCH` | The SDK extracted wrong data from the response — file a bug with the step name and mismatch detail |
