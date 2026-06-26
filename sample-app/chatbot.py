#!/usr/bin/env python3
"""
Python demo chatbot — mirrors chatbot.ts but uses LangChain + traceai.

Usage:
    pip install langchain-anthropic
    ANTHROPIC_API_KEY=... TRACE_API_KEY=trace_... python sample-app/chatbot.py

Then open http://localhost:3002

Test commands (same as the TypeScript version):
    !error    L1 hard: status failure (codes 1001+1002, 200pts, critical)
    !l1       L1 hard: token accounting ghost (1007, 100pts)
    !l2       L2+L3: malformed JSON (2001+3011+3014, 105pts)
    !l3       L2+L3+L4: shape mismatch (2003+3014+4005+4006, 110pts)
    !l4       L4 only: stall pattern (4007+4009, 35pts, warning)
    !cascade  3-step cascade failure (malformed output in step 1 → crash in step 3)
    !spike    6 error calls to trigger the error-rate Slack alert
"""

import json
import os
import sys
import uuid as _uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "python-sdk"))

from traceai import Tracer
from traceai.langchain import TraceAICallbackHandler

try:
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_core.runnables import RunnableLambda
except ImportError:
    print("Missing dependencies — run: pip install langchain-anthropic")
    sys.exit(1)

PORT = 3002
MODEL = "claude-haiku-4-5-20251001"

if not os.environ.get("ANTHROPIC_API_KEY"):
    print("Missing ANTHROPIC_API_KEY — set it in your environment")
    sys.exit(1)

tracer  = Tracer(api_key=os.environ.get("TRACE_API_KEY", ""))
handler = TraceAICallbackHandler(tracer)
llm     = ChatAnthropic(model=MODEL, api_key=os.environ["ANTHROPIC_API_KEY"])

# ── Anomaly trigger helpers (same payloads as chatbot.ts) ─────────────────────

def _ingest(**kw) -> str:
    run_id = str(_uuid.uuid4())
    tracer.ingest(run_id=run_id, **kw)
    return run_id


def trigger_l1_failure(step_name: str) -> str:
    return _ingest(
        step_name=step_name, step_index=0, model=MODEL,
        prompt="Retrieve the user account details.",
        input_tokens=15, output_tokens=0, total_tokens=15,
        latency_ms=230, cost=0, status_success=False,
        error="Connection timeout after 3 retries",
    )


def trigger_l1_token_ghost() -> str:
    return _ingest(
        step_name="summarize", step_index=0, model=MODEL,
        prompt="Summarize this in one sentence.",
        input_tokens=10, output_tokens=5, total_tokens=99,
        latency_ms=180, cost=0.001, status_success=True,
        output_code="The customer wants a refund.",
    )


def trigger_l2_json() -> str:
    return _ingest(
        step_name="extract-entities", step_index=0, model=MODEL,
        prompt="Extract entities and respond in JSON with fields: name, intent, confidence.",
        input_tokens=25, output_tokens=40, total_tokens=65,
        latency_ms=310, cost=0.0005, status_success=True,
        output_code='{"name": "Alice", "intent": "billing", "confidence": 0.92',
    )


def trigger_l3_shape() -> str:
    long_output = (
        "Based on my analysis of the support message, I believe the customer is experiencing "
        "a billing issue related to their subscription renewal. The message clearly indicates "
        "frustration with unexpected charges appearing on their account statement."
    )
    return _ingest(
        step_name="classify-intent", step_index=0, model=MODEL,
        prompt="Classify this message as exactly one of: billing, technical, general. Reply with just the category.",
        input_tokens=20, output_tokens=60, total_tokens=80,
        latency_ms=400, cost=0.001, status_success=True,
        output_code=long_output,
    )


def trigger_l4_stall() -> str:
    return _ingest(
        step_name="generate-reply", step_index=0, model=MODEL,
        prompt="Write a detailed response to the customer's billing inquiry.",
        input_tokens=50, output_tokens=3, total_tokens=53,
        latency_ms=9500, cost=0.0001, status_success=True,
        output_code="ok",
    )


def trigger_cascade() -> str:
    run_id = str(_uuid.uuid4())
    tracer.ingest(
        run_id=run_id, step_name="parse-request", step_index=0, model=MODEL,
        prompt='Extract the intent and entity list. Respond in JSON: {"intent": string, "entities": string[], "confidence": number}',
        input_tokens=32, output_tokens=26, total_tokens=58,
        latency_ms=390, cost=0.0003, status_success=True,
        output_code='{"intent": "billing", "entities": ["account_id", "invoice_num"',
    )
    tracer.ingest(
        run_id=run_id, step_name="enrich-context", step_index=1, model=MODEL,
        prompt='Enrich these entities with account metadata. Input: {"intent": "billing", "entities": ["account_id", "invoice_num"',
        input_tokens=48, output_tokens=3, total_tokens=51,
        latency_ms=6400, cost=0.0002, status_success=True,
        output_code="null",
    )
    tracer.ingest(
        run_id=run_id, step_name="generate-response", step_index=2, model=MODEL,
        prompt="Generate a personalised billing response using the enriched entity data.",
        input_tokens=0, output_tokens=0, total_tokens=0,
        latency_ms=90, cost=0, status_success=False,
        error="TypeError: Cannot read properties of null — entity list was malformed JSON from parse-request",
    )
    return run_id


# ── 3-step LangChain workflow ─────────────────────────────────────────────────

def _workflow(inputs: dict, config: dict) -> dict:
    """classify-intent → extract-context → generate-reply.

    Each llm.invoke() inherits the outer RunnableLambda's run_id as
    parent_run_id, grouping all three steps under one trace.ai run.
    """
    message = inputs["message"]
    history = inputs.get("history", [])

    def step(system: str, step_name: str, messages: list) -> str:
        resp = llm.invoke(
            [SystemMessage(content=system)] + messages,
            config={**config, "metadata": {"step_name": step_name}},
        )
        return resp.content.strip()

    intent = step(
        "Classify the user support message as exactly one of: billing, technical, general, feature-request. Reply with just the category, nothing else.",
        "classify-intent",
        [HumanMessage(content=message)],
    ).lower().replace(" ", "-")

    context = step(
        "In 1 short sentence, summarize the core issue or request in the user message. Be specific.",
        "extract-context",
        [HumanMessage(content=message)],
    )

    conv = []
    for turn in history:
        cls = HumanMessage if turn["role"] == "user" else AIMessage
        conv.append(cls(content=turn["content"]))
    conv.append(HumanMessage(content=f"[Intent: {intent}] [Issue: {context}]\n\n{message}"))

    reply = step(
        "You are a friendly customer support agent for Acme AI, a developer observability platform. Be concise (2–4 sentences), helpful, and professional. Do not mention you are an AI.",
        "generate-reply",
        conv,
    )

    return {"reply": reply, "intent": intent}


workflow_chain = RunnableLambda(_workflow)


def run_workflow(message: str, history: list) -> dict:
    msg = message.strip()

    if msg == "!error":
        run_id = trigger_l1_failure("test-error")
        return {"reply": f"L1 hard failure: status_success=false + error message.\nCodes: 1001+1002 → 200pts → critical.\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!l1":
        run_id = trigger_l1_token_ghost()
        return {"reply": f"L1 token ghost: total_tokens=99 but input(10)+output(5)=15.\nCode: 1007 → 100pts → critical.\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!l2":
        run_id = trigger_l2_json()
        return {"reply": f"L2+L3 JSON violation: prompt asked for JSON, output is malformed.\nCodes: 2001(50) + 3011(25) + 3014(30) = 105pts → critical.\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!l3":
        run_id = trigger_l3_shape()
        return {"reply": f"L2+L3+L4 shape mismatch: classify step output is a prose paragraph.\nCodes: 2003(35) + 3014(30) + 4005(25) + 4006(20) = 110pts → critical.\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!l4":
        run_id = trigger_l4_stall()
        return {"reply": f"L4 stall: 9.5s latency, only 3 output tokens — stall/hang signature.\nCodes: 4007(20) + 4009(15) = 35pts → warning (below threshold).\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!cascade":
        run_id = trigger_cascade()
        return {"reply": f"Cascade failure injected (3 steps):\n  parse-request → 75pts warning (malformed JSON)\n  enrich-context → 20pts warning (stall)\n  generate-response → 200pts critical (hard crash)\nOpen the run in trace.ai and click Analyze to see if it finds the root cause.\nRun: {run_id}", "intent": "technical", "runId": run_id}
    if msg == "!spike":
        runs = [trigger_l1_failure(f"spike-error-{i+1}") for i in range(6)]
        return {"reply": f"Triggered 6 error calls to spike the error rate. Check Slack.\nFirst run: {runs[0]}", "intent": "technical", "runId": runs[0]}

    # Real workflow — use an explicit run_id so we can return it to the UI
    run_id = _uuid.uuid4()
    result = workflow_chain.invoke(
        {"message": message, "history": history},
        config={"callbacks": [handler], "run_id": run_id},
    )
    return {"reply": result["reply"], "intent": result["intent"], "runId": str(run_id)}


# ── HTTP server ───────────────────────────────────────────────────────────────

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access log

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML.encode())

    def do_POST(self):
        if self.path != "/api/chat":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length))
        try:
            result = run_workflow(body.get("message", ""), body.get("history", []))
            self._json(200, result)
        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def _json(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = HTTPServer(("", PORT), _Handler)
    print(f"\nAcme AI Support Bot (Python/LangChain) → http://localhost:{PORT}")
    print(f"Traces  → {tracer.api_url}/ingest\n")
    server.serve_forever()


# ── Embedded chat UI (same as chatbot.ts) ─────────────────────────────────────

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Acme AI Support (Python)</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #09090b; color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    height: 100dvh; display: flex; flex-direction: column; align-items: center;
  }
  .header {
    width: 100%; max-width: 680px; padding: 20px 24px 16px;
    border-bottom: 1px solid #27272a; display: flex; align-items: center; gap: 10px;
  }
  .header-dot { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; }
  .header-title { font-size: 15px; font-weight: 600; color: #f4f4f5; }
  .header-sub { font-size: 12px; color: #71717a; margin-left: auto; }
  .messages {
    flex: 1; overflow-y: auto; width: 100%; max-width: 680px;
    padding: 24px 24px 8px; display: flex; flex-direction: column; gap: 20px;
  }
  .msg { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.assistant { align-self: flex-start; align-items: flex-start; }
  .bubble { padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; }
  .msg.user .bubble { background: #3f3f46; color: #f4f4f5; border-bottom-right-radius: 4px; }
  .msg.assistant .bubble { background: #18181b; border: 1px solid #27272a; color: #d4d4d8; border-bottom-left-radius: 4px; }
  .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .badge {
    font-size: 10px; font-family: monospace; font-weight: 600;
    padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .badge.billing      { background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; }
  .badge.technical    { background: #0369a122; color: #38bdf8; border: 1px solid #0369a144; }
  .badge.general      { background: #71717a22; color: #a1a1aa; border: 1px solid #71717a44; }
  .badge.feature-request { background: #15803d22; color: #4ade80; border: 1px solid #15803d44; }
  .run-link { font-size: 10px; font-family: monospace; color: #52525b; text-decoration: none; }
  .run-link:hover { color: #a1a1aa; }
  .typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
  .typing span {
    width: 6px; height: 6px; background: #52525b; border-radius: 50%;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
  .input-area { width: 100%; max-width: 680px; padding: 16px 24px 24px; border-top: 1px solid #27272a; }
  .input-row {
    display: flex; gap: 10px; background: #18181b; border: 1px solid #27272a;
    border-radius: 12px; padding: 10px 12px; transition: border-color 0.15s;
  }
  .input-row:focus-within { border-color: #52525b; }
  textarea {
    flex: 1; background: transparent; border: none; outline: none;
    color: #f4f4f5; font-size: 14px; font-family: inherit;
    line-height: 1.5; resize: none; height: 24px; max-height: 120px;
  }
  textarea::placeholder { color: #52525b; }
  button {
    background: #e4e4e7; color: #09090b; border: none; border-radius: 7px;
    padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: background 0.15s; align-self: flex-end;
  }
  button:hover { background: #ffffff; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .suggestion {
    background: transparent; border: 1px solid #27272a; color: #71717a;
    font-size: 12px; font-weight: 400; padding: 5px 12px; border-radius: 999px;
    cursor: pointer; transition: all 0.15s;
  }
  .suggestion:hover { border-color: #52525b; color: #a1a1aa; background: transparent; }
  .suggestion.error-cmd { border-color: #7f1d1d44; color: #f87171; font-family: monospace; }
  .suggestion.error-cmd:hover { border-color: #991b1b; color: #fca5a5; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #3f3f46; }
  .empty-title { font-size: 15px; color: #52525b; }
  .empty-sub { font-size: 13px; }
  .py-badge { font-size: 10px; font-family: monospace; color: #a78bfa; background: #7c3aed22; border: 1px solid #7c3aed44; padding: 2px 7px; border-radius: 999px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-dot"></div>
  <span class="header-title">Acme AI Support</span>
  <span class="py-badge">Python / LangChain</span>
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
  </div>
  <div class="input-row">
    <textarea id="input" placeholder="Ask a question…" rows="1"
      onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
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
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    wrap.appendChild(bubble);
    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      if (meta.intent) {
        const badge = document.createElement('span');
        badge.className = `badge ${meta.intent}`;
        badge.textContent = meta.intent;
        m.appendChild(badge);
      }
      if (meta.runId && meta.runId !== 'n/a') {
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
  }

  function showTyping() {
    document.getElementById('empty')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant'; wrap.id = 'typing';
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(bubble);
    const msgs = document.getElementById('messages');
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() { document.getElementById('typing')?.remove(); }

  async function sendMessage() {
    if (busy) return;
    const input = document.getElementById('input');
    const message = input.value.trim();
    if (!message) return;
    busy = true;
    document.getElementById('send-btn').disabled = true;
    input.value = ''; input.style.height = '24px';
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
        appendMessage('assistant', 'Sorry, something went wrong: ' + data.error);
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
</html>"""
