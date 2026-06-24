/**
 * Demo chatbot — customer support agent for "Acme AI" (fictional).
 * Each user message runs a 3-step traced workflow:
 *   classify-intent → extract-context → generate-reply
 *
 * Usage:
 *
 * Then open http://localhost:3001
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { Tracer } from '@trace-ai/sdk';
import type { TracedMessageParams } from '@trace-ai/sdk';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

const PORT       = 3001;
const INGEST_URL = process.env.INGEST_URL;
const API_KEY    = process.env.TRACE_API_KEY ?? '';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — set it in .env.local');
  process.exit(1);
}

const tracer    = new Tracer({ apiKey: API_KEY, apiUrl: INGEST_URL });
const anthropic = tracer.wrapAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function text(msg: Message): string {
  return msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

// ── Workflow ──────────────────────────────────────────────────────────────────

interface HistoryItem { role: 'user' | 'assistant'; content: string }

// L1 hard: status failure + error message → codes 1001+1002 (200pts, critical)
async function triggerL1Failure(stepName: string) {
  const runId = crypto.randomUUID();
  await tracer.ingest({
    run_id: runId, step_name: stepName, step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Retrieve the user account details.',
    input_tokens: 15, output_tokens: 0, total_tokens: 15,
    latency_ms: 230, cost: 0,
    status_success: false,
    error: 'Connection timeout after 3 retries',
  });
  return runId;
}

// L1 hard: token accounting ghost → code 1007 (100pts, critical)
// total_tokens doesn't equal input+output — numbers were recorded wrong
async function triggerL1TokenGhost() {
  const runId = crypto.randomUUID();
  await tracer.ingest({
    run_id: runId, step_name: 'summarize', step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Summarize this in one sentence.',
    input_tokens: 10, output_tokens: 5, total_tokens: 99,
    latency_ms: 180, cost: 0.001,
    status_success: true,
    output_code: 'The customer wants a refund.',
  });
  return runId;
}

// L2+L3: JSON contract violation + unbalanced bracket + shape mismatch
// → codes 2001 (50) + 3011 (25) + 3014 (30) = 105pts, critical
async function triggerL2Json() {
  const runId = crypto.randomUUID();
  await tracer.ingest({
    run_id: runId, step_name: 'extract-entities', step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Extract entities and respond in JSON with fields: name, intent, confidence.',
    input_tokens: 25, output_tokens: 40, total_tokens: 65,
    latency_ms: 310, cost: 0.0005,
    status_success: true,
    output_code: '{"name": "Alice", "intent": "billing", "confidence": 0.92',
  });
  return runId;
}

// L2+L3+L4: classify step returns prose instead of a category
// → codes 2003 (35) + 3014 (30) + 4005 (25) + 4006 (20) = 110pts, critical
async function triggerL3Shape() {
  const runId = crypto.randomUUID();
  const longOutput = 'Based on my analysis of the support message, I believe the customer is experiencing a billing issue related to their subscription renewal. The message clearly indicates frustration with unexpected charges appearing on their account statement.';
  await tracer.ingest({
    run_id: runId, step_name: 'classify-intent', step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Classify this message as exactly one of: billing, technical, general. Reply with just the category.',
    input_tokens: 20, output_tokens: 60, total_tokens: 80,
    latency_ms: 400, cost: 0.001,
    status_success: true,
    output_code: longOutput,
  });
  return runId;
}

// Cascade failure: malformed JSON output in step 1 propagates silently, stalls step 2,
// then causes a hard crash in step 3.
//   Step 1 parse-request:    2001(50) + 3011(25) = 75pts  → warning, sub-threshold
//   Step 2 enrich-context:   4007(20)             = 20pts  → warning, sub-threshold
//   Step 3 generate-response: 1001(100)+1002(100) = 200pts → critical
// AI analysis should identify step 1's malformed output as the true root cause.
async function triggerCascade() {
  const runId = crypto.randomUUID();

  // Step 1 — returns malformed JSON (unclosed bracket, missing closing `}` and `]`)
  await tracer.ingest({
    run_id: runId, step_name: 'parse-request', step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Extract the intent and entity list. Respond in JSON: {"intent": string, "entities": string[], "confidence": number}',
    input_tokens: 32, output_tokens: 26, total_tokens: 58,
    latency_ms: 390, cost: 0.0003,
    status_success: true,
    output_code: '{"intent": "billing", "entities": ["account_id", "invoice_num"',
  });

  // Step 2 — receives the malformed output as input; stalls (high latency, near-zero output)
  await tracer.ingest({
    run_id: runId, step_name: 'enrich-context', step_index: 1,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Enrich these entities with account metadata. Input from previous step: {"intent": "billing", "entities": ["account_id", "invoice_num"',
    input_tokens: 48, output_tokens: 3, total_tokens: 51,
    latency_ms: 6400, cost: 0.0002,
    status_success: true,
    output_code: 'null',
  });

  // Step 3 — hard failure: can't use the corrupted entity list
  await tracer.ingest({
    run_id: runId, step_name: 'generate-response', step_index: 2,
    model: 'claude-haiku-4-5-20251001',
    prompt: 'Generate a personalised billing response using the enriched entity data.',
    input_tokens: 0, output_tokens: 0, total_tokens: 0,
    latency_ms: 90, cost: 0,
    status_success: false,
    error: 'TypeError: Cannot read properties of null — entity list was malformed JSON from parse-request',
  });

  return runId;
}

// L4 only: stall pattern — high latency + almost no output
// → codes 4007 (20) + 4009 (15) = 35pts, warning only (below threshold)
async function triggerL4Stall() {
  const runId = crypto.randomUUID();
  await tracer.ingest({
    run_id: runId, step_name: 'generate-reply', step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: "Write a detailed response to the customer's billing inquiry.",
    input_tokens: 50, output_tokens: 3, total_tokens: 53,
    latency_ms: 9500, cost: 0.0001,
    status_success: true,
    output_code: 'ok',
  });
  return runId;
}

async function triggerStream() {
  const run = anthropic.run();
  let fullText = '';
  const stream = run.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Write a haiku about distributed tracing.' }],
    _trace: { stepName: 'streamed-haiku' },
  });
  for await (const event of stream as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      fullText += event.delta.text ?? '';
    }
  }
  return { runId: run.runId, text: fullText };
}

async function runWorkflow(message: string, history: HistoryItem[]) {
  // ── Test commands ──
  // !error — L1 hard: status failure (codes 1001+1002, 200pts, critical)
  if (message.trim() === '!error') {
    const runId = await triggerL1Failure('test-error');
    return { reply: `L1 hard failure: status_success=false + error message.\nCodes: 1001+1002 → 200pts → critical.\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  // !l1 — L1 hard: token accounting ghost (code 1007, 100pts, critical)
  if (message.trim() === '!l1') {
    const runId = await triggerL1TokenGhost();
    return { reply: `L1 token ghost: total_tokens=99 but input(10)+output(5)=15.\nCode: 1007 → 100pts → critical.\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  // !l2 — L2+L3: JSON contract + bracket imbalance + shape mismatch (105pts, critical)
  if (message.trim() === '!l2') {
    const runId = await triggerL2Json();
    return { reply: `L2+L3 JSON violation: prompt asked for JSON, output is malformed.\nCodes: 2001(50) + 3011(25) + 3014(30) = 105pts → critical.\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  // !l3 — L2+L3+L4: classify step returned prose instead of a category (110pts, critical)
  if (message.trim() === '!l3') {
    const runId = await triggerL3Shape();
    return { reply: `L2+L3+L4 shape mismatch: classify step output is a prose paragraph.\nCodes: 2003(35) + 3014(30) + 4005(25) + 4006(20) = 110pts → critical.\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  // !l4 — L4 only: stall pattern, high latency + tiny output (35pts, warning)
  if (message.trim() === '!l4') {
    const runId = await triggerL4Stall();
    return { reply: `L4 stall: 9.5s latency, only 3 output tokens — stall/hang signature.\nCodes: 4007(20) + 4009(15) = 35pts → warning (below threshold).\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  // !stream — single streamed call, tokens captured after stream completes
  if (message.trim() === '!stream') {
    const { runId, text: haiku } = await triggerStream();
    return {
      reply: `Streamed response (tokens captured after finalMessage()):\n\n${haiku}\n\nRun: ${runId}`,
      intent: 'technical', context: '', runId,
    };
  }

  // !cascade — 3-step pipeline where step 1 malformed JSON silently propagates
  //            to crash step 3; tests whether analysis traces the root cause back
  if (message.trim() === '!cascade') {
    const runId = await triggerCascade();
    return {
      reply: `Cascade failure injected (3 steps):\n  parse-request → 75pts warning (malformed JSON)\n  enrich-context → 20pts warning (stall)\n  generate-response → 200pts critical (hard crash)\nOpen the run in trace.ai and click Analyze to see if it finds the root cause.\nRun: ${runId}`,
      intent: 'technical', context: '', runId,
    };
  }

  // !spike — fire 6 error calls to trigger the error rate alert
  if (message.trim() === '!spike') {
    const runs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => triggerL1Failure(`spike-error-${i + 1}`))
    );
    return { reply: `Triggered 6 error calls to spike the error rate. Check Slack.\nFirst run: ${runs[0]}`, intent: 'technical', context: '', runId: runs[0] };
  }

  const run = anthropic.run();

  // Step 1 — classify intent (fast, tiny)
  const c1 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    system: 'Classify the user support message as exactly one of: billing, technical, general, feature-request. Reply with just the category, nothing else.',
    messages: [{ role: 'user', content: message }],
    _trace: { stepName: 'classify-intent' },
  } as TracedMessageParams);
  const intent = text(c1).trim().toLowerCase().replace(/[^a-z-]/g, '');

  // Step 2 — extract key context (what product / error / detail is mentioned)
  const c2 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 48,
    system: 'In 1 short sentence, summarize the core issue or request in the user message. Be specific.',
    messages: [{ role: 'user', content: message }],
    _trace: { stepName: 'extract-context' },
  } as TracedMessageParams);
  const context = text(c2).trim();

  // Step 3 — generate the reply
  const c3 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are a friendly customer support agent for Acme AI, a developer observability platform. Be concise (2–4 sentences), helpful, and professional. Do not mention you are an AI.',
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: `[Intent: ${intent}] [Issue: ${context}]\n\n${message}` },
    ],
    _trace: { stepName: 'generate-reply' },
  } as TracedMessageParams);
  const reply = text(c3).trim();

  return { reply, intent, context, runId: run.runId };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // API endpoint
  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await runWorkflow(body.message ?? '', body.history ?? []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Serve the chat UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`\nAcme AI Support Bot running at http://localhost:${PORT}`);
  console.log(`Traces → ${INGEST_URL}/ingest\n`);
});

// ── Embedded chat UI ──────────────────────────────────────────────────────────

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Acme AI Support</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #09090b;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* Header */
  .header {
    width: 100%;
    max-width: 680px;
    padding: 20px 24px 16px;
    border-bottom: 1px solid #27272a;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header-dot { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; }
  .header-title { font-size: 15px; font-weight: 600; color: #f4f4f5; }
  .header-sub { font-size: 12px; color: #71717a; margin-left: auto; }

  /* Messages */
  .messages {
    flex: 1;
    overflow-y: auto;
    width: 100%;
    max-width: 680px;
    padding: 24px 24px 8px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .msg { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.assistant { align-self: flex-start; align-items: flex-start; }

  .bubble {
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.55;
  }
  .msg.user .bubble {
    background: #3f3f46;
    color: #f4f4f5;
    border-bottom-right-radius: 4px;
  }
  .msg.assistant .bubble {
    background: #18181b;
    border: 1px solid #27272a;
    color: #d4d4d8;
    border-bottom-left-radius: 4px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 10px;
    font-family: monospace;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .badge.billing      { background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; }
  .badge.technical    { background: #0369a122; color: #38bdf8; border: 1px solid #0369a144; }
  .badge.general      { background: #71717a22; color: #a1a1aa; border: 1px solid #71717a44; }
  .badge.feature-request { background: #15803d22; color: #4ade80; border: 1px solid #15803d44; }

  .run-link {
    font-size: 10px;
    font-family: monospace;
    color: #52525b;
    text-decoration: none;
  }
  .run-link:hover { color: #a1a1aa; }

  /* Typing */
  .typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
  .typing span {
    width: 6px; height: 6px; background: #52525b; border-radius: 50%;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }

  /* Input */
  .input-area {
    width: 100%;
    max-width: 680px;
    padding: 16px 24px 24px;
    border-top: 1px solid #27272a;
  }
  .input-row {
    display: flex;
    gap: 10px;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 10px 12px;
    transition: border-color 0.15s;
  }
  .input-row:focus-within { border-color: #52525b; }

  textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #f4f4f5;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.5;
    resize: none;
    height: 24px;
    max-height: 120px;
  }
  textarea::placeholder { color: #52525b; }

  button {
    background: #e4e4e7;
    color: #09090b;
    border: none;
    border-radius: 7px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    align-self: flex-end;
  }
  button:hover { background: #ffffff; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Suggested prompts */
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .suggestion {
    background: transparent;
    border: 1px solid #27272a;
    color: #71717a;
    font-size: 12px;
    font-weight: 400;
    padding: 5px 12px;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .suggestion:hover { border-color: #52525b; color: #a1a1aa; background: transparent; }
  .suggestion.error-cmd { border-color: #7f1d1d44; color: #f87171; font-family: monospace; }
  .suggestion.error-cmd:hover { border-color: #991b1b; color: #fca5a5; }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #3f3f46;
  }
  .empty-title { font-size: 15px; color: #52525b; }
  .empty-sub { font-size: 13px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-dot"></div>
  <span class="header-title">Acme AI Support</span>
  <span class="header-sub">Powered by trace.ai</span>
</div>

<div class="messages" id="messages">
  <div class="empty" id="empty">
    <span class="empty-title">How can we help?</span>
    <span class="empty-sub">Ask anything about Acme AI</span>
  </div>
</div>

<div class="input-area">
  <div class="suggestions" id="suggestions">
    <button class="suggestion" onclick="fillInput(this)">My invoice looks wrong</button>
    <button class="suggestion" onclick="fillInput(this)">How do I set up the SDK?</button>
    <button class="suggestion" onclick="fillInput(this)">My API key stopped working</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="L1: status failure → 1001+1002, critical">!error</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="L1: token accounting mismatch → 1007, critical">!l1</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="L2+L3: JSON contract + bracket imbalance → 2001+3011+3014, critical">!l2</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="L2+L3+L4: classify shape mismatch → 2003+3014+4005+4006, critical">!l3</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="L4 only: stall pattern → 4007+4009, warning">!l4</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="Fire 6 errors to spike the error rate alert">!spike</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="3-step cascade: malformed JSON in step 1 silently propagates and crashes step 3">!cascade</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)" title="Single streaming call — tokens captured via finalMessage() after stream ends">!stream</button>
  </div>
  <div class="input-row">
    <textarea
      id="input"
      placeholder="Ask a question…"
      rows="1"
      onkeydown="handleKey(event)"
      oninput="autoResize(this)"
    ></textarea>
    <button id="send-btn" onclick="sendMessage()">Send</button>
  </div>
</div>

<script>
  const history = [];
  let busy = false;

  function fillInput(el) {
    document.getElementById('input').value = el.textContent;
    document.getElementById('input').focus();
  }

  function autoResize(el) {
    el.style.height = '24px';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function appendMessage(role, content, meta = null) {
    document.getElementById('empty')?.remove();
    document.getElementById('suggestions').style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = \`msg \${role}\`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    wrap.appendChild(bubble);

    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      if (meta.intent) {
        const badge = document.createElement('span');
        badge.className = \`badge \${meta.intent}\`;
        badge.textContent = meta.intent;
        m.appendChild(badge);
      }
      if (meta.runId) {
        const link = document.createElement('a');
        link.className = 'run-link';
        link.textContent = 'run ' + meta.runId.slice(0, 8) + '…';
        link.href = '#';
        link.title = meta.runId;
        m.appendChild(link);
      }
      wrap.appendChild(m);
    }

    const msgs = document.getElementById('messages');
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }

  function showTyping() {
    document.getElementById('empty')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.id = 'typing';
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(bubble);
    const msgs = document.getElementById('messages');
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    document.getElementById('typing')?.remove();
  }

  async function sendMessage() {
    if (busy) return;
    const input = document.getElementById('input');
    const message = input.value.trim();
    if (!message) return;

    busy = true;
    document.getElementById('send-btn').disabled = true;
    input.value = '';
    input.style.height = '24px';

    appendMessage('user', message);
    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json();
      removeTyping();

      if (data.error) {
        appendMessage('assistant', 'Sorry, something went wrong. Please try again.');
      } else {
        appendMessage('assistant', data.reply, { intent: data.intent, runId: data.runId });
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: data.reply });
      }
    } catch {
      removeTyping();
      appendMessage('assistant', 'Connection error — is the chatbot server running?');
    }

    busy = false;
    document.getElementById('send-btn').disabled = false;
    input.focus();
  }
</script>
</body>
</html>`;
