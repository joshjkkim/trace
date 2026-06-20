# trace.ai

Datadog + Sentry for AI workflows. Wraps LLM calls to capture tokens, latency, and cost in real time, detects anomalies statistically and via ML, and surfaces root-cause diagnoses on a live dashboard.

See [ANOMALY_COPILOT.md](./ANOMALY_COPILOT.md) for the full architecture and hackathon build plan.

---

## Repo layout

| Directory | What it is |
|---|---|
| `sdk/` | TypeScript tracing SDK — `npm install @trace-ai/sdk` |
| `sample-app/` | End-to-end demo that runs a traced Anthropic workflow locally |
| `backend/` | FastAPI ingest API + anomaly engine + scheduler *(coming)* |
| `frontend/` | Next.js dashboard *(coming)* |
| `supabase/` | SQL migrations + seed script *(coming)* |

---

## Quickstart (SDK)

```bash
npm install @trace-ai/sdk
```

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
```

See [`sdk/README.md`](./sdk/README.md) for the full API reference.

---

## Running the demo

```bash
cd sample-app
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY
npm install && npm run demo
```

See [`sample-app/README.md`](./sample-app/README.md) for expected output and troubleshooting.