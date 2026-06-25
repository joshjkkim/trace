'use client';

import Link from 'next/link';
import { useState } from 'react';

// ── Shared components ─────────────────────────────────────────────────────────

function Code({ children, lang = 'ts' }: { children: string; lang?: string }) {
  return (
    <div className="border border-white/8 overflow-hidden my-5 bg-black">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/8">
        <span className="text-[10px] font-mono text-gray-700 uppercase tracking-widest">{lang}</span>
      </div>
      <pre className="px-5 py-4 text-xs font-mono text-violet-300 overflow-x-auto leading-6 whitespace-pre">{children}</pre>
    </div>
  );
}

function Callout({ type = 'info', children }: { type?: 'info' | 'warn' | 'tip'; children: React.ReactNode }) {
  const border = { info: 'border-violet-600', warn: 'border-yellow-600', tip: 'border-green-600' };
  return (
    <div className={`border-l-2 ${border[type]} pl-4 my-5 py-1`}>
      <div className="font-mono text-xs text-gray-500 leading-6">{children}</div>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-sans font-black text-xl text-white mt-12 mb-4 first:mt-0">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-sans font-bold text-sm text-white mt-8 mb-3 uppercase tracking-widest">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-gray-500 leading-6 mb-4">{children}</p>;
}

function Table({ rows }: { rows: { f: string; t?: string; d: string }[] }) {
  return (
    <div className="border border-white/8 overflow-hidden mb-6">
      <table className="w-full">
        <tbody className="divide-y divide-white/8">
          {rows.map((r) => (
            <tr key={r.f} className="hover:bg-white/2 transition-colors">
              <td className="px-4 py-3 font-mono text-[11px] text-gray-300 align-top w-36 shrink-0">{r.f}</td>
              {r.t && <td className="px-4 py-3 font-mono text-[11px] text-violet-400 align-top w-20">{r.t}</td>}
              <td className="px-4 py-3 font-mono text-[11px] text-gray-600 leading-5">{r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ items }: { items: { key: string; label?: string; color?: string; value: string }[] }) {
  return (
    <div className="border border-white/8 divide-y divide-white/8 mb-6">
      {items.map((r) => (
        <div key={r.key} className="flex gap-4 px-4 py-3 hover:bg-white/2 transition-colors">
          <span className={`font-mono text-[11px] shrink-0 w-32 ${r.color ?? 'text-gray-400'}`}>{r.key}</span>
          {r.label && <span className="font-mono text-[11px] text-gray-300 shrink-0 w-20">{r.label}</span>}
          <span className="font-mono text-[11px] text-gray-600 leading-5">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

type Section = 'start' | 'sdk' | 'detection' | 'integrations';

const SECTIONS: { id: Section; label: string; sub: string }[] = [
  { id: 'start',        label: 'Getting started', sub: 'quick start, concepts, install' },
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
        Find your API key in the dashboard under <strong className="text-gray-300">Settings → API Key</strong> for each project.
      </Callout>

      <H2>Core concepts</H2>
      <Rows items={[
        { key: 'Project', value: 'An isolated workspace with its own API key, dashboard, and alert config. One API key = one project.' },
        { key: 'Run',     value: 'A single end-to-end execution of your AI pipeline — one user request handled by multiple steps. All steps sharing a run_id are grouped together.' },
        { key: 'Step',    value: 'A single LLM call within a run. Named with _trace: { stepName }. Captures model, tokens, latency, cost, and output.' },
        { key: 'Profile', value: 'The semantic identity of a step — derived from its system prompt embedding. Stable across renames and minor prompt tweaks. Foundation of per-step baselines.' },
      ]} />

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
      <P>Returns a drop-in replacement for the Anthropic client. Intercepts every <code className="text-violet-400 font-mono">messages.create()</code> call, forwards it unchanged, and automatically ingests the trace after the response returns.</P>
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
      <P><strong className="text-gray-300">Key concept for multi-step pipelines.</strong> Calling <code className="text-violet-400 font-mono">anthropic.run()</code> creates a <code className="text-violet-400 font-mono">TracedRun</code> — a fresh execution context with its own <code className="text-violet-400 font-mono">run_id</code>. Every step on that run is grouped together in the dashboard.</P>
      <Callout type="warn">
        Without <code className="text-gray-300">run()</code>, all calls share the tracer&apos;s single runId and appear as one run. For multi-step workflows, always call <code className="text-gray-300">run()</code> at the start of each user request.
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
      <P><code className="text-violet-400 font-mono">messages.stream()</code> is fully supported. Tokens and latency are captured after the stream ends — zero impact on streaming latency.</P>
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
      <P>Add <code className="text-violet-400 font-mono">_trace: {'{ stepName: \'...\' }'}</code> to give a step a human-readable name. Without it, steps are auto-named from the first 4 words of the system prompt.</P>
      <Callout type="tip">
        <strong className="text-gray-300">Keep system prompts as static templates.</strong> Dynamic content (user input, runtime values) should live in the messages array, not the system prompt. trace.ai uses the system prompt to build a stable semantic fingerprint — dynamic system prompts create duplicate profiles.
      </Callout>
      <Code>{`// ✓ Good — static system prompt, dynamic user message
await run.messages.create({
  system: 'Extract named entities from the user message. Return JSON.',
  messages: [{ role: 'user', content: userInput }],
  _trace: { stepName: 'extract-entities' },
} as TracedMessageParams)

// ✗ Bad — dynamic content in system prompt breaks fingerprinting
await run.messages.create({
  system: \`You are helping \${userName} with \${topic}.\`,
  messages: [{ role: 'user', content: userInput }],
} as TracedMessageParams)`}</Code>

      <H2>Manual ingest</H2>
      <P>For steps outside the Anthropic client — external APIs, custom models, pre-computed results — use <code className="text-violet-400 font-mono">tracer.ingest()</code> directly.</P>
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
      <P>Every ingested call is scored by a 4-layer engine running in the background. No configuration required. Scores accumulate — a single L1 hit (100 pts) is immediately critical. L2–L4 conditions score 10–60 pts each and require several to fire before crossing threshold. The engine short-circuits once score ≥ 100 pts.</P>

      <div className="border border-white/8 divide-y divide-white/8 mb-8">
        {[
          { layer: 'L1', accent: 'border-red-600',    label: 'text-red-400',    title: 'Hard failures',        desc: 'Deterministic, non-heuristic. status_success=false, error present, token accounting mismatch (total ≠ input+output), negative counts. Any single hit → 100pts → immediate trigger.' },
          { layer: 'L2', accent: 'border-orange-600', label: 'text-orange-400', title: 'Format violations',    desc: 'Prompt-implied output contracts. Prompt asks for JSON but output isn\'t valid JSON. Yes/no prompt but output is prose. Enum step returned a non-enumerated value.' },
          { layer: 'L4', accent: 'border-blue-600',   label: 'text-blue-400',   title: 'Numeric thresholds',   desc: 'Static and adaptive p95 limits for latency, tokens, cost. Stall detection (high latency, near-zero output). Cross-field plausibility checks. Defers 4001/4002/4003 to L5 when baseline is active.' },
          { layer: 'L5', accent: 'border-violet-600', label: 'text-violet-400', title: 'Statistical baseline', desc: 'Per-step z-score against that step\'s own historical mean and std. Activates after 20 clean calls. A high-variance step automatically gets a wider band. Owns latency/tokens/cost scoring when active.' },
        ].map((l) => (
          <div key={l.layer} className={`flex gap-4 px-4 py-4 border-l-2 ${l.accent} hover:bg-white/2 transition-colors`}>
            <span className={`font-mono text-xs font-bold shrink-0 w-6 mt-0.5 ${l.label}`}>{l.layer}</span>
            <div>
              <div className="font-sans font-bold text-sm text-white mb-1">{l.title}</div>
              <p className="font-mono text-[11px] text-gray-600 leading-5">{l.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <H2>Step identity and fingerprinting</H2>
      <P>Each step is assigned a stable semantic identity called a <strong className="text-gray-300">step profile</strong> — derived from the embedding of its system prompt using a local sentence-transformers model (all-MiniLM-L6-v2, 384 dimensions). This identity persists across renames, minor prompt rewrites, and pipeline restructuring.</P>
      <Rows items={[
        { key: '> 0.92',    label: 'matched', color: 'text-green-500',  value: 'Same step. Uses the existing profile — anomaly baselines are stable.' },
        { key: '0.75–0.92', label: 'evolved', color: 'text-yellow-500', value: 'Same step but prompt has meaningfully drifted. Profile kept, last_evolved_at stamped. Baseline resets to post-evolution calls only.' },
        { key: '< 0.75',    label: 'new',     color: 'text-violet-400', value: 'Genuinely new step. A new profile is created with its own baseline.' },
      ]} />
      <Callout type="info">
        Fingerprinting runs asynchronously — it never adds latency to your application. The step_profile_id is backfilled on the CALLS row within a few seconds of ingest.
      </Callout>

      <H2>L5 — statistical detection</H2>
      <P>Once a step has 20+ calls, trace.ai computes a per-step baseline: the mean and standard deviation of latency, tokens, and cost. Each new call is scored as a z-score:</P>
      <div className="border border-white/8 bg-black px-5 py-4 mb-5 font-mono text-sm text-gray-300">
        z = (observed − mean) / std
      </div>
      <P>If |z| &gt; 3, L5 fires. A step that normally takes 800ms ± 150ms std flags a 1,400ms call (z = +4.0) but not a 900ms call (z = +0.67).</P>
      <Rows items={[
        { key: '5001', label: 'latency_ms',    color: 'text-violet-400', value: 'Call latency deviates more than 3σ from this step\'s historical mean.' },
        { key: '5002', label: 'total_tokens',  color: 'text-violet-400', value: 'Total tokens deviate more than 3σ from this step\'s mean.' },
        { key: '5003', label: 'cost',          color: 'text-violet-400', value: 'Call cost deviates more than 3σ from this step\'s mean.' },
        { key: '5004', label: 'output_tokens', color: 'text-violet-400', value: 'Output tokens deviate more than 3σ from this step\'s mean.' },
      ]} />
      <Callout type="tip">
        <strong className="text-gray-300">Why z-score over p95?</strong> A fixed p95 ceiling treats all variation the same. Z-scores adapt to each step&apos;s natural variance — a creative generation step with high variance needs a wider band than a tight classification step. The std captures this automatically.
      </Callout>
      <P>Below 20 calls per step, L5 is inactive and L4&apos;s static thresholds serve as fallback. The baseline also excludes: calls using a different model, calls before the last prompt evolution timestamp, and calls that themselves triggered anomalies.</P>

      <H2>Trend detection</H2>
      <P>The Steps tab compares each step&apos;s recent window (last 10 calls) against its baseline window (calls 11–60) to detect gradual degradation that per-call scoring misses.</P>
      <Rows items={[
        { key: 'healthy',   color: 'text-green-500',  value: 'Recent metrics are within 1.5σ of baseline. No drift detected.' },
        { key: 'degrading', color: 'text-yellow-500', value: 'At least one metric has drifted 1.5–3σ from baseline.' },
        { key: 'critical',  color: 'text-red-500',    value: 'At least one metric has drifted more than 3σ from baseline.' },
        { key: 'warming',   color: 'text-gray-600',   value: 'Not enough call history yet. Shows progress toward the 20-call activation threshold.' },
      ]} />
      <P>Trend detection requires at least 30 calls per step (20 baseline + 10 recent). It catches slow latency creep, cost drift, and throughput degradation that individual call scores would miss.</P>

      <H2>AI run analysis</H2>
      <P>Open any run and click <strong className="text-gray-300">✦ Analyze Run</strong>. trace.ai sends the full run context — every step, every anomaly score, every condition code — to claude-sonnet-4-6 and returns a structured report.</P>
      <div className="border border-white/8 border-l-2 border-l-violet-600 bg-black px-5 py-4 mb-5">
        <div className="font-mono text-[10px] text-violet-500 uppercase tracking-widest mb-3">Example output</div>
        <div className="space-y-3 font-mono text-[11px] text-gray-600 leading-5">
          <div><span className="text-gray-400 font-bold">Root cause</span><p className="mt-1">parse-request returned malformed JSON (unclosed bracket). This propagated into enrich-context causing a stall, then crashed generate-response with a null-reference when it attempted to read the entity list.</p></div>
          <div><span className="text-gray-400 font-bold">Recommendations</span>
            <p className="mt-1">— Add JSON.parse validation after parse-request before passing downstream</p>
            <p>— Add a retry with exponential backoff on enrich-context when input is null</p>
            <p>— Set a latency budget on enrich-context (currently 6.4s with 3 output tokens)</p>
          </div>
        </div>
      </div>
      <Callout type="info">
        Analysis cost is tracked per project in the <strong className="text-gray-300">Usage</strong> tab and counts toward your monthly budget.
      </Callout>
    </div>
  );
}

// ── Section: Integrations ─────────────────────────────────────────────────────

function SectionIntegrations() {
  return (
    <div>
      <P>Both integrations are configured per-project in <strong className="text-gray-300">Settings</strong> — no code changes needed.</P>

      <H2>Slack</H2>
      <P>Paste a Slack <a href="https://api.slack.com/messaging/webhooks" className="text-violet-400 hover:text-violet-300 underline underline-offset-4" target="_blank" rel="noreferrer">Incoming Webhook URL</a> into project settings. trace.ai posts alerts when:</P>
      <Rows items={[
        { key: 'Step error',       value: 'Any call where status_success=false fires immediately with step name, model, error message, and run ID.' },
        { key: 'Error rate spike', value: 'If more than N% of the last M calls fail, a rate alert fires. Both thresholds are configurable (default: 25% over 20 calls). 5 min cooldown.' },
        { key: 'Anomaly',          value: 'Fires when a run\'s anomaly score crosses the threshold. Configurable: critical only (≥100pts), warning + critical, or off. 1 min cooldown.' },
        { key: 'Budget exceeded',  value: 'When monthly AI analysis spend crosses your configured budget. One-time alert per hour.' },
      ]} />
      <Callout type="tip">
        Use the <strong className="text-gray-300">Test</strong> button in Settings to confirm delivery before going live.
      </Callout>

      <H2>Sentry</H2>
      <P>Add your Sentry project DSN in Settings. trace.ai sends two types of data, isolated from your own backend&apos;s Sentry client:</P>
      <Rows items={[
        { key: 'Performance transactions', value: 'Every LLM call becomes a Sentry transaction named after its step. Latency, tokens, cost, and anomaly score appear as measurements. All steps in the same run share a trace_id so Sentry\'s distributed trace view reconstructs your full pipeline as a waterfall.' },
        { key: 'Anomaly events',           value: 'When a call crosses the anomaly threshold, a structured error event fires into your Sentry issues feed. Repeated failures on the same step fingerprint into one issue rather than spamming.' },
      ]} />

      <H3>Where to find your data</H3>
      <Rows items={[
        { key: 'Explore → Traces', color: 'text-violet-400', value: 'All LLM calls as transactions. Click any row to see the span waterfall — op:ai.inference root, op:ai.model.invoke child with gen_ai.usage.* attributes.' },
        { key: 'Issues',           color: 'text-violet-400', value: 'Anomaly events grouped by step name. Each issue shows the full condition breakdown, anomaly score, and a link to the run.' },
      ]} />

      <H3>Alert levels</H3>
      <Rows items={[
        { key: 'Critical only',      value: 'Anomaly events fire when total score ≥ 100 pts. Sent as error-level.' },
        { key: 'Warning + critical', value: 'Fires for any anomaly hit, even sub-threshold. Warnings sent as warning-level.' },
        { key: 'Off',               value: 'No Sentry output — DSN saved but nothing sent.' },
      ]} />
      <Callout type="info">
        Performance spans follow <a href="https://opentelemetry.io/docs/specs/semconv/gen-ai/" className="text-violet-400 hover:text-violet-300 underline underline-offset-4" target="_blank" rel="noreferrer">OpenTelemetry GenAI semantic conventions</a> — gen_ai.usage.input_tokens, gen_ai.system: &quot;anthropic&quot; — compatible with Sentry&apos;s native AI monitoring.
      </Callout>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState<Section>('start');
  const idx = SECTIONS.findIndex(s => s.id === active);

  const content: Record<Section, React.ReactNode> = {
    start:        <SectionStart />,
    sdk:          <SectionSDK />,
    detection:    <SectionDetection />,
    integrations: <SectionIntegrations />,
  };

  return (
    <div className="min-h-screen bg-black text-white antialiased">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/8 bg-black">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-sans font-black text-sm text-white">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            trace.ai
          </Link>
          <div className="flex items-center gap-6">
            <span className="font-mono text-[11px] text-violet-500">docs</span>
            <Link href="/login" className="font-mono text-[11px] text-gray-600 hover:text-white transition-colors">sign in</Link>
            <Link href="/login" className="font-mono text-[11px] font-bold px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white transition-colors">
              get started →
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24 flex gap-0">

        {/* Sidebar */}
        <aside className="hidden lg:block w-52 shrink-0 pt-12 border-r border-white/8">
          <div className="sticky top-24 pr-6">
            <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-4">Documentation</p>
            <div className="space-y-px">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={[
                    'w-full text-left px-3 py-2.5 border-l-2 transition-colors',
                    active === s.id
                      ? 'border-violet-600 bg-white/3'
                      : 'border-transparent hover:border-white/15 hover:bg-white/2',
                  ].join(' ')}
                >
                  <div className={`font-mono text-xs ${active === s.id ? 'text-white' : 'text-gray-500'}`}>{s.label}</div>
                  <div className="font-mono text-[10px] text-gray-700 mt-0.5">{s.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 pt-12 pl-0 lg:pl-12 max-w-2xl">

          {/* Section header */}
          <div className="mb-10 pb-6 border-b border-white/8">
            <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">
              {SECTIONS[idx]?.label}
            </p>
            <h1 className="font-sans font-black text-4xl text-white">
              {active === 'start'        && 'Getting started'}
              {active === 'sdk'          && 'SDK reference'}
              {active === 'detection'    && 'Anomaly detection'}
              {active === 'integrations' && 'Integrations'}
            </h1>
          </div>

          {content[active]}

          {/* Bottom pagination */}
          <div className="mt-16 pt-8 border-t border-white/8 flex items-center justify-between">
            {idx > 0 ? (
              <button
                onClick={() => setActive(SECTIONS[idx - 1].id)}
                className="font-mono text-xs text-gray-600 hover:text-white transition-colors"
              >
                ← {SECTIONS[idx - 1].label}
              </button>
            ) : <div />}
            {idx < SECTIONS.length - 1 ? (
              <button
                onClick={() => setActive(SECTIONS[idx + 1].id)}
                className="font-mono text-xs text-gray-600 hover:text-white transition-colors"
              >
                {SECTIONS[idx + 1].label} →
              </button>
            ) : (
              <Link href="/login" className="font-mono text-xs font-bold px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white transition-colors">
                get started free →
              </Link>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}
