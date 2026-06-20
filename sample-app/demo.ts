import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { config as loadEnv } from 'dotenv';
import { Tracer, getCost } from '@trace-ai/sdk';
import type { TracedMessageParams } from '@trace-ai/sdk';

loadEnv({ path: '.env.local' });
loadEnv();

// ── Mock ingest server ──────────────────────────────────────────────────────

interface ReceivedTrace {
  step_name: string;
  run_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_usd: number;
  context_utilization?: number;
  status: string;
  error?: string;
}

const receivedTraces = new Map<string, ReceivedTrace>();

// Fix #4 — promise-based sync: resolvers keyed by step_name
const pendingResolvers = new Map<string, () => void>();

// Fix #5 — flag to simulate ingest failures
let forceIngestError = false;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/ingest') {
    // Fix #5 — return 500 when flag is set
    if (forceIngestError) {
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const p = JSON.parse(body) as ReceivedTrace;
      receivedTraces.set(p.step_name, p);

      const divider = '─'.repeat(52);
      console.log(`\n┌ ${divider}`);
      console.log(`│  TRACE  ${p.step_name}`);
      console.log(`├ ${divider}`);
      console.log(`│  run_id   ${p.run_id}`);
      console.log(`│  model    ${p.model}`);
      console.log(`│  tokens   ${p.input_tokens} in / ${p.output_tokens} out  (total ${p.total_tokens})`);
      console.log(`│  latency  ${p.latency_ms}ms`);
      console.log(`│  cost     $${Number(p.cost_usd).toFixed(6)}`);
      if (p.context_utilization !== undefined) {
        console.log(`│  ctx      ${(p.context_utilization * 100).toFixed(2)}% of context window used`);
      }
      console.log(`│  status   ${p.status}${p.error ? ` — ${p.error}` : ''}`);
      console.log(`└ ${divider}`);

      // Fix #4 — resolve any waiter for this step
      pendingResolvers.get(p.step_name)?.();
      pendingResolvers.delete(p.step_name);

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractText(msg: Message): string {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
}

// Fix #4 — wait for the ingest POST to arrive instead of sleeping
function waitForTrace(stepName: string, timeoutMs = 5000): Promise<void> {
  if (receivedTraces.has(stepName)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolvers.delete(stepName);
      reject(new Error(`Timed out waiting for trace: ${stepName}`));
    }, timeoutMs);
    pendingResolvers.set(stepName, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Fix #3 + #6 — use SDK's getCost() and check total_tokens
function verify(stepName: string, response: Message) {
  const trace = receivedTraces.get(stepName);
  if (!trace) {
    console.log(`  [VERIFY] ${stepName}: ✗ no trace received`);
    return;
  }

  const actual = response.usage;

  const tokenOk =
    trace.input_tokens === actual.input_tokens &&
    trace.output_tokens === actual.output_tokens;

  // Fix #6 — verify total_tokens equals the sum
  const totalOk = trace.total_tokens === actual.input_tokens + actual.output_tokens;

  const modelOk = trace.model === response.model;

  // Fix #3 — use SDK's getCost() so pricing is always in sync
  const costExpected = getCost(response.model, actual.input_tokens, actual.output_tokens);
  const costOk = Math.abs(trace.cost_usd - costExpected) < 0.000001;

  const allOk = tokenOk && totalOk && modelOk && costOk;
  console.log(`  [VERIFY] ${stepName}: ${allOk ? '✓ all fields match' : '✗ MISMATCH'}`);
  if (!tokenOk) {
    console.log(`           tokens    trace=${trace.input_tokens}/${trace.output_tokens}  actual=${actual.input_tokens}/${actual.output_tokens}`);
  }
  if (!totalOk) {
    console.log(`           total     trace=${trace.total_tokens}  expected=${actual.input_tokens + actual.output_tokens}`);
  }
  if (!modelOk) {
    console.log(`           model     trace=${trace.model}  actual=${response.model}`);
  }
  if (!costOk) {
    console.log(`           cost      trace=${trace.cost_usd}  expected=${costExpected.toFixed(6)}`);
  }
}

// ── Demo ────────────────────────────────────────────────────────────────────

server.listen(8000, async () => {
  console.log('Mock ingest server  →  http://localhost:8000/ingest\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY — set it in .env.local and re-run.');
    server.close();
    return;
  }

  const tracer = new Tracer({ apiKey: 'demo-key', apiUrl: 'http://localhost:8000' });
  const client = tracer.wrapAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

  // ── Chained workflow: classify → draft → proofread ───────────────────────
  console.log('═══ CHAINED WORKFLOW (3 steps, same run_id) ═══\n');

  console.log('[1/3] classify-intent');
  const classifyParams: TracedMessageParams = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Classify this as "billing" or "support": "I need help with my bill"' }],
    _trace: { stepName: 'classify-intent' },
  };
  const classifyRes = await client.messages.create(classifyParams);
  const intent = extractText(classifyRes).trim().toLowerCase();
  console.log(`  → "${intent}"  (${classifyRes.usage.input_tokens} in / ${classifyRes.usage.output_tokens} out)`);
  await waitForTrace('classify-intent'); // Fix #4
  verify('classify-intent', classifyRes);

  console.log('\n[2/3] draft-reply  (uses step 1 output)');
  const draftParams: TracedMessageParams = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    messages: [
      { role: 'user', content: 'I need help with my bill' },
      { role: 'assistant', content: `Classified as: ${intent}` },
      { role: 'user', content: `Write a brief, friendly ${intent} department reply in 2 sentences.` },
    ],
    _trace: { stepName: 'draft-reply' },
  };
  const draftRes = await client.messages.create(draftParams);
  const draft = extractText(draftRes).trim();
  console.log(`  → "${draft}"`);
  console.log(`     (${draftRes.usage.input_tokens} in / ${draftRes.usage.output_tokens} out)`);
  await waitForTrace('draft-reply');
  verify('draft-reply', draftRes);

  console.log('\n[3/3] proofread  (uses step 2 output)');
  const proofParams: TracedMessageParams = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [
      { role: 'user', content: `Does this reply have any grammar issues? Reply with just "ok" or describe the issue:\n\n"${draft}"` },
    ],
    _trace: { stepName: 'proofread' },
  };
  const proofRes = await client.messages.create(proofParams);
  console.log(`  → "${extractText(proofRes).trim()}"`);
  console.log(`     (${proofRes.usage.input_tokens} in / ${proofRes.usage.output_tokens} out)`);
  await waitForTrace('proofread');
  verify('proofread', proofRes);

  // ── Error path ───────────────────────────────────────────────────────────
  console.log('\n[+] bad-model-call  (verifying error trace)');
  try {
    await client.messages.create({
      model: 'claude-does-not-exist',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hello' }],
      _trace: { stepName: 'bad-model-call' },
    });
  } catch {
    // expected — SDK re-throws, we swallow here
  }
  await waitForTrace('bad-model-call');
  const errTrace = receivedTraces.get('bad-model-call')!;
  const errorOk = errTrace.status === 'error' && errTrace.total_tokens === 0 && errTrace.cost_usd === 0;
  console.log(`  [VERIFY] bad-model-call: ${errorOk ? '✓ correct error trace' : '✗ unexpected error trace shape'}`);

  // Fix #5 — ingest failure: SDK must not throw to caller
  console.log('\n[+] ingest-failure  (verifying SDK is resilient when backend is down)');
  forceIngestError = true;
  let callerThrewOnIngestFailure = false;
  try {
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ping' }],
      _trace: { stepName: 'ingest-failure-test' },
    });
  } catch {
    callerThrewOnIngestFailure = true;
  }
  forceIngestError = false;
  console.log(`  [VERIFY] ingest-failure: ${!callerThrewOnIngestFailure ? '✓ caller did not throw' : '✗ SDK threw to caller — bug!'}`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══ SUMMARY ═══');
  console.log(`run_id:          ${tracer.runId}`);
  console.log(`traces received: ${receivedTraces.size}`);
  let totalTokens = 0, totalCost = 0;
  for (const t of receivedTraces.values()) {
    totalTokens += t.total_tokens;
    totalCost += t.cost_usd;
  }
  console.log(`total tokens:    ${totalTokens}`);
  console.log(`total cost:      $${totalCost.toFixed(6)}`);

  server.close();
});