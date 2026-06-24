'use client';

import Link from 'next/link';
import { useState } from 'react';

// ── Shared components ─────────────────────────────────────────────────────────

function Code({ children, lang = 'ts' }: { children: string; lang?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-gray-950 overflow-hidden my-4">
      <div className="px-4 py-2 border-b border-white/5">
        <span className="text-[10px] text-gray-600 font-mono">{lang}</span>
      </div>
      <pre className="px-5 py-4 text-sm font-mono text-gray-300 overflow-x-auto leading-7 whitespace-pre">{children}</pre>
    </div>
  );
}

function Callout({ type = 'info', children }: { type?: 'info' | 'warn' | 'tip'; children: React.ReactNode }) {
  const styles = {
    info: 'border-indigo-800/60 bg-indigo-950/30 text-indigo-200',
    warn: 'border-yellow-800/50 bg-yellow-950/20 text-yellow-200',
    tip:  'border-green-800/50 bg-green-950/20 text-green-200',
  };
  const icons = { info: 'ℹ', warn: '⚠', tip: '✦' };
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 my-4 text-sm leading-relaxed ${styles[type]}`}>
      <span className="shrink-0 mt-0.5 opacity-70">{icons[type]}</span>
      <div>{children}</div>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-white mt-12 mb-3 first:mt-0">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-gray-200 mt-8 mb-3">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-400 leading-relaxed mb-4">{children}</p>;
}

function Table({ rows }: { rows: { f: string; t?: string; d: string }[] }) {
  return (
    <div className="rounded-xl border border-white/6 overflow-hidden mb-6">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.f} className="text-gray-400">
              <td className="px-4 py-3 font-mono text-xs text-gray-200 align-top w-40">{r.f}</td>
              {r.t && <td className="px-4 py-3 font-mono text-xs text-indigo-300 align-top w-24">{r.t}</td>}
              <td className="px-4 py-3 text-sm">{r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page sections ─────────────────────────────────────────────────────────────

type Section = 'start' | 'sdk' | 'detection' | 'integrations';

const SECTIONS: { id: Section; label: string; sub: string }[] = [
  { id: 'start',        label: 'Getting started', sub: 'Quick start, concepts, install' },
  { id: 'sdk',          label: 'SDK reference',   sub: 'Tracer, run(), streaming, steps' },
  { id: 'detection',    label: 'Anomaly detection', sub: 'L1–L5, step identity, trends' },
  { id: 'integrations', label: 'Integrations',    sub: 'Slack, Sentry' },
];

// ── Section: Getting started ──────────────────────────────────────────────────

function SectionStart() {
  return (
    <div>
      <H2>Quick start</H2>
      <P>Two lines to start tracing every LLM call — tokens, latency, cost, and anomaly scores captured automatically.</P>
      <Code>{`import { Tracer } from '@trace-ai/sdk'
import Anthropic from '@anthropic-ai/sdk'

const tracer    = new Tracer({ apiKey: 'trace_...' })
const anthropic = tracer.wrapAnthropic(new Anthropic())

// Use exactly like the normal Anthropic client
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello!' }],
})
// Every call is now traced in your dashboard`}</Code>
      <Callout type="info">
        Find your API key in the dashboard under <strong>Settings → API Key</strong> for each project.
      </Callout>

      <H2>Core concepts</H2>
      <div className="space-y-3 mb-6">
        {[
          { term: 'Project',  def: 'An isolated workspace with its own API key, dashboard, and alert config. One API key = one project.' },
          { term: 'Run',      def: 'A single end-to-end execution of your AI pipeline — one user request handled by multiple steps. All steps sharing a run_id are grouped together in the dashboard.' },
          { term: 'Step',     def: 'A single LLM call within a run. Named with _trace: { stepName }. Captures model, tokens, latency, cost, and output.' },
          { term: 'Profile',  def: 'The semantic identity of a step — derived from its system prompt embedding. Stable across renames, prompt tweaks, and pipeline changes. The foundation of per-step anomaly baselines.' },
        ].map(({ term, def }) => (
          <div key={term} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="shrink-0 text-sm font-semibold text-indigo-300 w-16">{term}</span>
            <span className="text-sm text-gray-400 leading-relaxed">{def}</span>
          </div>
        ))}
      </div>

      <H2>Installation</H2>
      <Code lang="bash">npm install @trace-ai/sdk</Code>
      <P>No background processes, no native dependencies. Works in Node.js 18+ and any runtime with the Fetch API.</P>
    </div>
  );
}

// ── Section: SDK reference ────────────────────────────────────────────────────

function SectionSDK() {
  return (
    <div>
      <H2>new Tracer(config)</H2>
      <P>The entry point. Create one instance per application.</P>
      <Code>{`const tracer = new Tracer({
  apiKey: 'trace_...',   // required
  apiUrl: '...',         // optional — override for self-hosting / local dev
  runId:  '...',         // optional — provide your own run ID
})`}</Code>
      <Table rows={[
        { f: 'apiKey', t: 'string',  d: 'Your project API key. Required.' },
        { f: 'apiUrl', t: 'string?', d: 'Custom ingest URL. Defaults to trace-ai servers.' },
        { f: 'runId',  t: 'string?', d: 'Override the auto-generated run ID for this tracer.' },
      ]} />

      <H2>wrapAnthropic(client)</H2>
      <P>Returns a drop-in replacement for the Anthropic client. Intercepts every <code className="text-indigo-300 text-sm font-mono">messages.create()</code> call, forwards it unchanged, and automatically ingests the trace after the response returns.</P>
      <Code>{`const anthropic = tracer.wrapAnthropic(new Anthropic())

await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Summarise...' }],
})`}</Code>
      <Callout type="tip">
        The original client is not modified. Keep both — wrapped for traced calls, original for anything you don&apos;t want traced.
      </Callout>

      <H2>run()</H2>
      <P><strong className="text-gray-200">Key concept for multi-step pipelines.</strong> Calling <code className="text-indigo-300 text-sm font-mono">anthropic.run()</code> creates a <code className="text-indigo-300 text-sm font-mono">TracedRun</code> — a fresh execution context with its own <code className="text-indigo-300 text-sm font-mono">run_id</code>. Every step on that run is grouped together in the dashboard.</P>
      <Callout type="warn">
        Without <code>run()</code>, all calls share the tracer&apos;s single <code>runId</code> and appear as one run. For multi-step workflows, always call <code>run()</code> at the start of each user request.
      </Callout>
      <Code>{`async function handleRequest(userMessage: string) {
  const run = anthropic.run()          // new run_id, step_index resets to 0

  const c1 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    system: 'Classify as: billing, technical, general, feature-request. Reply with just the category.',
    messages: [{ role: 'user', content: userMessage }],
    _trace: { stepName: 'classify-intent' },
  } as TracedMessageParams)

  const c2 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are a support agent. Be concise and helpful.',
    messages: [{ role: 'user', content: userMessage }],
    _trace: { stepName: 'generate-reply' },
  } as TracedMessageParams)

  console.log('run:', run.runId)       // shared ID for both steps
}`}</Code>

      <H2>Streaming</H2>
      <P><code className="text-indigo-300 text-sm font-mono">messages.stream()</code> is fully supported. Tokens and latency are captured after the stream ends — zero impact on streaming latency.</P>
      <Code>{`const stream = run.messages.stream({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  _trace: { stepName: 'story' },
})

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text)
  }
}
// trace ingested automatically once stream completes`}</Code>

      <H2>Naming steps</H2>
      <P>Add <code className="text-indigo-300 text-sm font-mono">_trace: {`{ stepName: '...' }`}</code> to give a step a human-readable name. Without it, steps are auto-named from the first 4 words of the system prompt.</P>
      <Callout type="tip">
        <strong>Keep system prompts as static templates.</strong> Dynamic content (user input, runtime values) should live in the <code>messages</code> array, not the <code>system</code> prompt. trace.ai uses the system prompt to build a stable semantic fingerprint for each step — dynamic system prompts create duplicate profiles.
      </Callout>
      <Code>{`// ✓ Good — static system prompt, dynamic user message
await run.messages.create({
  system: 'Extract named entities from the user message. Return JSON.',
  messages: [{ role: 'user', content: userInput }],   // ← dynamic here
  _trace: { stepName: 'extract-entities' },
} as TracedMessageParams)

// ✗ Bad — dynamic content in system prompt breaks fingerprinting
await run.messages.create({
  system: \`You are helping \${userName} with \${topic}.\`,  // ← changes every call
  messages: [{ role: 'user', content: userInput }],
} as TracedMessageParams)`}</Code>

      <H2>Manual ingest</H2>
      <P>For steps outside the Anthropic client — external APIs, custom models, pre-computed results — use <code className="text-indigo-300 text-sm font-mono">tracer.ingest()</code> directly.</P>
      <Code>{`await tracer.ingest({
  run_id:         'my-run-id',
  step_name:      'fetch-context',
  step_index:     1,
  model:          'custom-model',
  prompt:         JSON.stringify({ system: '...', messages: [...] }),
  input_tokens:   120,
  output_tokens:  48,
  total_tokens:   168,
  latency_ms:     340,
  cost:           0.0014,
  status_success: true,
  output_code:    'The user wants a refund.',
})`}</Code>
      <Table rows={[
        { f: 'run_id',         d: 'Groups steps into one run. Use run.runId from a TracedRun, or any UUID.' },
        { f: 'step_name',      d: 'Human-readable name. Shown in the dashboard and analysis reports.' },
        { f: 'step_index',     d: 'Order within the run. Steps are sorted by this in the run graph.' },
        { f: 'model',          d: 'Model identifier string, e.g. "claude-haiku-4-5-20251001".' },
        { f: 'prompt',         d: 'The prompt sent to the model. For chat, use JSON.stringify({ system, messages }). The system field is used for step fingerprinting.' },
        { f: 'input_tokens',   d: 'Input token count as reported by the model.' },
        { f: 'output_tokens',  d: 'Output token count.' },
        { f: 'total_tokens',   d: 'Should equal input + output. Mismatch triggers anomaly code 1007.' },
        { f: 'latency_ms',     d: 'Wall-clock time from request start to response received.' },
        { f: 'cost',           d: 'USD cost for this call.' },
        { f: 'status_success', d: 'true if the call completed, false if it errored.' },
        { f: 'output_code',    d: "The model's response text. Used by the anomaly engine for shape analysis." },
        { f: 'error',          d: 'Error message. Required when status_success is false.' },
      ]} />
    </div>
  );
}

// ── Section: Anomaly detection ────────────────────────────────────────────────

function SectionDetection() {
  return (
    <div>
      <H2>How it works</H2>
      <P>
        Every ingested call is scored by a 5-layer engine running in the background. No configuration required. Scores accumulate across layers — a single L1 hit (100 pts) is immediately critical. L2–L4 conditions score 10–50 pts each and require several to fire before crossing the threshold.
      </P>
      <P>
        The engine short-circuits once the score crosses 100 pts — so an L1 failure never runs L2–L5. This keeps scoring fast and the output actionable.
      </P>

      <div className="space-y-3 mb-8">
        {[
          { layer: 'L1', color: 'border-red-900/50 bg-red-950/20', label: 'text-red-400',    title: 'Hard failures',        desc: 'Deterministic, non-heuristic failures. status_success=false, error present, token accounting mismatch (total ≠ input+output), negative counts. Any single L1 hit scores 100 pts and short-circuits.' },
          { layer: 'L2', color: 'border-orange-900/40 bg-orange-950/10', label: 'text-orange-400', title: 'Format violations',    desc: 'Prompt-implied output contracts. Prompt asks for JSON but output isn\'t valid JSON. Prompt asks for yes/no but output is prose. Enum step returned a non-enumerated value.' },
          { layer: 'L3', color: 'border-yellow-900/40 bg-yellow-950/10', label: 'text-yellow-400', title: 'Shape fingerprinting', desc: 'Structural analysis without history. Output shape mismatches the prompt\'s implied shape. Unbalanced brackets. Named JSON keys missing. Word count violations on constrained prompts.' },
          { layer: 'L4', color: 'border-blue-900/40 bg-blue-950/10', label: 'text-blue-400',   title: 'Numeric thresholds',   desc: 'Static and adaptive limits for latency, tokens, and cost. Stall pattern detection (high latency, near-zero output). Superseded by L5 per-metric when a step baseline is available.' },
          { layer: 'L5', color: 'border-violet-900/40 bg-violet-950/10', label: 'text-violet-400', title: 'Statistical deviation', desc: 'Per-step z-score scoring against that step\'s own historical mean and standard deviation. Activates after 20 calls per step. Owns latency, tokens, and cost scoring when active — L4\'s raw threshold checks defer.' },
        ].map((l) => (
          <div key={l.layer} className={`rounded-xl border px-4 py-4 ${l.color}`}>
            <div className="flex items-center gap-3 mb-1.5">
              <span className={`font-bold font-mono text-xs ${l.label}`}>{l.layer}</span>
              <span className="font-semibold text-sm text-gray-200">{l.title}</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{l.desc}</p>
          </div>
        ))}
      </div>

      <H2>Step identity and fingerprinting</H2>
      <P>
        Each step is assigned a stable semantic identity called a <strong className="text-gray-200">step profile</strong> — derived from the embedding of its system prompt using a local sentence-transformers model (all-MiniLM-L6-v2, 384 dimensions). This identity persists across renames, minor prompt rewrites, and pipeline restructuring.
      </P>
      <div className="space-y-3 mb-6">
        {[
          { sigma: '> 0.92', label: 'Matched',  color: 'text-green-400',  desc: 'Same step. Uses the existing profile — anomaly baselines are stable.' },
          { sigma: '0.75–0.92', label: 'Evolved',  color: 'text-yellow-400', desc: 'Same step but the prompt has meaningfully drifted. Profile is kept, drift is logged.' },
          { sigma: '< 0.75', label: 'New',      color: 'text-indigo-400', desc: 'Genuinely new step. A new profile is created with its own baseline.' },
        ].map((r) => (
          <div key={r.label} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3 items-center">
            <span className="font-mono text-xs text-gray-500 w-20 shrink-0">{r.sigma}</span>
            <span className={`text-sm font-semibold w-16 shrink-0 ${r.color}`}>{r.label}</span>
            <span className="text-sm text-gray-400">{r.desc}</span>
          </div>
        ))}
      </div>
      <Callout type="info">
        Fingerprinting runs asynchronously — it never adds latency to your application. The <code>step_profile_id</code> is backfilled on the CALLS row within a few seconds of ingest.
      </Callout>

      <H2>L5 — statistical detection</H2>
      <P>
        Once a step has 20+ calls, trace.ai computes a per-step baseline: the <strong className="text-gray-200">mean</strong> and <strong className="text-gray-200">standard deviation</strong> of latency, tokens, and cost across its recent history. Each new call is then scored as a z-score:
      </P>
      <div className="rounded-xl border border-white/6 bg-gray-950 px-5 py-4 mb-4 font-mono text-sm text-gray-300">
        z = (observed − mean) / std
      </div>
      <P>
        If <code className="text-indigo-300 text-sm font-mono">|z| &gt; 3</code>, L5 fires. A step that normally takes 800ms with a std of 150ms will flag a 1,400ms call (z = +4.0) but not a 900ms call (z = +0.67).
      </P>
      <div className="space-y-2 mb-6">
        {[
          { code: '5001', metric: 'latency_ms',    desc: 'Call latency deviates more than 3σ from this step\'s historical mean.' },
          { code: '5002', metric: 'total_tokens',  desc: 'Total tokens deviate more than 3σ from this step\'s mean.' },
          { code: '5003', metric: 'cost',          desc: 'Call cost deviates more than 3σ from this step\'s mean.' },
          { code: '5004', metric: 'output_tokens', desc: 'Output tokens deviate more than 3σ from this step\'s mean.' },
        ].map((r) => (
          <div key={r.code} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="font-mono text-xs text-violet-400 w-12 shrink-0">{r.code}</span>
            <span className="font-mono text-xs text-gray-400 w-28 shrink-0">{r.metric}</span>
            <span className="text-sm text-gray-400">{r.desc}</span>
          </div>
        ))}
      </div>
      <Callout type="tip">
        <strong>Why z-score over p95?</strong> A fixed p95 ceiling treats all variation the same. Z-scores adapt to each step&apos;s natural variance — a creative generation step with high natural variance needs a wider band than a fast classification step with tight variance. The std captures this automatically.
      </Callout>
      <P>
        Below 20 calls per step, L5 is inactive and L4&apos;s static thresholds serve as the fallback. Once L5 activates, L4&apos;s raw latency/token/cost checks (4001/4002/4003) defer to it to avoid double-counting the same metric.
      </P>

      <H2>Trend detection</H2>
      <P>
        The <strong className="text-gray-200">Steps tab</strong> in the dashboard compares each step&apos;s recent window (last 10 calls) against its baseline window (calls 11–60) to detect gradual degradation that per-call anomaly detection misses.
      </P>
      <div className="space-y-2 mb-6">
        {[
          { status: 'healthy',   color: 'text-green-400  bg-green-900/30',  desc: 'Recent metrics are within 1.5σ of baseline. No drift detected.' },
          { status: 'degrading', color: 'text-yellow-400 bg-yellow-900/30', desc: 'At least one metric has drifted 1.5–3σ from baseline.' },
          { status: 'critical',  color: 'text-red-400    bg-red-900/30',    desc: 'At least one metric has drifted more than 3σ from baseline.' },
          { status: 'warming',   color: 'text-gray-500   bg-gray-800/40',   desc: 'Not enough call history yet. Shows progress toward the 20-call activation threshold.' },
        ].map((r) => (
          <div key={r.status} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3 items-center">
            <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${r.color}`}>{r.status}</span>
            <span className="text-sm text-gray-400">{r.desc}</span>
          </div>
        ))}
      </div>
      <P>
        Trend detection requires at least 30 calls per step (20 baseline + 10 recent). It runs on every dashboard load and catches slow latency creep, cost drift, and throughput degradation that individual call scores would miss.
      </P>

      <H2>AI run analysis</H2>
      <P>
        Open any run in the dashboard and click <strong className="text-gray-200">✦ Analyze Run</strong>. trace.ai sends the full run context — every step, every anomaly score, every condition code — to <code className="text-indigo-300 text-sm font-mono">claude-sonnet-4-6</code> and returns a structured report.
      </P>
      <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/20 px-5 py-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-indigo-400 text-xs">✦</span>
          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Example output</span>
        </div>
        <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
          <div>
            <span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Summary</span>
            <p className="mt-1">The pipeline failed at generate-response, but completed 2 of 3 steps. Total anomaly score: 295pts across 3 steps.</p>
          </div>
          <div>
            <span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Root cause</span>
            <p className="mt-1">parse-request returned malformed JSON (unclosed bracket). This propagated into enrich-context causing a stall, then crashed generate-response with a null-reference when it attempted to read the entity list.</p>
          </div>
          <div>
            <span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Recommendations</span>
            <ul className="mt-1 space-y-1">
              <li>— Add JSON.parse validation after parse-request before passing output downstream</li>
              <li>— Add a retry with exponential backoff on enrich-context when input is null</li>
              <li>— Set a latency budget on enrich-context (currently 6.4s with 3 output tokens)</li>
            </ul>
          </div>
        </div>
      </div>
      <Callout type="info">
        Analysis cost is tracked per project in the <strong>Usage</strong> tab and counts toward your monthly budget.
      </Callout>
    </div>
  );
}

// ── Section: Integrations ─────────────────────────────────────────────────────

function SectionIntegrations() {
  return (
    <div>
      <P>Both integrations are configured per-project in <strong className="text-gray-200">Settings</strong> — no code changes needed.</P>

      <H2>Slack</H2>
      <P>Paste a Slack <a href="https://api.slack.com/messaging/webhooks" className="text-indigo-400 hover:text-indigo-300 underline" target="_blank" rel="noreferrer">Incoming Webhook URL</a> into project settings. trace.ai posts alerts when:</P>
      <div className="space-y-2 mb-4">
        {[
          { trigger: 'Step error',       desc: 'Any call where status_success=false fires immediately with step name, model, error message, and run ID.' },
          { trigger: 'Error rate spike', desc: 'If more than N% of the last M calls fail, a rate alert fires. Both thresholds are configurable (default: 25% over 20 calls). 5 min cooldown.' },
          { trigger: 'Anomaly',          desc: 'Fires when a run\'s anomaly score crosses the threshold. Configurable: critical only (≥100pts), warning + critical, or off. 1 min cooldown.' },
          { trigger: 'Budget exceeded',  desc: 'When monthly AI analysis spend crosses your configured budget. One-time alert per hour.' },
        ].map((r) => (
          <div key={r.trigger} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="shrink-0 text-sm font-semibold text-gray-300 w-32">{r.trigger}</span>
            <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
          </div>
        ))}
      </div>
      <Callout type="tip">
        Use the <strong>Test</strong> button in Settings to confirm delivery before going live.
      </Callout>

      <H2>Sentry</H2>
      <P>Add your Sentry project DSN in Settings. trace.ai sends two types of data, isolated from your own backend&apos;s Sentry client:</P>
      <div className="space-y-2 mb-6">
        {[
          { trigger: 'Performance transactions', desc: 'Every LLM call becomes a Sentry transaction named after its step. Latency, tokens, cost, and anomaly score appear as measurements. All steps in the same run share a trace_id so Sentry\'s distributed trace view reconstructs your full pipeline as a waterfall.' },
          { trigger: 'Anomaly events',           desc: 'When a call crosses the anomaly threshold, a structured error event fires into your Sentry issues feed. Repeated failures on the same step fingerprint into one issue rather than spamming.' },
        ].map((r) => (
          <div key={r.trigger} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="shrink-0 text-sm font-semibold text-gray-300 w-44">{r.trigger}</span>
            <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
          </div>
        ))}
      </div>
      <P>Where to find your data in Sentry:</P>
      <div className="space-y-2 mb-4">
        {[
          { path: 'Explore → Traces', desc: 'All LLM calls as transactions. Click any row to see the span waterfall — root span op:ai.inference, child span op:ai.model.invoke with gen_ai.usage.* attributes.' },
          { path: 'Issues',           desc: 'Anomaly events grouped by step name. Each issue shows the full condition breakdown, anomaly score, and a link to the run.' },
        ].map((r) => (
          <div key={r.path} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="shrink-0 text-sm font-semibold text-indigo-300 font-mono text-xs w-36 pt-0.5">{r.path}</span>
            <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
          </div>
        ))}
      </div>
      <H3>Alert levels</H3>
      <div className="space-y-2 mb-6">
        {[
          { level: 'Critical only',      desc: 'Anomaly events fire when total score ≥ 100 pts. Sent as error-level.' },
          { level: 'Warning + critical', desc: 'Fires for any anomaly hit, even sub-threshold. Warnings sent as warning-level.' },
          { level: 'Off',               desc: 'No Sentry output — DSN saved but nothing sent.' },
        ].map((r) => (
          <div key={r.level} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
            <span className="shrink-0 text-sm font-semibold text-gray-300 w-36">{r.level}</span>
            <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
          </div>
        ))}
      </div>
      <Callout type="info">
        Performance spans follow <a href="https://opentelemetry.io/docs/specs/semconv/gen-ai/" className="text-indigo-400 hover:text-indigo-300 underline" target="_blank" rel="noreferrer">OpenTelemetry GenAI semantic conventions</a> — <code className="font-mono text-xs">gen_ai.usage.input_tokens</code>, <code className="font-mono text-xs">gen_ai.system: &quot;anthropic&quot;</code> — compatible with Sentry&apos;s native AI monitoring.
      </Callout>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState<Section>('start');

  const content: Record<Section, React.ReactNode> = {
    start:        <SectionStart />,
    sdk:          <SectionSDK />,
    detection:    <SectionDetection />,
    integrations: <SectionIntegrations />,
  };

  return (
    <div className="min-h-screen bg-[#080808] text-gray-100">

      {/* Top nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#080808]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-white tracking-tight hover:opacity-80 transition-opacity">
            <img src="/logo.svg" alt="" className="w-6 h-6" />
            trace.ai
          </Link>
          <div className="flex items-center gap-6">
            <span className="text-sm text-indigo-400 font-medium">Docs</span>
            <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">Sign in</Link>
            <Link href="/login" className="text-sm font-medium px-4 py-1.5 rounded-lg bg-white text-gray-950 hover:bg-gray-100 transition-colors">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 flex gap-10">

        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0 pt-10">
          <div className="sticky top-24 space-y-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={[
                  'w-full text-left px-3 py-2.5 rounded-xl transition-colors',
                  active === s.id
                    ? 'bg-white/8 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/4',
                ].join(' ')}
              >
                <div className={`text-sm font-medium ${active === s.id ? 'text-white' : 'text-gray-400'}`}>{s.label}</div>
                <div className="text-[11px] text-gray-600 mt-0.5">{s.sub}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 pt-10 max-w-2xl">

          {/* Section header */}
          <div className="mb-10">
            <div className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-2">
              {SECTIONS.find(s => s.id === active)?.label}
            </div>
            <h1 className="text-3xl font-bold text-white">
              {active === 'start'        && 'Getting started'}
              {active === 'sdk'          && 'SDK reference'}
              {active === 'detection'    && 'Anomaly detection'}
              {active === 'integrations' && 'Integrations'}
            </h1>
          </div>

          {content[active]}

          {/* Bottom nav */}
          <div className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between">
            {SECTIONS.findIndex(s => s.id === active) > 0 ? (
              <button
                onClick={() => setActive(SECTIONS[SECTIONS.findIndex(s => s.id === active) - 1].id)}
                className="text-sm text-gray-500 hover:text-white transition-colors flex items-center gap-2"
              >
                ← {SECTIONS[SECTIONS.findIndex(s => s.id === active) - 1].label}
              </button>
            ) : <div />}
            {SECTIONS.findIndex(s => s.id === active) < SECTIONS.length - 1 ? (
              <button
                onClick={() => setActive(SECTIONS[SECTIONS.findIndex(s => s.id === active) + 1].id)}
                className="text-sm text-gray-500 hover:text-white transition-colors flex items-center gap-2"
              >
                {SECTIONS[SECTIONS.findIndex(s => s.id === active) + 1].label} →
              </button>
            ) : (
              <Link href="/login" className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                Get started free →
              </Link>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}
