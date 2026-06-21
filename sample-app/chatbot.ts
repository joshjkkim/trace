/**
 * Demo chatbot — customer support agent for "Acme AI" (fictional).
 * Each user message runs a 3-step traced workflow:
 *   classify-intent → extract-context → generate-reply
 *
 * Usage:
 *   INGEST_URL=http://localhost:8000 npm run chatbot
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
const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:8000';
const API_KEY    = process.env.TRACE_API_KEY ?? 'trace_BUaC3l1k0GL09KYlwOpaXKs4e9nzQ16h';

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

async function triggerError(stepName: string) {
  const runId = crypto.randomUUID();
  await tracer.ingest({
    run_id: runId,
    step_name: stepName,
    step_index: 0,
    model: 'claude-haiku-4-5-20251001',
    prompt: JSON.stringify({ messages: [{ role: 'user', content: 'test trigger' }] }),
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    latency_ms: 42,
    cost: 0,
    status_success: false,
    error: 'Simulated error (test trigger)',
  });
  return runId;
}

async function postAnomaly(runId: string, stepName: string, badScores: Record<string, number>) {
  await fetch(`${INGEST_URL}/anomalies/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify([{ step_name: stepName, run_id: runId, bad_scores: badScores }]),
  });
}

async function ingestStep(runId: string, stepName: string, stepIndex: number) {
  await tracer.ingest({
    run_id: runId, step_name: stepName, step_index: stepIndex,
    model: 'claude-haiku-4-5-20251001',
    prompt: JSON.stringify({ messages: [{ role: 'user', content: `test: ${stepName}` }] }),
    input_tokens: 10, output_tokens: 5, total_tokens: 15, latency_ms: 80, cost: 0, status_success: true,
  });
}

// Simulates a run where penalty accumulates across 3 steps, crossing 100pts on the last
async function triggerBuildup() {
  const runId = crypto.randomUUID();
  // Step 1 → 30 pts (warning)
  await ingestStep(runId, 'classify-intent', 0);
  await postAnomaly(runId, 'classify-intent', { '2003': 30 });
  // Step 2 → +40 pts = 70 total (still warning)
  await ingestStep(runId, 'extract-context', 1);
  await postAnomaly(runId, 'extract-context', { '3001': 40 });
  // Step 3 → +35 pts = 105 total (critical!)
  await ingestStep(runId, 'generate-reply', 2);
  await postAnomaly(runId, 'generate-reply', { '1002': 35 });
  return runId;
}

async function triggerAnomaly(critical: boolean) {
  const runId = crypto.randomUUID();
  await ingestStep(runId, 'classify-intent', 0);
  await postAnomaly(runId, 'classify-intent', critical ? { '1001': 100 } : { '2003': 35, '4005': 25 });
  return { runId, critical };
}

async function runWorkflow(message: string, history: HistoryItem[]) {
  // ── Test commands ──
  if (message.trim() === '!error') {
    const runId = await triggerError('test-error');
    return { reply: `Triggered one error call. Check Slack and the dashboard.\nRun: ${runId}`, intent: 'technical', context: '', runId };
  }

  if (message.trim() === '!anomaly') {
    const { runId } = await triggerAnomaly(true);
    return { reply: `Triggered critical anomaly (100 pts, threshold hit).\nRun: ${runId}\nCheck the Anomalies tab.`, intent: 'technical', context: '', runId };
  }

  if (message.trim() === '!buildup') {
    const runId = await triggerBuildup();
    return { reply: `Triggered 3-step run: 30pts → 70pts → 105pts (critical).\nRun: ${runId}\nCheck Runs + Anomalies tabs.`, intent: 'technical', context: '', runId };
  }

  if (message.trim() === '!warn') {
    const { runId } = await triggerAnomaly(false);
    return { reply: `Triggered warning anomaly (60 pts, below threshold).\nRun: ${runId}\nCheck the Anomalies tab.`, intent: 'technical', context: '', runId };
  }

  if (message.trim() === '!spike') {
    const runs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => triggerError(`spike-error-${i + 1}`))
    );
    return { reply: `Triggered 6 error calls to spike the error rate. Check Slack.\nFirst run: ${runs[0]}`, intent: 'technical', context: '', runId: runs[0] };
  }

  const run = anthropic.run();

  // Step 1 — classify intent (fast, tiny)
  const c1 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    messages: [{
      role: 'user',
      content: `Classify this support message as exactly one of: billing, technical, general, feature-request.\nReply with just the category.\n\nMessage: "${message}"`,
    }],
    _trace: { stepName: 'classify-intent' },
  } as TracedMessageParams);
  const intent = text(c1).trim().toLowerCase().replace(/[^a-z-]/g, '');

  // Step 2 — extract key context (what product / error / detail is mentioned)
  const c2 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 48,
    messages: [{
      role: 'user',
      content: `In 1 short sentence, what is the core issue or request in this message? Be specific.\n\n"${message}"`,
    }],
    _trace: { stepName: 'extract-context' },
  } as TracedMessageParams);
  const context = text(c2).trim();

  // Step 3 — generate the reply
  const c3 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You are a friendly customer support agent for Acme AI, a developer observability platform.
Intent: ${intent}
Core issue: ${context}
Be concise (2–4 sentences), helpful, and professional. Don't mention you are an AI.`,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
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
    <button class="suggestion error-cmd" onclick="fillInput(this)">!error</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)">!spike</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)">!anomaly</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)">!warn</button>
    <button class="suggestion error-cmd" onclick="fillInput(this)">!buildup</button>
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
