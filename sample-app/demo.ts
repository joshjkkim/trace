/**
 * SDK demo — runs a 3-step chained Anthropic workflow and sends traces
 * to the FastAPI backend at INGEST_URL.
 *
 * Usage:
 *   INGEST_URL=http://localhost:8000 npm run demo
 *
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config as loadEnv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { Tracer, getCost } from '@cernova/sdk';
import type { TracedMessageParams } from '@cernova/sdk';

loadEnv({ path: '.env.local' });
loadEnv();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — set it in .env.local and re-run.');
  process.exit(1);
}

const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:8000';

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractText(msg: Message): string {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
}

function printTrace(stepName: string, response: Message, latencyMs: number) {
  const { input_tokens, output_tokens } = response.usage;
  const total   = input_tokens + output_tokens;
  const cost    = getCost(response.model, input_tokens, output_tokens);
  console.log(`  model     ${response.model}`);
  console.log(`  tokens    ${input_tokens} in / ${output_tokens} out  (total ${total})`);
  console.log(`  latency   ${latencyMs}ms`);
  console.log(`  cost      $${cost.toFixed(6)}`);
  console.log(`  → sent trace "${stepName}" to ${INGEST_URL}/ingest`);
}

// ── Demo ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nIngest endpoint: ${INGEST_URL}/ingest`);
  console.log(`\n═══ CHAINED WORKFLOW ═══\n`);

  const tracer = new Tracer({ apiKey: 'trace_0AP1EwLHOHADG4WjrUyneCDBUszA6lbn', apiUrl: INGEST_URL });
  const anthropic = tracer.wrapAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

  // One run per chatbot turn — fresh run_id, step_index resets to 0
  const run = anthropic.run();
  console.log(`run_id: ${run.runId}\n`);

  // Step 1 — classify (step_index: 0)
  console.log('[1/3] classify-intent');
  let t = Date.now();
  const classifyRes = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Classify as "billing" or "support": "I need help with my bill"' }],
    _trace: { stepName: 'classify-intent' },
  } as TracedMessageParams);
  const intent = extractText(classifyRes).trim().toLowerCase();
  printTrace('classify-intent', classifyRes, Date.now() - t);
  console.log(`  output    "${intent}"\n`);

  // Step 2 — draft (step_index: 1)
  console.log('[2/3] draft-reply');
  t = Date.now();
  const draftRes = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    messages: [
      { role: 'user', content: 'I need help with my bill' },
      { role: 'assistant', content: `Classified as: ${intent}` },
      { role: 'user', content: `Write a brief, friendly ${intent} department reply in 2 sentences.` },
    ],
    _trace: { stepName: 'draft-reply' },
  } as TracedMessageParams);
  const draft = extractText(draftRes).trim();
  printTrace('draft-reply', draftRes, Date.now() - t);
  console.log(`  output    "${draft.slice(0, 80)}…"\n`);

  // Step 3 — proofread (step_index: 2)
  console.log('[3/3] proofread');
  t = Date.now();
  const proofRes = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 32,
    messages: [{ role: 'user', content: `Any grammar issues? Reply "ok" or describe:\n\n"${draft}"` }],
    _trace: { stepName: 'proofread' },
  } as TracedMessageParams);
  printTrace('proofread', proofRes, Date.now() - t);
  console.log(`  output    "${extractText(proofRes).trim()}"\n`);

  // Error path (step_index: 3)
  console.log('[+] bad-model-call  (error path)');
  try {
    await run.messages.create({
      model: 'claude-does-not-exist',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hello' }],
      _trace: { stepName: 'bad-model-call' },
    } as TracedMessageParams);
  } catch {
    console.log(`  → error trace sent to ${INGEST_URL}/ingest  (status_success: false)\n`);
  }

  console.log(`═══ DONE — check ${INGEST_URL}/traces or your Supabase CALLS table ═══`);
}

main().catch((err) => { console.error(err); process.exit(1); });