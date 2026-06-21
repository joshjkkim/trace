import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-gray-100 antialiased">

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#080808]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-white tracking-tight">trace.ai</span>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block">Features</a>
            <a href="#integrations" className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block">Integrations</a>
            <Link href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block">Docs</Link>
            <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">Sign in</Link>
            <Link href="/login" className="text-sm font-medium px-4 py-1.5 rounded-lg bg-white text-gray-950 hover:bg-gray-100 transition-colors">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-40 pb-24 px-6 text-center relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[300px] h-[200px] bg-violet-600/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Now in beta — works with Anthropic
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white leading-[1.05] mb-6">
            Observability for<br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              AI workflows
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            trace.ai gives you real-time visibility into every LLM call — tokens, cost, latency,
            anomaly scores, and AI-powered root cause analysis. Two lines of code to get started.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
            <Link href="/login" className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors text-center">
              Start for free
            </Link>
            <a href="#how-it-works" className="w-full sm:w-auto px-6 py-3 rounded-xl border border-gray-700 hover:border-gray-500 text-gray-300 font-medium text-sm transition-colors text-center">
              See how it works
            </a>
          </div>

          {/* Code snippet */}
          <div className="max-w-xl mx-auto text-left rounded-2xl border border-white/8 bg-gray-950/80 overflow-hidden shadow-2xl">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
              <span className="w-3 h-3 rounded-full bg-red-500/60" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
              <span className="w-3 h-3 rounded-full bg-green-500/60" />
              <span className="text-xs text-gray-600 ml-2 font-mono">your-app.ts</span>
            </div>
            <pre className="px-5 py-5 text-sm font-mono leading-7 overflow-x-auto">
              <span className="text-gray-600">{`// Before`}</span>{`\n`}
              <span className="text-violet-300">const</span>
              <span className="text-gray-200">{` anthropic = `}</span>
              <span className="text-yellow-300">new</span>
              <span className="text-gray-200">{` Anthropic()\n\n`}</span>
              <span className="text-gray-600">{`// After — that's literally it`}</span>{`\n`}
              <span className="text-violet-300">const</span>
              <span className="text-gray-200">{` tracer = `}</span>
              <span className="text-yellow-300">new</span>
              <span className="text-blue-300">{` Tracer`}</span>
              <span className="text-gray-200">{`({ apiKey })\n`}</span>
              <span className="text-violet-300">const</span>
              <span className="text-gray-200">{` anthropic = tracer.`}</span>
              <span className="text-blue-300">wrapAnthropic</span>
              <span className="text-gray-200">{`(`}</span>
              <span className="text-yellow-300">new</span>
              <span className="text-gray-200">{` Anthropic())\n\n`}</span>
              <span className="text-gray-600">{`// Every call is now traced ✦`}</span>
            </pre>
          </div>
        </div>
      </section>

      {/* ── Metrics strip ── */}
      <section className="py-12 border-y border-white/5">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '< 1ms', label: 'Overhead per call' },
            { value: '4-layer', label: 'Anomaly scoring' },
            { value: 'Real-time', label: 'Dashboard updates' },
            { value: '1-click', label: 'AI root cause analysis' },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold text-white mb-1">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Everything your AI stack needs
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              From raw token counts to intelligent anomaly detection — trace.ai covers the full observability stack for LLM-powered products.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: '⚡',
                title: 'Real-time traces',
                desc: 'Every LLM call captured instantly — tokens, latency, cost, model, prompt, and output. Streamed live to your dashboard.',
              },
              {
                icon: '🔬',
                title: '4-layer anomaly engine',
                desc: 'Detects hard failures, format violations, output shape mismatches, and numeric anomalies. Scored, ranked, and explained.',
              },
              {
                icon: '✦',
                title: 'AI root cause analysis',
                desc: 'One click runs claude-sonnet-4-6 over your entire run. It reads every step and tells you exactly what went wrong and why.',
              },
              {
                icon: '📊',
                title: 'Cost & token tracking',
                desc: 'Per-step and per-run cost breakdown. Spot regressions before they hit your bill. Track model distribution over time.',
              },
              {
                icon: '🔔',
                title: 'Slack & Sentry alerts',
                desc: 'Critical anomalies fire to your Slack channel and your Sentry project — with full context, scores, and step details.',
              },
              {
                icon: '🔑',
                title: 'Project API keys',
                desc: 'Isolate projects, teams, and environments. Each key routes to its own dashboard with its own alert configuration.',
              },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/6 bg-white/2 p-6 hover:border-white/12 transition-colors">
                <div className="text-2xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Anomaly section ── */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-4">Anomaly Detection</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 leading-tight">
              Catch what logs can't
            </h2>
            <p className="text-gray-400 leading-relaxed mb-8">
              Hallucinations, malformed JSON, token accounting mismatches, output shape drift —
              these don't throw exceptions. They silently corrupt your pipeline.
              trace.ai's scoring engine catches them before your users do.
            </p>
            <div className="space-y-3">
              {[
                { layer: 'L1', name: 'Hard failures', desc: 'Status errors, missing output, token ghosts', color: 'text-red-400 bg-red-950/40 border-red-900/50' },
                { layer: 'L2', name: 'Format violations', desc: 'JSON contract broken, unexpected output type', color: 'text-orange-400 bg-orange-950/40 border-orange-900/50' },
                { layer: 'L3', name: 'Shape fingerprinting', desc: 'Output structure doesn\'t match what the prompt asked for', color: 'text-yellow-400 bg-yellow-950/40 border-yellow-900/50' },
                { layer: 'L4', name: 'Numeric anomalies', desc: 'Latency spikes, cost outliers, token ratio drift', color: 'text-blue-400 bg-blue-950/40 border-blue-900/50' },
              ].map((l) => (
                <div key={l.layer} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${l.color}`}>
                  <span className="text-xs font-bold font-mono shrink-0 mt-0.5">{l.layer}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-200">{l.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{l.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mock anomaly card */}
          <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-900 text-red-300 uppercase tracking-wider">Critical</span>
              <span className="text-sm font-mono text-gray-400">run a3f9…</span>
              <span className="text-xs text-red-400 font-semibold ml-auto">200 pts</span>
            </div>
            <div className="space-y-3">
              {[
                { step: 'parse-request', codes: ['2001 json_contract_violation +50', '3011 bracket_imbalance +25'], score: 75, warn: true },
                { step: 'enrich-context', codes: ['4007 high_latency_low_output +20'], score: 20, warn: true },
                { step: 'generate-response', codes: ['1001 status_failure +100', '1002 error_present +100'], score: 200, warn: false },
              ].map((s) => (
                <div key={s.step} className={`rounded-xl border px-4 py-3 ${s.warn ? 'border-yellow-800/40 bg-yellow-950/10' : 'border-red-800/60 bg-red-950/30'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono font-semibold text-gray-300">{s.step}</span>
                    <span className={`text-xs font-mono font-bold ${s.warn ? 'text-yellow-400' : 'text-red-400'}`}>{s.score}pts</span>
                  </div>
                  {s.codes.map((c) => (
                    <div key={c} className="text-[10px] font-mono text-gray-500">{c}</div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-white/5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-indigo-400 text-xs">✦</span>
                <span className="text-xs font-semibold text-indigo-300">AI Analysis</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                The pipeline failed in <span className="text-gray-200">generate-response</span>, but the root cause originated in <span className="text-gray-200">parse-request</span> — malformed JSON output propagated silently through enrich-context and caused a null-reference crash downstream.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrations ── */}
      <section id="integrations" className="py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Plug in to your existing stack</h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              trace.ai alerts fit into the tools your team already uses. Set them up in under a minute from your project settings.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">

            {/* Slack */}
            <div className="rounded-2xl border border-white/6 bg-white/2 p-7 hover:border-white/12 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#4A154B]/40 border border-[#4A154B]/60 flex items-center justify-center text-xl">
                  #
                </div>
                <div>
                  <h3 className="font-semibold text-white">Slack</h3>
                  <p className="text-xs text-gray-500">Webhook integration</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mb-5">
                Paste your Slack Incoming Webhook URL and get instant alerts when a step errors or your error rate crosses a threshold — right in your team channel.
              </p>
              <div className="space-y-2">
                {[
                  'Individual step error alerts',
                  'Error rate threshold alerts (e.g. &gt;25% in last 20 calls)',
                  'Configurable per project',
                  'Send a test ping from the dashboard',
                ].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="text-green-500 shrink-0">✓</span>
                    <span dangerouslySetInnerHTML={{ __html: f }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Sentry */}
            <div className="rounded-2xl border border-white/6 bg-white/2 p-7 hover:border-white/12 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#362d59]/40 border border-[#362d59]/80 flex items-center justify-center text-xl">
                  ⬡
                </div>
                <div>
                  <h3 className="font-semibold text-white">Sentry</h3>
                  <p className="text-xs text-gray-500">DSN integration</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mb-5">
                Add your project's Sentry DSN and anomalies fire directly into your Sentry issues feed — with full context, condition codes, and scores attached as tags.
              </p>
              <div className="space-y-2">
                {[
                  'Fires to your own Sentry project',
                  'Critical only, Warning + critical, or Off',
                  'Fingerprinted by step name (one issue per step)',
                  'Includes score, layer, and error codes as tags',
                ].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="text-green-500 shrink-0">✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <p className="text-center text-xs text-gray-600 mt-8">
            Both integrations are configured per-project in <strong className="text-gray-500">Settings → Integrations</strong>. No code changes needed.
          </p>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Up in under 5 minutes</h2>
          <p className="text-gray-400 mb-16">No agents, no config files, no infra to manage.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            {[
              {
                step: '01',
                title: 'Install the SDK',
                code: 'npm install @trace-ai/sdk',
              },
              {
                step: '02',
                title: 'Wrap your client',
                code: 'const anthropic = tracer.wrapAnthropic(new Anthropic())',
              },
              {
                step: '03',
                title: 'Watch your dashboard',
                code: '// Every call now appears in\n// trace.ai in real time',
              },
            ].map((s) => (
              <div key={s.step}>
                <div className="text-4xl font-bold text-white/10 mb-4 font-mono">{s.step}</div>
                <h3 className="font-semibold text-white mb-3">{s.title}</h3>
                <div className="rounded-lg bg-gray-950 border border-white/6 px-4 py-3">
                  <pre className="text-xs font-mono text-indigo-300 whitespace-pre-wrap">{s.code}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="absolute left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-indigo-600/8 rounded-full blur-3xl pointer-events-none" />
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 leading-tight relative">
            Start tracing your<br />AI pipeline today
          </h2>
          <p className="text-gray-400 mb-10 relative">
            Free to get started. No credit card required.
          </p>
          <Link href="/login" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors text-lg relative">
            Get started free
            <span className="text-indigo-300">→</span>
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-semibold text-white tracking-tight">trace.ai</span>
          <p className="text-xs text-gray-600">Built for developers who ship AI products.</p>
          <Link href="/login" className="text-sm text-gray-500 hover:text-white transition-colors">Sign in →</Link>
        </div>
      </footer>

    </div>
  );
}
