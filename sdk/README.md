# @trace-ai/sdk

Observability for AI workflows. Wraps Anthropic's `messages.create` and `messages.stream` to automatically capture tokens, latency, cost, and anomalies — then sends traces to your [trace.ai](https://trace.ai) dashboard.

## Install

```bash
npm install @trace-ai/sdk @anthropic-ai/sdk
```

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
  _trace: { stepName: 'my-step' },
});
// response is the normal Anthropic Message — your code is unchanged
```

## Multi-step runs

Group multiple LLM calls into a single traced run so you can see the full pipeline in the dashboard:

```typescript
const run = anthropic.run();

const step1 = await run.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'Classify this: "refund request"' }],
  _trace: { stepName: 'classify' },
});

const step2 = await run.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{ role: 'user', content: `Reply to a ${text(step1)} inquiry.` }],
  _trace: { stepName: 'generate-reply' },
});

console.log(run.runId); // same run_id groups both steps in the dashboard
```

## Streaming

`messages.stream` is fully supported — tokens and latency are captured after the stream ends with zero impact on streaming latency:

```typescript
const stream = run.messages.stream({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  _trace: { stepName: 'story' },
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
// trace is ingested automatically once stream completes
```

## API

### `new Tracer(config)`

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | yes | Your trace.ai project API key |
| `apiUrl` | `string` | | Override ingest URL — defaults to trace.ai's servers |
| `runId` | `string` | | Custom run ID — auto-generated UUID if omitted |

### `tracer.wrapAnthropic(client)`

Returns a wrapped client with `.messages.create()`, `.messages.stream()`, and `.run()`.

### `anthropic.run()`

Creates a `TracedRun` — a fresh `run_id` that groups all steps called on it. Each call to `run()` resets the step index to 0.

### `_trace` option

```typescript
_trace: {
  stepName?: string;  // label shown in the dashboard (default: step_1, step_2, …)
}
```

Stripped before forwarding to Anthropic — the provider never sees it.

## What gets captured

| Field | Source |
|---|---|
| `run_id` | `run.runId` or `tracer.runId` |
| `step_name` | `_trace.stepName` |
| `model` | `response.model` |
| `input_tokens` / `output_tokens` | `response.usage` |
| `latency_ms` | wall-clock ms |
| `cost` | computed from built-in pricing table |
| `status_success` | `true` on success, `false` on thrown error |
| `output_code` | full text content from response |
| `error` | error message if the call threw |

## Ingest is fire-and-forget

The POST to `/ingest` never blocks your app. Network failures are logged to `console.warn` and silently dropped — your LLM calls always complete normally.

## Dashboard

View traces, anomaly scores, AI-powered run analysis, and cost breakdowns at [trace.ai](https://trace.ai).
