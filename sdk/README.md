# @trace-ai/sdk

TypeScript SDK for [trace.ai](https://trace-ai.com) — wraps LLM client calls to automatically capture tokens, latency, cost, and context utilisation, then streams traces to the trace.ai backend for anomaly detection.

---

## How it works

```
Your app  →  wrapped client  →  LLM provider (Anthropic, etc.)
                  ↓
          POST /ingest  →  trace.ai backend  →  anomaly engine  →  dashboard
```

The wrapper intercepts every `messages.create` call, measures wall-clock latency, extracts token usage from the response, computes cost, and fire-and-forgets a trace payload to the backend. The original response is returned to your app unchanged.

---

## Installation

```bash
npm install @trace-ai/sdk
```

`@anthropic-ai/sdk` must be installed separately in your app — it is a peer dependency.

```bash
npm install @anthropic-ai/sdk
```

---

## Quick start

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Tracer } from '@trace-ai/sdk';

const tracer = new Tracer({ apiKey: process.env.TRACE_API_KEY! });
const anthropic = tracer.wrapAnthropic(new Anthropic());

const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello!' }],
  _trace: { stepName: 'my-step' },   // optional — see below
});

// response is the normal Anthropic Message object — nothing changes for your code
```

---

## API

### `new Tracer(config)`

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | ✓ | Your trace.ai project API key |
| `runId` | `string` | | Groups multiple steps into one workflow run. Auto-generated UUID if omitted |
| `apiUrl` | `string` | | Override ingest endpoint. **Local dev only** — defaults to trace.ai servers |

```typescript
const tracer = new Tracer({
  apiKey: process.env.TRACE_API_KEY!,
  runId: requestId,               // pass your own ID to group steps per request
  apiUrl: 'http://localhost:8000', // only set this locally
});
```

### `tracer.wrapAnthropic(client)`

Returns a wrapped Anthropic client. The wrapped client's `messages.create` has the same signature as the original plus an optional `_trace` field.

```typescript
const anthropic = tracer.wrapAnthropic(new Anthropic());
```

### `_trace` option

Add `_trace` to any `messages.create` call to label the step. It is stripped before the request is sent to Anthropic — the provider never sees it.

```typescript
await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 128,
  messages: [...],
  _trace: { stepName: 'classify-intent' },
});
```

If `_trace` is omitted, `stepName` defaults to `'anthropic.messages.create'`.

### `tracer.runId`

Read-only. Useful for passing the same `runId` to your own logging or to the backend.

```typescript
console.log(tracer.runId); // e.g. "a2d6c587-ef16-4260-86c4-37a0e28b0a6a"
```

### `getCost(model, inputTokens, outputTokens)`

Exported utility — returns the USD cost for a given model and token count using the same pricing table the SDK uses internally. Returns `0` for unknown models.

```typescript
import { getCost } from '@trace-ai/sdk';

const cost = getCost('claude-haiku-4-5-20251001', 500, 120); // → 0.000880
```

---

## What gets traced

Every successful call sends this payload to `POST /ingest`:

| Field | Type | Source |
|---|---|---|
| `run_id` | `string` | `tracer.runId` |
| `step_name` | `string` | `_trace.stepName` or `'anthropic.messages.create'` |
| `model` | `string` | `response.model` (what Anthropic actually used, not what was requested) |
| `prompt` | `string` | `JSON.stringify({ system, messages })` — includes the system prompt |
| `input_tokens` | `number` | `response.usage.input_tokens` |
| `output_tokens` | `number` | `response.usage.output_tokens` |
| `total_tokens` | `number` | `input_tokens + output_tokens` |
| `latency_ms` | `number` | wall-clock ms from call start to response |
| `cost_usd` | `number` | computed from static model pricing table; `0` for unknown models |
| `context_limit` | `number?` | static context window for the model; `undefined` for unknown models |
| `context_utilization` | `number?` | `total_tokens / context_limit`; `undefined` if limit unknown |
| `status` | `'success' \| 'error'` | |
| `error` | `string?` | error message if the call threw |

On error the trace is still sent with `status: 'error'`, all token fields `0`, and `cost_usd: 0`, then the original exception is re-thrown to your code.

---

## Multi-step workflows

Pass the same `runId` across steps so the backend can group them into one workflow run for anomaly detection.

```typescript
// Option 1 — let the Tracer generate a run ID and reuse the same instance
const tracer = new Tracer({ apiKey: process.env.TRACE_API_KEY! });
const anthropic = tracer.wrapAnthropic(new Anthropic());

const step1 = await anthropic.messages.create({ ..., _trace: { stepName: 'classify' } });
const step2 = await anthropic.messages.create({ ..., _trace: { stepName: 'draft' } });
// Both land under tracer.runId

// Option 2 — supply your own run ID (e.g. tied to an HTTP request ID)
const tracer = new Tracer({ apiKey: process.env.TRACE_API_KEY!, runId: req.headers['x-request-id'] });
```

---

## Ingest is fire-and-forget

The `POST /ingest` call never blocks your app. If the request fails (network error, backend down), a warning is logged to `console.warn` and your app continues normally.

---

## Supported providers

| Provider | Method wrapped | Status |
|---|---|---|
| Anthropic | `messages.create` (non-streaming) | ✓ v0.1 |
| OpenAI | `chat.completions.create` | planned |
| Google Gemini | `generateContent` | planned |

---

## Environment variables

```bash
# Required — your trace.ai project key
TRACE_API_KEY=trace_...

# Your app's LLM key — read by the provider SDK, never by @trace-ai/sdk
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Development (contributing to the SDK)

```bash
cd sdk
npm install
npm run build      # compile src/ → dist/
npm run dev        # watch mode — rebuilds on save
npm run typecheck  # tsc --noEmit, no output = clean
```

After any change to `sdk/src/`, run `npm run build`. The sample app reads from `sdk/dist/` so the new build is picked up automatically — no reinstall needed.

### Running the sample app

```bash
cd sample-app
cp .env.local.example .env.local   # add your ANTHROPIC_API_KEY
npm install
npm run demo
```

The demo starts a local mock ingest server on port 8000, fires a 3-step chained workflow, and prints each trace as it arrives. A `[VERIFY]` line after each step confirms the traced token counts, model, and cost match the raw Anthropic response. It also exercises the error path and verifies the SDK does not throw when the ingest endpoint is down.

### Repo layout

```
sdk/
├── src/
│   ├── index.ts          public exports
│   ├── types.ts          TraceConfig, TracePayload, TraceOptions
│   ├── tracer.ts         Tracer class
│   ├── cost.ts           model → pricing table
│   └── wrappers/
│       └── anthropic.ts  Anthropic wrapper + TracedAnthropic types
├── dist/                 compiled output (gitignored)
└── package.json

sample-app/
├── demo.ts               end-to-end demo with live verification
└── package.json
```

### Adding a new provider wrapper

1. Create `sdk/src/wrappers/<provider>.ts`
2. Define a structural interface for the client (`ProviderClientLike`) — don't import the provider class directly
3. Return a plain object matching the provider's method signatures, intercepting the create call the same way `anthropic.ts` does
4. Add a `wrap<Provider>` method to `Tracer` in `tracer.ts`
5. Export the new types from `index.ts`
