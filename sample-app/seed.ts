/**
 * Seed script — generates TracePayload batches, writes to payloads.json,
 * and optionally POSTs each one to /ingest.
 *
 * Usage:
 *   npx tsx seed.ts                          # generate + send (default 30 runs)
 *   npx tsx seed.ts --runs 100               # generate + send 100 runs
 *   npx tsx seed.ts --file-only              # write payloads.json, do not send
 *   INGEST_URL=http://... npx tsx seed.ts    # override endpoint
 */

import fs from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { getCost } from '@cernova/sdk';

loadEnv({ path: '.env.local' });
loadEnv();

const args = process.argv.slice(2);
const FILE_ONLY = args.includes('--file-only');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag !== -1 ? parseInt(args[runsFlag + 1], 10) : 30;
const INGEST_URL = (process.env.INGEST_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const CERNOVA_API_KEY = process.env.CERNOVA_API_KEY ?? 'seed-key';
const OUT_FILE = 'payloads.json';

// ── Types ────────────────────────────────────────────────────────────────────

interface TracePayload {
  run_id: string;
  step_name: string;
  model: string;
  prompt: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost: number;
  status_success: boolean;
  output_code?: string;
  project_id?: number;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Workflow definition ───────────────────────────────────────────────────────

const CONTEXT_WINDOW = 200_000;

const STEPS = [
  { name: 'classify-intent', model: 'claude-haiku-4-5-20251001', inputRange: [20, 60]   as [number,number], outputRange: [4, 20]   as [number,number], latencyRange: [200, 800]  as [number,number] },
  { name: 'draft-reply',     model: 'claude-haiku-4-5-20251001', inputRange: [50, 150]  as [number,number], outputRange: [40, 120] as [number,number], latencyRange: [400, 1400] as [number,number] },
  { name: 'proofread',       model: 'claude-haiku-4-5-20251001', inputRange: [60, 200]  as [number,number], outputRange: [2, 10]   as [number,number], latencyRange: [200, 700]  as [number,number] },
];

// ── Payload generators ────────────────────────────────────────────────────────

function makeNormal(runId: string, step: typeof STEPS[number]): TracePayload {
  const input_tokens  = randInt(...step.inputRange);
  const output_tokens = randInt(...step.outputRange);
  const total_tokens  = input_tokens + output_tokens;
  return {
    run_id: runId,
    step_name: step.name,
    model: step.model,
    prompt: JSON.stringify({ messages: [{ role: 'user', content: `Sample prompt for ${step.name}` }] }),
    input_tokens,
    output_tokens,
    total_tokens,
    latency_ms: randInt(...step.latencyRange),
    cost: getCost(step.model, input_tokens, output_tokens),
    status_success: true,
    output_code: `Sample output for ${step.name}`,
  };
}

function makeAnomalous(runId: string, step: typeof STEPS[number]): TracePayload {
  const mul = randInt(4, 8);
  const input_tokens  = randInt(...step.inputRange)  * mul;
  const output_tokens = randInt(...step.outputRange) * mul;
  const total_tokens  = input_tokens + output_tokens;
  return {
    run_id: runId,
    step_name: step.name,
    model: step.model,
    prompt: JSON.stringify({
      system: 'A very verbose system prompt accidentally added to the request. '.repeat(40),
      messages: [{ role: 'user', content: 'Sample prompt with bloated context' }],
    }),
    input_tokens,
    output_tokens,
    total_tokens,
    latency_ms: randInt(...step.latencyRange) * mul,
    cost: getCost(step.model, input_tokens, output_tokens),
    status_success: true,
    output_code: `Anomalous output for ${step.name}`,
  };
}

function makeError(runId: string, step: typeof STEPS[number]): TracePayload {
  return {
    run_id: runId,
    step_name: step.name,
    model: step.model,
    prompt: JSON.stringify({ messages: [{ role: 'user', content: 'Sample prompt' }] }),
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    latency_ms: randInt(100, 300),
    cost: 0,
    status_success: false,
    error: 'rate_limit_exceeded: Too many requests',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const payloads: TracePayload[] = [];

  for (let i = 0; i < RUNS; i++) {
    const runId = uuid();
    const isAnomaly = i >= RUNS - 2;
    const isError   = i === RUNS - 3;

    for (const step of STEPS) {
      if (isAnomaly) {
        payloads.push(makeAnomalous(runId, step));
      } else if (isError && step.name === 'draft-reply') {
        payloads.push(makeError(runId, step));
      } else {
        payloads.push(makeNormal(runId, step));
      }
    }
  }

  // Write JSON file
  fs.writeFileSync(OUT_FILE, JSON.stringify(payloads, null, 2));
  console.log(`wrote ${payloads.length} payloads to ${OUT_FILE}`);

  if (FILE_ONLY) return;

  // Send each payload
  console.log(`sending to ${INGEST_URL}/ingest ...`);
  let ok = 0, fail = 0;
  for (const payload of payloads) {
    const res = await fetch(`${INGEST_URL}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CERNOVA_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) { ok++; } else { fail++; console.warn(`  HTTP ${res.status} on ${payload.step_name}`); }
  }
  console.log(`done — ${ok} sent, ${fail} failed`);
}

main().catch((err) => { console.error(err); process.exit(1); });