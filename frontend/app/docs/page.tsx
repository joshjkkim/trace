import Link from 'next/link';

const NAV = [
  { id: 'quickstart',    label: 'Quick start' },
  { id: 'concepts',      label: 'Core concepts' },
  { id: 'installation',  label: 'Installation' },
  { id: 'tracer',        label: 'new Tracer()' },
  { id: 'wrap',          label: 'wrapAnthropic()' },
  { id: 'run',           label: 'run()' },
  { id: 'streaming',     label: 'Streaming' },
  { id: 'steps',         label: 'Naming steps' },
  { id: 'manual',        label: 'Manual ingest' },
  { id: 'anomalies',     label: 'Anomaly detection' },
  { id: 'analysis',      label: 'AI analysis' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'slack',         label: '↳ Slack' },
  { id: 'sentry',        label: '↳ Sentry' },
];

function Code({ children, lang = 'ts' }: { children: string; lang?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-gray-950 overflow-hidden my-4">
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5">
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

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl font-bold text-white mt-16 mb-4 scroll-mt-20 flex items-center gap-3">
      <a href={`#${id}`} className="hover:opacity-60 transition-opacity">{children}</a>
    </h2>
  );
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-base font-semibold text-gray-200 mt-8 mb-3 scroll-mt-20">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-400 leading-relaxed mb-4">{children}</p>;
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-gray-100">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#080808]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-semibold text-white tracking-tight hover:opacity-80 transition-opacity">
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

      <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 flex gap-12">

        {/* Sidebar */}
        <aside className="hidden lg:block w-48 shrink-0 pt-10">
          <div className="sticky top-24 space-y-1">
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-3 px-3">SDK</p>
            {NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block px-3 py-1.5 text-sm text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 pt-10 max-w-2xl">

          <div className="mb-12">
            <div className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">Documentation</div>
            <h1 className="text-4xl font-bold text-white mb-4">trace.ai SDK</h1>
            <p className="text-lg text-gray-400 leading-relaxed">
              Two lines of code to start tracing every LLM call in your application — tokens, latency, cost, anomaly scores, and AI-powered analysis.
            </p>
          </div>

          {/* Quick start */}
          <H2 id="quickstart">Quick start</H2>
          <Code>{`import { Tracer } from '@trace-ai/sdk'
import Anthropic from '@anthropic-ai/sdk'

const tracer = new Tracer({ apiKey: 'trace_...' })
const anthropic = tracer.wrapAnthropic(new Anthropic())

// Use exactly like the normal Anthropic client
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello!' }],
})

// Every call is now automatically traced in your dashboard`}</Code>

          <Callout type="info">
            Find your API key in the trace.ai dashboard under <strong>Settings → API Key</strong> for each project.
          </Callout>

          {/* Core concepts */}
          <H2 id="concepts">Core concepts</H2>
          <P>trace.ai organises your LLM activity into three levels:</P>
          <div className="space-y-3 mb-6">
            {[
              { term: 'Project', def: 'An isolated workspace with its own API key, dashboard, and alert configuration. One API key = one project.' },
              { term: 'Run', def: 'A single end-to-end execution of your AI workflow — e.g. one user request handled by a multi-step pipeline. Each run has a unique run_id that groups its steps together.' },
              { term: 'Step', def: 'A single LLM call within a run. Steps are ordered by step_index and named with _trace: { stepName }. Each step captures model, tokens, latency, cost, and output.' },
            ].map(({ term, def }) => (
              <div key={term} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
                <span className="shrink-0 text-sm font-semibold text-indigo-300 w-14">{term}</span>
                <span className="text-sm text-gray-400 leading-relaxed">{def}</span>
              </div>
            ))}
          </div>

          {/* Installation */}
          <H2 id="installation">Installation</H2>
          <Code lang="bash">npm install @trace-ai/sdk</Code>
          <P>The SDK is a thin wrapper — no background processes, no native dependencies. It works in Node.js 18+ and any runtime with the Fetch API.</P>

          {/* Tracer */}
          <H2 id="tracer">new Tracer(config)</H2>
          <P>The entry point. Create one instance per application (or per isolated environment).</P>
          <Code>{`const tracer = new Tracer({
  apiKey: 'trace_...',   // required — your project API key
  apiUrl: '...',         // optional — override for self-hosting / local dev
  runId:  '...',         // optional — provide your own run ID
})`}</Code>

          <div className="rounded-xl border border-white/6 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Option</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { opt: 'apiKey', type: 'string', desc: 'Your project API key. Required.' },
                  { opt: 'apiUrl', type: 'string?', desc: 'Custom ingest URL. Defaults to trace-ai servers.' },
                  { opt: 'runId',  type: 'string?', desc: 'Override the auto-generated run ID for this tracer.' },
                ].map((r) => (
                  <tr key={r.opt} className="text-gray-400">
                    <td className="px-4 py-3 font-mono text-xs text-gray-200">{r.opt}</td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-300">{r.type}</td>
                    <td className="px-4 py-3">{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* wrapAnthropic */}
          <H2 id="wrap">wrapAnthropic(client)</H2>
          <P>
            Returns a drop-in replacement for the Anthropic client. It intercepts every <code className="text-indigo-300 text-sm font-mono">messages.create()</code> call, forwards it to the real SDK unchanged, and automatically ingests the trace after the response returns.
          </P>
          <Code>{`import Anthropic from '@anthropic-ai/sdk'

const anthropic = tracer.wrapAnthropic(new Anthropic())

// Use it exactly like the original client — all params still work
const res = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Summarise this document...' }],
})`}</Code>
          <Callout type="tip">
            The original Anthropic client is not modified. You can keep a reference to both — the wrapped client for traced calls and the original for anything you don't want traced.
          </Callout>

          {/* run() */}
          <H2 id="run">run()</H2>
          <P>
            <strong className="text-gray-200">This is the key concept for multi-step pipelines.</strong> Calling <code className="text-indigo-300 text-sm font-mono">anthropic.run()</code> creates a <code className="text-indigo-300 text-sm font-mono">TracedRun</code> — a fresh execution context with its own unique <code className="text-indigo-300 text-sm font-mono">run_id</code>. Every step you call on that run is grouped together in the dashboard under the same run.
          </P>
          <Callout type="warn">
            Without <code>run()</code>, all calls share the tracer's single <code>runId</code> and appear as one long run. For multi-step workflows, always call <code>run()</code> at the start of each user request.
          </Callout>
          <Code>{`async function handleRequest(userMessage: string) {
  // Create a new run for this request — fresh run_id, step_index resets to 0
  const run = anthropic.run()

  // Step 1 — run_id: "a3f9...", step_index: 0
  const c1 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    messages: [{ role: 'user', content: \`Classify: "\${userMessage}"\` }],
    _trace: { stepName: 'classify-intent' },
  } as TracedMessageParams)

  // Step 2 — same run_id: "a3f9...", step_index: 1
  const c2 = await run.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: userMessage }],
    _trace: { stepName: 'generate-reply' },
  } as TracedMessageParams)

  // run.runId — the shared ID for both steps above
  console.log('run:', run.runId)
}`}</Code>
          <P>Each call to <code className="text-indigo-300 text-sm font-mono">anthropic.run()</code> creates a completely independent run. Parallel requests each get their own <code className="text-indigo-300 text-sm font-mono">run_id</code> — they never interfere.</P>

          {/* Streaming */}
          <H2 id="streaming">Streaming</H2>
          <P>
            <code className="text-indigo-300 text-sm font-mono">messages.stream()</code> is fully supported on both the wrapped client and <code className="text-indigo-300 text-sm font-mono">TracedRun</code>. Tokens and latency are captured after the stream ends — zero impact on streaming latency.
          </P>
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
// trace is ingested automatically once the stream completes`}</Code>
          <Callout type="info">
            The stream is returned immediately and passed through unchanged. Ingestion happens via <code className="font-mono text-xs">finalMessage()</code> as a fire-and-forget side effect — your streaming latency is unaffected.
          </Callout>

          {/* Naming steps */}
          <H2 id="steps">Naming steps</H2>
          <P>Add <code className="text-indigo-300 text-sm font-mono">_trace: {'{ stepName: \'...\' }'}</code> to any <code className="text-indigo-300 text-sm font-mono">messages.create()</code> call to give the step a human-readable name. Without it, steps are auto-named <code className="text-indigo-300 text-sm font-mono">step_1</code>, <code className="text-indigo-300 text-sm font-mono">step_2</code>, etc.</P>
          <Code>{`// Named steps appear in the dashboard and AI analysis reports
await run.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 64,
  messages: [...],
  _trace: { stepName: 'extract-entities' },  // ← name it
} as TracedMessageParams)`}</Code>
          <Callout type="tip">
            Use descriptive, consistent step names — the anomaly engine and AI analysis both reference them by name. Good names make root cause reports much more actionable.
          </Callout>

          {/* Manual ingest */}
          <H2 id="manual">Manual ingest</H2>
          <P>For steps outside of the Anthropic client (external API calls, custom model endpoints, pre-computed results), use <code className="text-indigo-300 text-sm font-mono">tracer.ingest()</code> directly.</P>
          <Code>{`await tracer.ingest({
  run_id:        'my-run-id',      // group with other steps
  step_name:     'fetch-context',
  step_index:    1,
  model:         'custom-model',
  prompt:        'What is the user asking?',
  input_tokens:  120,
  output_tokens: 48,
  total_tokens:  168,
  latency_ms:    340,
  cost:          0.0014,
  status_success: true,
  output_code:   'The user wants a refund.',
})`}</Code>

          <div className="rounded-xl border border-white/6 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-3 text-gray-500 font-medium w-40">Field</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { f: 'run_id',         d: 'Groups steps into a single run. Use run.runId from a TracedRun, or any UUID.' },
                  { f: 'step_name',      d: 'Human-readable name for this step. Shown in the dashboard and analysis.' },
                  { f: 'step_index',     d: 'Order within the run. Steps are sorted by this in the run graph.' },
                  { f: 'model',          d: 'Model identifier string, e.g. "claude-haiku-4-5-20251001".' },
                  { f: 'prompt',         d: 'The prompt sent to the model. For chat, use JSON.stringify({ system, messages }).' },
                  { f: 'input_tokens',   d: 'Input token count as reported by the model.' },
                  { f: 'output_tokens',  d: 'Output token count as reported by the model.' },
                  { f: 'total_tokens',   d: 'Should equal input + output. Mismatch triggers anomaly code 1007.' },
                  { f: 'latency_ms',     d: 'Wall-clock time from request start to response received.' },
                  { f: 'cost',           d: 'USD cost for this call. Use tracer cost helpers or compute manually.' },
                  { f: 'status_success', d: 'true if the call completed normally, false if it errored.' },
                  { f: 'output_code',    d: 'The model\'s response text. Used by the anomaly engine for shape analysis.' },
                  { f: 'error',          d: 'Error message string. Required when status_success is false.' },
                ].map((r) => (
                  <tr key={r.f} className="text-gray-400">
                    <td className="px-4 py-3 font-mono text-xs text-gray-200 align-top">{r.f}</td>
                    <td className="px-4 py-3 text-sm">{r.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Anomaly detection */}
          <H2 id="anomalies">Anomaly detection</H2>
          <P>
            Every ingested call is automatically scored by a 4-layer engine in the background. No configuration required — it runs on every call with zero overhead to your application.
          </P>
          <div className="space-y-3 mb-6">
            {[
              { layer: 'L1', color: 'text-red-400 border-red-900/50 bg-red-950/20', title: 'Hard failures', desc: 'status_success=false, error present, token accounting mismatch (total ≠ input+output), zero output with non-empty error.' },
              { layer: 'L2', color: 'text-orange-400 border-orange-900/40 bg-orange-950/10', title: 'Format violations', desc: 'Prompt asked for JSON but output isn\'t valid JSON. Prompt asked for yes/no but output is prose. Enum step returned a non-enumerated value.' },
              { layer: 'L3', color: 'text-yellow-400 border-yellow-900/40 bg-yellow-950/10', title: 'Shape fingerprinting', desc: 'Output shape doesn\'t match what the prompt asked for. Unbalanced brackets. Named JSON keys missing from the output. Word count violations.' },
              { layer: 'L4', color: 'text-blue-400 border-blue-900/40 bg-blue-950/10', title: 'Numeric anomalies', desc: 'Latency spikes, cost outliers, token ratio drift, stall patterns. Thresholds adapt to your project\'s baseline using p95 of recent calls — a project with consistently fast calls gets a tighter limit than one with variable latency.' },
            ].map((l) => (
              <div key={l.layer} className={`rounded-xl border px-4 py-4 ${l.color}`}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold font-mono text-xs">{l.layer}</span>
                  <span className="font-semibold text-sm text-gray-200">{l.title}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{l.desc}</p>
              </div>
            ))}
          </div>
          <P>Scores accumulate across layers. A single L1 hit (100 pts) is immediately critical. L4 conditions score 10–25 pts each and require several to fire before crossing the threshold. L4 limits are dynamic — once a project has 30+ calls, trace.ai computes the p95 of recent latency, token usage, and cost and uses that as the threshold instead of static defaults. You can also override them manually in <strong className="text-gray-200">Settings → L4 anomaly thresholds</strong>.</P>

          {/* AI analysis */}
          <H2 id="analysis">AI analysis</H2>
          <P>
            Open any run in the dashboard and click <strong className="text-gray-200">✦ Analyze Run</strong>. trace.ai sends the full run context — every step, every anomaly score, every condition code — to <code className="text-indigo-300 text-sm font-mono">claude-sonnet-4-6</code> and returns a structured report:
          </P>
          <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/20 px-5 py-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-indigo-400 text-xs">✦</span>
              <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Example output</span>
            </div>
            <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
              <div><span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Summary</span><p className="mt-1">The pipeline failed at generate-response, but the run completed 2 of 3 steps before crashing. Total anomaly score: 295pts across 3 steps.</p></div>
              <div><span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Root cause</span><p className="mt-1">parse-request returned malformed JSON (unclosed bracket). This propagated into enrich-context causing a stall, then crashed generate-response with a null-reference error when it attempted to read the entity list.</p></div>
              <div><span className="text-indigo-200 font-semibold uppercase tracking-wider text-[10px]">Recommendations</span><ul className="mt-1 space-y-1 list-none"><li>— Add JSON.parse validation after parse-request before passing output downstream</li><li>— Add a retry with exponential backoff on enrich-context when input is null</li><li>— Set a latency budget on enrich-context (currently 6.4s with 3 output tokens)</li></ul></div>
            </div>
          </div>
          <P>Analysis cost is tracked per project in the <code className="text-indigo-300 text-sm font-mono">USAGE</code> table and will appear in your billing dashboard.</P>

          {/* Integrations */}
          <H2 id="integrations">Integrations</H2>
          <P>
            trace.ai can push anomaly alerts to your existing tooling. Both integrations are configured per-project in <strong className="text-gray-200">Settings</strong> — no code changes needed.
          </P>

          <H3 id="slack">Slack</H3>
          <P>
            Paste a Slack <a href="https://api.slack.com/messaging/webhooks" className="text-indigo-400 hover:text-indigo-300 underline" target="_blank" rel="noreferrer">Incoming Webhook URL</a> into your project settings. trace.ai will post to that channel when:
          </P>
          <div className="space-y-2 mb-4">
            {[
              { trigger: 'Step error', desc: 'Any call where status_success is false fires an immediate alert with the step name, model, error message, and run ID.' },
              { trigger: 'Error rate spike', desc: 'If more than N% of the last M calls fail, a rate alert fires. Both thresholds are configurable (default: 25% over 20 calls).' },
            ].map((r) => (
              <div key={r.trigger} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
                <span className="shrink-0 text-sm font-semibold text-gray-300 w-28">{r.trigger}</span>
                <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
              </div>
            ))}
          </div>
          <Code>{`// No code needed — configure in Settings → Integrations
// Test your webhook with the "Send test ping" button`}</Code>
          <Callout type="tip">
            You can toggle <strong>Alert on error</strong> and set your own rate threshold in the Settings tab. Use the test button to confirm delivery before going live.
          </Callout>

          <H3 id="sentry">Sentry</H3>
          <P>
            Add your Sentry project's DSN and trace.ai fires anomaly events directly into your Sentry issues feed — completely isolated from your backend's own Sentry client. Each anomaly includes the full condition breakdown as tags.
          </P>
          <Code>{`// No code needed — paste your DSN in Settings → Integrations
// DSN format: https://<key>@<org>.ingest.sentry.io/<project>`}</Code>
          <P>Choose an alert level to control which anomalies reach Sentry:</P>
          <div className="space-y-2 mb-6">
            {[
              { level: 'Critical only', desc: 'Fires when total anomaly score ≥ 100 pts (any single L1 condition, or accumulated L2–L4). Shown as error-level in Sentry.' },
              { level: 'Warning + critical', desc: 'Fires for any anomaly hit, even sub-threshold warnings. Warnings are sent as warning-level events, criticals as errors.' },
              { level: 'Off', desc: 'Sentry integration disabled. DSN is saved but no events are sent.' },
            ].map((r) => (
              <div key={r.level} className="flex gap-4 rounded-xl border border-white/6 bg-white/2 px-4 py-3">
                <span className="shrink-0 text-sm font-semibold text-gray-300 w-36">{r.level}</span>
                <span className="text-sm text-gray-400 leading-relaxed">{r.desc}</span>
              </div>
            ))}
          </div>
          <Callout type="info">
            Events are fingerprinted by <code className="font-mono text-xs">step_name</code> — so repeated anomalies on the same step group into one Sentry issue instead of flooding your feed. Tags include <code className="font-mono text-xs">trace_ai.project</code>, <code className="font-mono text-xs">trace_ai.step</code>, <code className="font-mono text-xs">trace_ai.layer</code>, and the full <code className="font-mono text-xs">error_map</code> as extras.
          </Callout>

          {/* Bottom CTA */}
          <div className="mt-20 pt-10 border-t border-white/5 text-center">
            <p className="text-gray-500 text-sm mb-4">Ready to instrument your first pipeline?</p>
            <Link href="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors">
              Get started free →
            </Link>
          </div>

        </main>
      </div>
    </div>
  );
}
