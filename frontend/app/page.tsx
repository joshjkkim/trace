'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

// ── Demo data ─────────────────────────────────────────────────────────────────

type DemoKey = 'ok' | 'latency' | 'json' | 'tokens'
interface Line { text: string; c?: string }

const DEMOS: Record<DemoKey, { label: string; lines: Line[] }> = {
  ok: {
    label: 'clean run',
    lines: [
      { text: '[tracer] connected  project=acme-ai', c: 'text-gray-600' },
      { text: '' },
      { text: '→ run:a3f9  classify-intent    ok    84ms    12tk  $0.000012', c: 'text-gray-300' },
      { text: '→ run:a3f9  extract-context    ok   340ms    89tk  $0.000089', c: 'text-gray-300' },
      { text: '→ run:a3f9  generate-reply     ok  1240ms   312tk  $0.000624', c: 'text-gray-300' },
      { text: '' },
      { text: '3 steps · 1664ms · 413tk · $0.000725', c: 'text-gray-600' },
      { text: 'score: 0pts  ✓ clean', c: 'text-green-400' },
    ],
  },
  latency: {
    label: 'slow call',
    lines: [
      { text: '→ run:b2c1  classify-intent    ok    91ms    12tk', c: 'text-gray-500' },
      { text: '→ run:b2c1  extract-context    ??  8400ms     3tk', c: 'text-yellow-300' },
      { text: '' },
      { text: '  baseline: 284ms ± 42ms  (n=52)', c: 'text-gray-600' },
      { text: '  z = (8400 - 284) / 42 = +192.7', c: 'text-gray-600' },
      { text: '' },
      { text: '  ↳ L5:5001  latency_zscore  z=+192.7  +30pts', c: 'text-violet-400' },
      { text: '  ↳ L4:4007  high_latency_low_output   +20pts', c: 'text-blue-400' },
      { text: '' },
      { text: 'score: 50pts  ⚠ warning  →  #prod-alerts', c: 'text-yellow-400' },
    ],
  },
  json: {
    label: 'json error',
    lines: [
      { text: '→ run:c4d8  parse-entities', c: 'text-gray-500' },
      { text: '' },
      { text: '  prompt:  "extract entities, return JSON"', c: 'text-gray-600' },
      { text: '  output:  "Sure! Based on the message..."', c: 'text-red-300' },
      { text: '' },
      { text: '  ↳ L2:2001  json_contract_violation  +50pts', c: 'text-orange-400' },
      { text: '  ↳ L2:2002  json_strict_violation    +60pts', c: 'text-orange-400' },
      { text: '' },
      { text: 'score: 110pts  ✗ TRIGGERED', c: 'text-red-400' },
    ],
  },
  tokens: {
    label: 'token spike',
    lines: [
      { text: '→ run:d5e9  classify-intent', c: 'text-gray-500' },
      { text: '' },
      { text: '  baseline: 11.4tk ± 0.8tk  (n=67)', c: 'text-gray-600' },
      { text: '  observed: 847tk', c: 'text-red-300' },
      { text: '  z = (847 - 11.4) / 0.8 = +1044', c: 'text-gray-600' },
      { text: '' },
      { text: '  ↳ L5:5002  tokens_zscore  z=+1044  +25pts', c: 'text-violet-400' },
      { text: '  ↳ L4:4005  classify_step_token_bloat +25pts', c: 'text-blue-400' },
      { text: '' },
      { text: 'score: 50pts  ⚠ flagged', c: 'text-yellow-400' },
    ],
  },
}

// ── Layer data ────────────────────────────────────────────────────────────────

type LayerKey = 'L1' | 'L2' | 'L4' | 'L5'

const LAYERS: Record<LayerKey, {
  name: string; accent: string; desc: string; example: Line[]
}> = {
  L1: {
    name: 'Hard failures',
    accent: 'text-red-400',
    desc: 'Deterministic. Fires on status_success=false, non-empty error, token mismatch, negative values. Any hit → 100pts → immediate trigger. No heuristics.',
    example: [
      { text: 'status_success: false', c: 'text-red-400' },
      { text: 'error: "context_length_exceeded"', c: 'text-red-300' },
      { text: '' },
      { text: '↳ 1001  status_failure   +100pts  TRIGGERED', c: 'text-red-400' },
    ],
  },
  L2: {
    name: 'Format violations',
    accent: 'text-orange-400',
    desc: 'Prompt-implied contracts. "Return JSON" → output must be JSON. Yes/no prompts. Enum constraints. Strict JSON (no markdown fences). Caught before anything else runs.',
    example: [
      { text: 'prompt:  "return JSON with keys: name, email"', c: 'text-gray-600' },
      { text: 'output:  "The user appears to be asking..."', c: 'text-orange-300' },
      { text: '' },
      { text: '↳ 2001  json_contract_violation  +50pts', c: 'text-orange-400' },
    ],
  },
  L4: {
    name: 'Numeric limits',
    accent: 'text-blue-400',
    desc: 'Adaptive p95 thresholds for latency, tokens, cost — scoped to each step\'s profile. Cross-field plausibility. Stall detection. Defers to L5 on 4001/4002/4003 once a baseline is warm.',
    example: [
      { text: 'latency_ms:    8400', c: 'text-blue-300' },
      { text: 'output_tokens: 3', c: 'text-blue-300' },
      { text: '' },
      { text: '↳ 4007  high_latency_low_output  +20pts', c: 'text-blue-400' },
    ],
  },
  L5: {
    name: 'Statistical baseline',
    accent: 'text-violet-400',
    desc: 'Per-step z-score against that step\'s own mean and std. Activates after 20 clean calls. High-variance steps get a wider band automatically. Most accurate layer.',
    example: [
      { text: 'baseline: 284ms ± 42ms (n=52)', c: 'text-gray-600' },
      { text: 'observed: 1840ms', c: 'text-violet-300' },
      { text: 'z = (1840 - 284) / 42 = +37.0', c: 'text-gray-600' },
      { text: '' },
      { text: '↳ 5001  latency_zscore  z=+37.0  +30pts', c: 'text-violet-400' },
    ],
  },
}

// ── Components ────────────────────────────────────────────────────────────────

function Terminal() {
  const [demo, setDemo] = useState<DemoKey>('ok')
  const [visible, setVisible] = useState(0)
  const [running, setRunning] = useState(false)

  function run(key: DemoKey) {
    setDemo(key); setVisible(0); setRunning(true)
  }

  useEffect(() => { run('ok') }, [])
  useEffect(() => {
    if (!running) return
    const n = DEMOS[demo].lines.length
    if (visible >= n) { setRunning(false); return }
    const t = setTimeout(() => setVisible(v => v + 1), 60)
    return () => clearTimeout(t)
  }, [running, visible, demo])

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {(Object.keys(DEMOS) as DemoKey[]).map((k) => (
          <button
            key={k}
            onClick={() => run(k)}
            className={[
              'px-3 py-1 text-[11px] font-mono border transition-colors',
              demo === k
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-white/10 text-gray-600 hover:text-gray-400 hover:border-white/20',
            ].join(' ')}
          >
            {DEMOS[k].label}
          </button>
        ))}
      </div>
      <div className="border border-white/10 bg-black p-5 font-mono text-xs leading-6 min-h-52">
        {DEMOS[demo].lines.slice(0, visible).map((l, i) => (
          <div key={i} className={l.c ?? 'text-gray-400'}>{l.text || ' '}</div>
        ))}
        {running && <span className="inline-block w-2 h-3.5 bg-violet-400 animate-pulse" />}
      </div>
    </div>
  )
}

function LayerExplorer() {
  const [active, setActive] = useState<LayerKey | null>(null)
  const layers = Object.keys(LAYERS) as LayerKey[]
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/8">
        {layers.map((k) => {
          const l = LAYERS[k]
          const on = active === k
          return (
            <button
              key={k}
              onClick={() => setActive(on ? null : k)}
              className={[
                'p-5 text-left transition-colors',
                on ? 'bg-white text-black' : 'bg-[#000] hover:bg-white/4',
              ].join(' ')}
            >
              <div className={`text-xs font-bold font-mono mb-1 ${on ? 'text-black' : l.accent}`}>{k}</div>
              <div className={`text-sm font-sans font-bold ${on ? 'text-black' : 'text-white'}`}>{l.name}</div>
              <div className={`text-[10px] font-mono mt-3 ${on ? 'text-gray-600' : 'text-gray-700'}`}>
                {on ? 'click to close' : 'click to expand →'}
              </div>
            </button>
          )
        })}
      </div>

      {active && (
        <div className="border border-white/10 border-t-0 p-6 bg-[#050505]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <div className={`text-[10px] font-mono font-bold uppercase tracking-widest mb-3 ${LAYERS[active].accent}`}>
                {active} — {LAYERS[active].name}
              </div>
              <p className="text-sm font-mono text-gray-400 leading-7">{LAYERS[active].desc}</p>
            </div>
            <div className="bg-black border border-white/8 p-4 font-mono text-xs leading-6">
              {LAYERS[active].example.map((l, i) => (
                <div key={i} className={l.c ?? 'text-gray-400'}>{l.text || ' '}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="text-[10px] font-mono text-gray-700 hover:text-gray-400 transition-colors"
    >
      {done ? 'copied ✓' : 'copy'}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white antialiased">

      <style>{`
        @keyframes t { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .tk { animation: t 30s linear infinite; }
        .tk:hover { animation-play-state: paused; }
      `}</style>

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-white/8">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-sans font-black text-sm text-white">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            trace.ai
          </Link>
          <div className="flex items-center gap-6">
            <a href="#detection" className="text-[11px] font-mono text-gray-600 hover:text-white transition-colors hidden sm:block">detection</a>
            <Link href="/docs" className="text-[11px] font-mono text-gray-600 hover:text-white transition-colors hidden sm:block">docs</Link>
            <Link href="/login" className="text-[11px] font-mono text-gray-600 hover:text-white transition-colors">sign in</Link>
            <Link href="/login" className="text-[11px] font-mono font-bold px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white transition-colors">
              get started →
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-32 pb-20 px-6 border-b border-white/8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-start">

          <div>
            <p className="font-mono text-[11px] text-gray-600 mb-8 tracking-widest uppercase">
              anthropic sdk · open beta
            </p>
            <h1 className="font-sans font-black text-6xl sm:text-7xl leading-[0.95] text-white mb-8">
              Your LLM<br />
              is failing.<br />
              <span className="text-violet-500">Silently.</span>
            </h1>
            <p className="font-mono text-sm text-gray-500 leading-7 max-w-sm mb-10">
              LLMs don&apos;t throw exceptions. They
              hallucinate, return broken JSON, spike
              costs, and drift — all while your logs
              show green. trace.ai catches it.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/login" className="font-mono text-sm font-bold px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white transition-colors">
                start free →
              </Link>
              <Link href="/docs" className="font-mono text-sm text-gray-600 hover:text-white transition-colors underline underline-offset-4">
                read docs
              </Link>
            </div>

            <div className="mt-16 pt-8 border-t border-white/8 grid grid-cols-3 gap-6">
              {[['< 1ms', 'overhead per call'], ['4 layers', 'of detection'], ['20 calls', 'to warm L5']].map(([v, l]) => (
                <div key={l}>
                  <div className="font-sans font-black text-2xl text-white">{v}</div>
                  <div className="font-mono text-[10px] text-gray-600 mt-1">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:pt-4">
            <p className="font-mono text-[10px] text-gray-700 mb-3 uppercase tracking-widest">
              live simulation — click a scenario
            </p>
            <Terminal />
          </div>
        </div>
      </section>

      {/* ── Ticker ── */}
      <div className="border-b border-white/8 py-3 overflow-hidden bg-black">
        <div className="flex whitespace-nowrap tk">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex shrink-0">
              {[
                ['1001', 'status_failure', 'text-red-600'],
                ['1007', 'token_accounting_mismatch', 'text-red-600'],
                ['2001', 'json_contract_violation', 'text-orange-500'],
                ['4007', 'high_latency_low_output', 'text-blue-500'],
                ['5001', 'latency_zscore', 'text-violet-500'],
                ['5002', 'tokens_zscore', 'text-violet-500'],
                ['2003', 'enum_contract_violation', 'text-orange-500'],
                ['4005', 'classify_step_token_bloat', 'text-blue-500'],
                ['5003', 'cost_zscore', 'text-violet-500'],
                ['1003', 'empty_output_on_success', 'text-red-600'],
              ].map(([code, name, c]) => (
                <span key={code} className="inline-flex items-center gap-2.5 px-6 font-mono text-[11px]">
                  <span className={`font-bold ${c}`}>{code}</span>
                  <span className="text-gray-800">{name}</span>
                  <span className="text-gray-900 mx-3">·</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Detection engine ── */}
      <section id="detection" className="pt-20 pb-0 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-3">Detection engine</p>
              <h2 className="font-sans font-black text-4xl sm:text-5xl text-white">L1 · L2 · L4 · L5</h2>
            </div>
            <p className="font-mono text-xs text-gray-600 max-w-xs text-right leading-6 hidden lg:block">
              Four layers. Each catches something different. Scores accumulate — once total ≥ 100pts, the engine stops and fires.
            </p>
          </div>
        </div>
        <div className="max-w-6xl mx-auto">
          <LayerExplorer />
        </div>
      </section>

      {/* ── Solid violet section — features ── */}
      <section className="mt-20 bg-violet-700 py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-[10px] text-violet-300 uppercase tracking-widest mb-4">Everything included</p>
          <h2 className="font-sans font-black text-4xl sm:text-5xl text-white mb-14">
            The full stack.<br />No config files.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-0">
            {[
              ['Per-step cost & token tracking', 'Every call captured: tokens, latency, cost, model. Per-run Gantt waterfall. Monthly budget alerts.'],
              ['AI root cause analysis', 'One click runs claude-sonnet over your entire run. Reads every step, every score, tells you what broke and why.'],
              ['Step identity & profiles', 'System prompts embedded with all-MiniLM-L6-v2. Each step gets a semantic profile — L5 baselines are per-step, not project-wide.'],
              ['Trend detection', 'Per-step health across time: warming / healthy / degrading / critical. Catches latency creep that per-call scoring misses.'],
              ['Slack integration', 'Paste a webhook URL. Step errors, rate spikes, anomaly alerts — right in your team channel. No code.'],
              ['Sentry integration', 'Every call as a Sentry performance transaction. Anomalies as issues, fingerprinted by step name.'],
            ].map(([title, desc]) => (
              <div key={title as string} className="py-6 border-b border-violet-600 last:border-b-0 md:[&:nth-child(5)]:border-b-0 md:[&:nth-child(6)]:border-b-0">
                <div className="font-sans font-bold text-white mb-1.5 text-sm">{title}</div>
                <div className="font-mono text-xs text-violet-200 leading-6">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Setup ── */}
      <section className="py-20 px-6 border-b border-white/8">
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-3">Setup</p>
          <h2 className="font-sans font-black text-4xl sm:text-5xl text-white mb-14">
            Three steps.<br />Under five minutes.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { n: '01', title: 'Install', code: 'npm install @trace-ai/sdk' },
              { n: '02', title: 'Wrap your client', code: `const tracer = new Tracer({ apiKey })
const anthropic = tracer.wrapAnthropic(
  new Anthropic()
)` },
              { n: '03', title: 'Use normally', code: `await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  messages: [...],
  _trace: { stepName: 'classify' },
})` },
            ].map((s) => (
              <div key={s.n}>
                <div className="font-sans font-black text-[80px] text-white/6 leading-none mb-6 select-none">{s.n}</div>
                <div className="font-sans font-bold text-white text-sm mb-4">{s.title}</div>
                <div className="border border-white/10 bg-[#050505] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
                    <span className="font-mono text-[10px] text-gray-700">typescript</span>
                    <CopyBtn text={s.code} />
                  </div>
                  <pre className="px-4 py-4 font-mono text-xs text-violet-300 whitespace-pre leading-6 overflow-x-auto">{s.code}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-sans font-black text-5xl sm:text-7xl text-white leading-[0.95] mb-10">
            Stop guessing.<br />
            <span className="text-violet-500">Start tracing.</span>
          </h2>
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/login" className="font-mono font-bold text-sm px-8 py-4 bg-violet-600 hover:bg-violet-500 text-white transition-colors">
              get started free →
            </Link>
            <Link href="/docs" className="font-mono text-sm text-gray-600 hover:text-white transition-colors underline underline-offset-4">
              read the docs
            </Link>
            <span className="font-mono text-[11px] text-gray-700">no credit card · free to start</span>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/8 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-sans font-black text-sm text-white">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            trace.ai
          </Link>
          <div className="flex items-center gap-8">
            <Link href="/docs" className="font-mono text-[11px] text-gray-700 hover:text-white transition-colors">docs</Link>
            <Link href="/login" className="font-mono text-[11px] text-gray-700 hover:text-white transition-colors">sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
