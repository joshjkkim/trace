'use client';

import { useEffect, useState, use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Badge, StatCard, SearchInput, EmptyState, SegmentedControl, Toggle } from '@/components/ui';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

interface Project {
  id: string;
  name: string;
  API_KEY: string;
  owner: string;
  created_at: string;
  call_count: number;
  slack_webhook_url?: string | null;
  alert_on_error?: boolean;
  alert_error_rate_threshold?: number | null;
  alert_error_rate_window?: number | null;
  sentry_dsn?: string | null;
  sentry_alert_level?: string | null;
  slack_anomaly_level?: string | null;
  threshold_mode?: string | null;
  threshold_latency_ms?: number | null;
  threshold_tokens?: number | null;
  threshold_cost?: number | null;
  monthly_budget_usd?: number | null;
}

interface Call {
  id: string | number;
  run_id?: string;
  step_index?: number;
  step_name?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  latency_ms?: number;
  cost?: number;
  status_success?: boolean;
  prompt?: string;
  output_code?: string;
  error?: string;
  created_at?: string;
  project_id?: string;
}

interface Run {
  runId: string;
  steps: Call[];
  totalCost: number;
  totalTokens: number;
  totalLatency: number;
  errorCount: number;
  createdAt: string;
}

type Tab = 'overview' | 'logs' | 'runs' | 'anomalies' | 'steps' | 'usage' | 'settings';

interface MetricTrend {
  metric: string;
  baseline_mean: number;
  recent_mean: number;
  sigma: number;
  direction: 'up' | 'down';
}

interface StepHealthRow {
  step_profile_id: string;
  step_name: string;
  status: 'warming' | 'healthy' | 'degrading' | 'critical';
  sample_count: number;
  trends: MetricTrend[];
}

const L5_MIN_SAMPLES = 20;

interface AnomalyRow {
  id: number;
  step_name: string;
  run_id: string;
  project_id: string | null;
  error_code: number;
  penalty_score: number;
  created_at: string;
}

interface ConditionInfo {
  name: string;
  layer: string;
  penalty: number;
  description: string;
}

type ConditionRegistry = Record<string, ConditionInfo>;

interface AnomalyRun {
  run_id: string;
  total_score: number;
  is_critical: boolean;
  steps: { step_name: string; codes: { code: number; score: number }[] }[];
  latest_at: string;
}

const ANOMALY_THRESHOLD = 100;

function groupAnomalies(rows: AnomalyRow[]): AnomalyRun[] {
  const map = new Map<string, AnomalyRun>();
  for (const row of rows) {
    if (!map.has(row.run_id)) {
      map.set(row.run_id, { run_id: row.run_id, total_score: 0, is_critical: false, steps: [], latest_at: row.created_at });
    }
    const run = map.get(row.run_id)!;
    run.total_score += row.penalty_score;
    run.is_critical = run.total_score >= ANOMALY_THRESHOLD;
    if (row.created_at > run.latest_at) run.latest_at = row.created_at;
    let step = run.steps.find((s) => s.step_name === row.step_name);
    if (!step) { step = { step_name: row.step_name, codes: [] }; run.steps.push(step); }
    step.codes.push({ code: row.error_code, score: row.penalty_score });
  }
  return Array.from(map.values()).sort((a, b) => b.latest_at.localeCompare(a.latest_at));
}

type ConnectionStatus = 'connecting' | 'connected' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupIntoRuns(calls: Call[]): Run[] {
  const byRunId = new Map<string, Call[]>();
  for (const call of calls) {
    const rid = call.run_id ?? 'unknown';
    if (!byRunId.has(rid)) byRunId.set(rid, []);
    byRunId.get(rid)!.push(call);
  }
  return Array.from(byRunId.entries())
    .map(([runId, steps]) => ({
      runId,
      steps: [...steps].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0)),
      totalCost: steps.reduce((s, c) => s + (c.cost ?? 0), 0),
      totalTokens: steps.reduce((s, c) => s + (c.total_tokens ?? 0), 0),
      totalLatency: steps.reduce((s, c) => s + (c.latency_ms ?? 0), 0),
      errorCount: steps.filter((c) => c.status_success === false).length,
      createdAt: steps.reduce((earliest, c) =>
        c.created_at && (!earliest || c.created_at < earliest) ? c.created_at : earliest, ''),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

const RANGES: Record<TimeRange, { label: string; hours: number; buckets: number }> = {
  '15m': { label: '15m', hours: 0.25, buckets: 15 },
  '1h':  { label: '1h',  hours: 1,    buckets: 12 },
  '6h':  { label: '6h',  hours: 6,    buckets: 12 },
  '24h': { label: '24h', hours: 24,   buckets: 24 },
  '7d':  { label: '7d',  hours: 168,  buckets: 28 },
  '30d': { label: '30d', hours: 720,  buckets: 30 },
};

function timeBuckets(calls: Call[], bucketCount = 24, hours = 24) {
  const now = Date.now();
  const windowMs = hours * 3600_000;
  const bucketMs = windowMs / bucketCount;
  const start = now - windowMs;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: new Date(start + i * bucketMs),
    calls: 0,
    cost: 0,
    tokens: 0,
    errors: 0,
  }));

  for (const call of calls) {
    if (!call.created_at) continue;
    const t = new Date(call.created_at).getTime();
    const idx = Math.floor((t - start) / bucketMs);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx].calls++;
      buckets[idx].cost += call.cost ?? 0;
      buckets[idx].tokens += call.total_tokens ?? 0;
      if (call.status_success === false) buckets[idx].errors++;
    }
  }
  return buckets;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();

  const [project, setProject]             = useState<Project | null>(null);
  const [calls, setCalls]                 = useState<Call[]>([]);
  const [status, setStatus]               = useState<ConnectionStatus>('connecting');
  const [authError, setAuthError]         = useState(false);
  const [tab, setTab]                     = useState<Tab>('overview');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall]   = useState<Call | null>(null);
  const [anomalies, setAnomalies]         = useState<AnomalyRow[]>([]);
  const [conditionRegistry, setConditionRegistry] = useState<ConditionRegistry>({});
  const [analysis, setAnalysis]           = useState<{ runId: string; text: string; costUsd: number } | null>(null);
  const [analyzing, setAnalyzing]         = useState(false);
  const [logsQuery, setLogsQuery]         = useState('');
  const [runsQuery, setRunsQuery]         = useState('');
  const [stepHealth, setStepHealth]       = useState<StepHealthRow[]>([]);

  const runs = useMemo(() => groupIntoRuns(calls), [calls]);
  const selectedRun = useMemo(() => runs.find((r) => r.runId === selectedRunId) ?? null, [runs, selectedRunId]);
  const anomalyRuns = useMemo(() => groupAnomalies(anomalies), [anomalies]);
  const criticalCount = anomalyRuns.filter((r) => r.is_critical).length;
  const anomalyMap = useMemo(() => new Map(anomalyRuns.map((r) => [r.run_id, r])), [anomalyRuns]);

  async function analyzeRun(runId: string) {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch(`${BACKEND}/analyze/run/${runId}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAnalysis({ runId, text: data.analysis, costUsd: data.cost_usd });
    } catch (e) {
      console.error('[analyze]', e);
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/'); return; }

      const { data: profile } = await supabase
        .from('PROFILES').select('id').eq('email', session.user.email).single();
      if (!profile) { router.replace('/dashboard'); return; }

      const res = await fetch(`${BACKEND}/projects/${projectId}`);
      if (!res.ok) { router.replace('/dashboard'); return; }
      const proj: Project = await res.json();

      if (proj.owner !== profile.id) { setAuthError(true); return; }
      setProject(proj);

      const [callsRes, anomaliesRes, registryRes, healthRes] = await Promise.all([
        fetch(`${BACKEND}/calls/project/${projectId}`),
        fetch(`${BACKEND}/anomalies/project/${proj.id}`),
        fetch(`${BACKEND}/anomalies/registry`),
        fetch(`${BACKEND}/projects/${proj.id}/step-health`),
      ]);
      if (callsRes.ok) setCalls((await callsRes.json() as Call[]).slice().reverse());
      if (anomaliesRes.ok) setAnomalies(await anomaliesRes.json() as AnomalyRow[]);
      if (registryRes.ok) setConditionRegistry(await registryRes.json() as ConditionRegistry);
      if (healthRes.ok) setStepHealth(await healthRes.json() as StepHealthRow[]);
    }
    init();
  }, [projectId, router]);

  useEffect(() => {
    const channel = supabase
      .channel(`calls-project-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'CALLS' }, (payload) => {
        const call = payload.new as Call;
        if (call.project_id !== projectId) return;
        setCalls((prev) => [call, ...prev]);
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error');
      });
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  useEffect(() => {
    const channel = supabase
      .channel(`anomalies-project-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ANOMALIES' }, (payload) => {
        const row = payload.new as AnomalyRow;
        if (row.project_id !== projectId) return;
        setAnomalies((prev) => [...prev, row]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  if (authError) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-xs text-red-400 mb-4">You don&apos;t have access to this project.</p>
          <a href="/dashboard" className="font-mono text-xs text-gray-600 hover:text-white underline">← back to dashboard</a>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="font-mono text-xs text-gray-700">loading…</p>
      </main>
    );
  }

  const degradingCount = stepHealth.filter(s => s.status !== 'healthy').length;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',  label: 'overview' },
    { id: 'logs',      label: 'logs' },
    { id: 'runs',      label: `runs${runs.length ? ` (${runs.length})` : ''}` },
    { id: 'anomalies', label: `anomalies${criticalCount ? ` (${criticalCount} critical)` : anomalyRuns.length ? ` (${anomalyRuns.length})` : ''}` },
    { id: 'steps',     label: `steps${degradingCount ? ` (${degradingCount} drifting)` : ''}` },
    { id: 'usage',     label: 'usage' },
    { id: 'settings',  label: 'settings' },
  ];

  return (
    <main className="min-h-screen bg-black text-white antialiased">

      {/* Top bar */}
      <div className="border-b border-white/8 px-4 sm:px-8 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-xs">
              <a href="/dashboard" className="text-gray-600 hover:text-white transition-colors shrink-0">projects</a>
              <span className="text-white/15">/</span>
              <span className="text-white font-bold truncate">{project.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={[
                'w-1.5 h-1.5 rounded-full shrink-0',
                status === 'connected'  ? 'bg-green-500' : '',
                status === 'connecting' ? 'bg-yellow-500 animate-pulse' : '',
                status === 'error'      ? 'bg-red-500' : '',
              ].join(' ')} />
              <span className="font-mono text-[10px] text-gray-700">
                {status === 'connected' ? 'live' : status === 'connecting' ? 'connecting…' : 'realtime error'}
              </span>
            </div>
          </div>
          <code className="hidden sm:block font-mono text-[11px] text-green-500 border border-white/8 px-3 py-1.5 max-w-[200px] truncate shrink-0">
            {project.API_KEY}
          </code>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto flex gap-0 mt-4 overflow-x-auto scrollbar-none -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelectedRunId(null); }}
              className={[
                'px-4 py-2 font-mono text-xs border-b-2 transition-colors whitespace-nowrap shrink-0',
                tab === t.id
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-600 hover:text-gray-300',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">

        {tab === 'overview'  && <OverviewTab calls={calls} />}

        {tab === 'logs' && (() => {
          const q = logsQuery.toLowerCase();
          const filtered = calls.filter(c =>
            !q || (c.step_name ?? '').toLowerCase().includes(q) || (c.model ?? '').toLowerCase().includes(q) ||
            (c.run_id ?? '').toLowerCase().includes(q) || (c.error ?? '').toLowerCase().includes(q)
          );
          return calls.length === 0
            ? <EmptyState text="No calls yet — run your first trace to see logs here." />
            : (
              <div>
                <SearchInput value={logsQuery} onChange={setLogsQuery} placeholder="Filter by step, model, run ID, error…" />
                {filtered.length === 0
                  ? <EmptyState text="No calls match that filter." />
                  : <div className="bg-[#0a0a0a] border border-white/8 divide-y divide-white/8">{filtered.map((c) => <CallRow key={`${c.id}`} call={c} anomaly={c.run_id ? anomalyMap.get(c.run_id) : undefined} onSelect={setSelectedCall} />)}</div>
                }
              </div>
            );
        })()}

        {tab === 'runs' && !selectedRunId && (() => {
          const q = runsQuery.toLowerCase();
          const filtered = runs.filter(r =>
            !q || r.runId.toLowerCase().includes(q) ||
            r.steps.some(s => (s.step_name ?? '').toLowerCase().includes(q) || (s.model ?? '').toLowerCase().includes(q))
          );
          return runs.length === 0
            ? <EmptyState text="No runs yet." />
            : (
              <div>
                <SearchInput value={runsQuery} onChange={setRunsQuery} placeholder="Filter by run ID, step name, model…" />
                {filtered.length === 0
                  ? <EmptyState text="No runs match that filter." />
                  : <div className="bg-[#0a0a0a] border border-white/8 divide-y divide-white/8">{filtered.map((r) => <RunCard key={r.runId} run={r} anomaly={anomalyMap.get(r.runId)} onClick={() => setSelectedRunId(r.runId)} />)}</div>
                }
              </div>
            );
        })()}

        {tab === 'runs' && selectedRunId && selectedRun && (
          <div>
            <button
              onClick={() => { setSelectedRunId(null); setAnalysis(null); }}
              className="font-mono text-xs text-gray-600 hover:text-white mb-6 transition-colors flex items-center gap-1.5"
            >
              ← runs
            </button>
            <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1">Run ID</p>
                <code className="font-mono text-xs text-gray-300 break-all">{selectedRun.runId}</code>
                <div className="flex flex-wrap gap-4 mt-2 font-mono text-[11px] text-gray-600">
                  <span>{selectedRun.steps.length} steps</span>
                  <span>${selectedRun.totalCost.toFixed(6)}</span>
                  <span>{selectedRun.totalLatency}ms total</span>
                  {selectedRun.errorCount > 0 && <span className="text-red-400">{selectedRun.errorCount} error{selectedRun.errorCount > 1 ? 's' : ''}</span>}
                </div>
              </div>
              <button
                onClick={() => analyzeRun(selectedRun.runId)}
                disabled={analyzing}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs border border-violet-700/60 text-violet-400 hover:bg-violet-900/20 hover:border-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {analyzing ? <><span className="animate-spin text-[10px]">◌</span> analyzing…</> : <>✦ analyze run</>}
              </button>
            </div>

            {analysis && analysis.runId === selectedRun.runId && (
              <AnalysisPanel text={analysis.text} costUsd={analysis.costUsd} onClose={() => setAnalysis(null)} />
            )}

            <RunTimeline steps={selectedRun.steps} anomalyRun={anomalyMap.get(selectedRun.runId)} registry={conditionRegistry} onSelect={setSelectedCall} />
          </div>
        )}

        {tab === 'anomalies' && <AnomaliesTab runs={anomalyRuns} registry={conditionRegistry} />}
        {tab === 'steps'     && <StepsHealthTab health={stepHealth} />}
        {tab === 'usage'     && <UsageTab project={project} />}
        {tab === 'settings'  && <SettingsTab project={project} />}

      </div>

      {selectedCall && (
        <CallDetailDrawer
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          anomalyStep={(() => {
            const ar = anomalyMap.get(selectedCall.run_id ?? '');
            return ar?.steps.find(s => s.step_name === selectedCall.step_name);
          })()}
          registry={conditionRegistry}
        />
      )}
    </main>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ calls }: { calls: Call[] }) {
  const [range, setRange] = useState<TimeRange>('24h');
  const cfg = RANGES[range];

  const fc = useMemo(() => {
    const cutoff = Date.now() - cfg.hours * 3_600_000;
    return calls.filter((c) => c.created_at ? new Date(c.created_at).getTime() >= cutoff : false);
  }, [calls, cfg.hours]);

  const filteredRuns = useMemo(() => groupIntoRuns(fc), [fc]);
  const totalCost    = fc.reduce((s, c) => s + (c.cost ?? 0), 0);
  const totalTokens  = fc.reduce((s, c) => s + (c.total_tokens ?? 0), 0);
  const errorCount   = fc.filter((c) => c.status_success === false).length;
  const avgLatency   = fc.length ? Math.round(fc.reduce((s, c) => s + (c.latency_ms ?? 0), 0) / fc.length) : 0;
  const errorRate    = fc.length ? (errorCount / fc.length) * 100 : 0;
  const buckets      = useMemo(() => timeBuckets(fc, cfg.buckets, cfg.hours), [fc, cfg]);

  const modelCounts: Record<string, { calls: number; cost: number }> = {};
  for (const c of fc) {
    if (!c.model) continue;
    if (!modelCounts[c.model]) modelCounts[c.model] = { calls: 0, cost: 0 };
    modelCounts[c.model].calls++;
    modelCounts[c.model].cost += c.cost ?? 0;
  }
  const models = Object.entries(modelCounts).sort((a, b) => b[1].calls - a[1].calls);
  const totalModelCalls = models.reduce((s, [, v]) => s + v.calls, 0);

  const firstLabel = buckets[0]?.label;
  const lastLabel  = buckets[buckets.length - 1]?.label;

  const rangeOptions = (Object.keys(RANGES) as TimeRange[]).map(r => ({ value: r, label: RANGES[r].label }));

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <SegmentedControl options={rangeOptions} value={range} onChange={setRange} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-white/8">
        <StatCard label="Runs"        value={filteredRuns.length.toString()} />
        <StatCard label="Calls"       value={fc.length.toString()} />
        <StatCard label="Total cost"  value={`$${totalCost.toFixed(4)}`} mono />
        <StatCard label="Avg latency" value={fc.length ? `${avgLatency}ms` : '—'} />
        <StatCard label="Error rate"  value={fc.length ? `${errorRate.toFixed(1)}%` : '—'} alert={errorRate > 5} />
        <StatCard label="Tokens"      value={totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens.toString()} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#0a0a0a] border border-white/8 p-5">
          <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-4">Calls · {cfg.label}</p>
          <BarChart data={buckets.map(b => b.calls)} color="bg-violet-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>
        <div className="bg-[#0a0a0a] border border-white/8 p-5">
          <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-4">Models</p>
          {models.length === 0 ? (
            <p className="font-mono text-xs text-gray-700 mt-8 text-center">no data</p>
          ) : (
            <div className="space-y-4">
              {models.map(([model, { calls: cnt, cost }]) => (
                <div key={model}>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-mono text-[11px] text-gray-400 truncate max-w-[140px]">{model.replace('claude-', '')}</span>
                    <span className="font-mono text-[11px] text-gray-600 shrink-0 ml-2">{cnt} · ${cost.toFixed(4)}</span>
                  </div>
                  <div className="h-px bg-white/8">
                    <div className="h-full bg-violet-500" style={{ width: `${(cnt / totalModelCalls) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#0a0a0a] border border-white/8 p-5">
          <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-4">Cost · {cfg.label}</p>
          <BarChart data={buckets.map(b => b.cost)} color="bg-emerald-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>
        <div className="bg-[#0a0a0a] border border-white/8 p-5">
          <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-4">Tokens · {cfg.label}</p>
          <BarChart data={buckets.map(b => b.tokens)} color="bg-blue-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>
      </div>

      <StepBreakdown calls={fc} />

      {errorCount > 0 && (
        <div className="border-l-2 border-red-600 pl-5 py-3">
          <p className="font-mono text-[10px] text-red-600 uppercase tracking-widest mb-3">Recent errors</p>
          <div className="space-y-2">
            {fc.filter((c) => c.status_success === false).slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-start gap-3 font-mono text-[11px]">
                <span className="text-red-600 shrink-0">✕</span>
                <span className="text-gray-400 shrink-0">{c.step_name ?? '—'}</span>
                <span className="text-red-400 truncate">{c.error ?? 'unknown error'}</span>
                <span className="text-gray-700 shrink-0 ml-auto">
                  {c.created_at ? new Date(c.created_at).toLocaleTimeString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function BarChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-px h-20">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 ${color} transition-all opacity-80`}
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
        />
      ))}
    </div>
  );
}

function ChartAxis({ first, last }: { first?: Date; last?: Date }) {
  const fmt = (d?: Date) => d?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  return (
    <div className="flex justify-between mt-2">
      <span className="font-mono text-[10px] text-gray-700">{fmt(first)}</span>
      <span className="font-mono text-[10px] text-gray-700">{fmt(last)}</span>
    </div>
  );
}

// ── Call log row ──────────────────────────────────────────────────────────────

function CallRow({ call, anomaly, onSelect }: { call: Call; anomaly?: AnomalyRun; onSelect: (c: Call) => void }) {
  const isError = call.status_success === false;
  return (
    <div
      onClick={() => onSelect(call)}
      className={[
        'border-l-2 px-4 py-3 font-mono text-xs grid grid-cols-[1fr_auto] gap-x-4 cursor-pointer hover:bg-white/2 transition-colors',
        isError          ? 'border-red-600'
          : anomaly?.is_critical ? 'border-red-600/50'
          : anomaly              ? 'border-yellow-600/60'
          : 'border-white/10',
      ].join(' ')}
    >
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isError ? 'error' : 'ok'}>{isError ? 'error' : 'ok'}</Badge>
          {anomaly && (
            <Badge variant={anomaly.is_critical ? 'critical' : 'warning'}>
              {anomaly.is_critical ? `critical ${anomaly.total_score}pts` : `warn ${anomaly.total_score}pts`}
            </Badge>
          )}
          <span className="text-gray-200 font-bold">{call.step_name ?? '—'}</span>
          <span className="text-gray-600">{call.model ?? ''}</span>
          {call.step_index != null && <span className="text-gray-700">#{call.step_index + 1}</span>}
        </div>
        {isError && call.error && <div className="text-red-400 truncate">{call.error}</div>}
        {!isError && (
          <div className="flex flex-wrap gap-x-4 text-gray-600">
            <span><span className="text-gray-700">tokens </span>{call.input_tokens ?? 0} / {call.output_tokens ?? 0}</span>
            {call.cost != null && <span><span className="text-gray-700">cost </span>${Number(call.cost).toFixed(6)}</span>}
          </div>
        )}
        <div className="text-gray-700 truncate">run {call.run_id ?? '—'}</div>
      </div>
      <div className="text-right whitespace-nowrap">
        {call.latency_ms != null && <div className="text-gray-300">{call.latency_ms}ms</div>}
        {call.created_at && <div className="text-gray-700 text-[10px]">{new Date(call.created_at).toLocaleTimeString()}</div>}
      </div>
    </div>
  );
}

// ── Run card ──────────────────────────────────────────────────────────────────

function RunCard({ run, anomaly, onClick }: { run: Run; anomaly?: AnomalyRun; onClick: () => void }) {
  const hasError = run.errorCount > 0;
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left px-5 py-4 border-l-2 hover:bg-white/2 transition-colors',
        anomaly?.is_critical ? 'border-red-600'
          : anomaly ? 'border-yellow-600'
          : hasError ? 'border-red-600/50'
          : 'border-white/10',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={hasError ? 'error' : 'ok'}>{hasError ? `${run.errorCount} err` : 'ok'}</Badge>
            {anomaly && (
              <Badge variant={anomaly.is_critical ? 'critical' : 'warning'}>
                {anomaly.is_critical ? `critical ${anomaly.total_score}pts` : `warn ${anomaly.total_score}pts`}
              </Badge>
            )}
            <code className="font-mono text-[11px] text-gray-400">{run.runId.slice(0, 16)}…</code>
          </div>
          <div className="flex flex-wrap gap-x-4 font-mono text-[11px] text-gray-600">
            <span>{run.steps.length} step{run.steps.length !== 1 ? 's' : ''}</span>
            <span>${run.totalCost.toFixed(6)}</span>
            <span>{run.totalLatency}ms</span>
            <span>{run.totalTokens.toLocaleString()} tok</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {run.steps.map((s) => (
              <span key={s.id} className="font-mono text-[10px] bg-white/5 text-gray-500 px-1.5 py-0.5">
                {s.step_name ?? `step_${(s.step_index ?? 0) + 1}`}
              </span>
            ))}
          </div>
        </div>
        <div className="font-mono text-[11px] text-gray-700 ml-6 shrink-0">
          {run.createdAt && new Date(run.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </button>
  );
}

// ── Run timeline ──────────────────────────────────────────────────────────────

function RunTimeline({ steps, anomalyRun, registry, onSelect }: {
  steps: Call[];
  anomalyRun?: AnomalyRun;
  registry?: ConditionRegistry;
  onSelect: (c: Call) => void;
}) {
  if (!steps.length) return null;

  function fmtMs(ms: number) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
  }

  const stepsWithTime = steps.map(step => {
    const endMs   = step.created_at ? new Date(step.created_at).getTime() : 0;
    const startMs = endMs - (step.latency_ms ?? 0);
    return { step, startMs, endMs };
  });

  const runStart = Math.min(...stepsWithTime.map(s => s.startMs));
  const runEnd   = Math.max(...stepsWithTime.map(s => s.endMs));
  const totalMs  = Math.max(runEnd - runStart, 1);

  return (
    <div className="w-full space-y-2">
      <div className="flex font-mono text-[10px] text-gray-700 pl-44 mb-1 justify-between pr-1">
        <span>0</span>
        <span>{fmtMs(totalMs / 2)}</span>
        <span>{fmtMs(totalMs)}</span>
      </div>

      {stepsWithTime.map(({ step, startMs, endMs }, i) => {
        const anomalyStep = anomalyRun?.steps.find(s => s.step_name === step.step_name);
        const isError   = step.status_success === false;
        const stepScore = anomalyStep?.codes.reduce((s, c) => s + c.score, 0) ?? 0;
        const leftPct   = ((startMs - runStart) / totalMs) * 100;
        const widthPct  = Math.max(((endMs - startMs) / totalMs) * 100, 1.5);

        const barColor = isError ? 'bg-red-500'
          : stepScore >= 50 ? 'bg-red-400/70'
          : anomalyStep    ? 'bg-yellow-400/70'
          : 'bg-violet-500';

        return (
          <div key={step.id ?? i} onClick={() => onSelect(step)} className="flex items-center gap-3 group cursor-pointer">
            <div className="w-44 shrink-0 text-right pr-1 space-y-0.5">
              <div className="flex items-center justify-end gap-1.5 min-w-0">
                <Badge variant={isError ? 'error' : anomalyStep ? 'warning' : 'ok'}>
                  {isError ? 'err' : anomalyStep ? `${stepScore}pt` : 'ok'}
                </Badge>
                <span className="font-mono text-[11px] text-gray-300 truncate">{step.step_name ?? `step_${i + 1}`}</span>
              </div>
              <div className="font-mono text-[10px] text-gray-700">
                {step.latency_ms != null ? fmtMs(step.latency_ms) : '—'}
              </div>
            </div>

            <div className={[
              'flex-1 h-8 border border-white/8 relative overflow-hidden transition-colors',
              'group-hover:border-white/15',
            ].join(' ')}>
              <div
                className={`absolute top-1.5 bottom-1.5 ${barColor}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              />
              {widthPct > 12 && step.latency_ms != null && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 font-mono text-[10px] text-white/60 px-2 pointer-events-none"
                  style={{ left: `${leftPct}%` }}
                >
                  {fmtMs(step.latency_ms)}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {anomalyRun && anomalyRun.steps.some(s => s.codes.length > 0) && (
        <div className="pl-44 mt-3 flex flex-wrap gap-1.5">
          {anomalyRun.steps.flatMap(s =>
            s.codes.map(({ code, score }) => {
              const info = registry?.[String(code)];
              return (
                <span
                  key={`${s.step_name}-${code}`}
                  title={info?.description}
                  className={[
                    'inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 border',
                    score >= 50
                      ? 'border-red-800/60 text-red-400'
                      : 'border-yellow-800/40 text-yellow-500',
                  ].join(' ')}
                >
                  <span className="text-gray-600">{code}</span>
                  {info && <span>{info.name}</span>}
                  <span>+{score}</span>
                </span>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Call detail drawer ────────────────────────────────────────────────────────

interface ParsedPrompt {
  system?: string;
  messages?: Array<{ role: string; content: string }>;
}

type AnomalyStep = AnomalyRun['steps'][number];

function CallDetailDrawer({ call, onClose, anomalyStep, registry }: {
  call: Call;
  onClose: () => void;
  anomalyStep?: AnomalyStep;
  registry?: ConditionRegistry;
}) {
  const isError = call.status_success === false;
  let parsed: ParsedPrompt = {};
  try { if (call.prompt) parsed = JSON.parse(call.prompt); } catch {}

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-[#080808] border-l border-white/10 z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant={isError ? 'error' : 'ok'}>{isError ? 'error' : 'ok'}</Badge>
            <span className="font-sans font-bold text-sm text-white truncate">{call.step_name ?? '—'}</span>
            {call.step_index != null && <span className="font-mono text-[10px] text-gray-700 shrink-0">#{call.step_index + 1}</span>}
          </div>
          <button onClick={onClose} className="font-mono text-gray-600 hover:text-white text-xl leading-none ml-4 shrink-0">×</button>
        </div>

        {/* Meta strip */}
        <div className="px-5 py-3 border-b border-white/8 shrink-0">
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
            <span className="text-gray-700">model <span className="text-gray-400">{call.model ?? '—'}</span></span>
            <span className="text-gray-700">latency <span className="text-gray-400">{call.latency_ms != null ? `${call.latency_ms}ms` : '—'}</span></span>
            <span className="text-gray-700">cost <span className="text-gray-400">${Number(call.cost ?? 0).toFixed(6)}</span></span>
            <span className="text-gray-700">tokens <span className="text-gray-400">{call.input_tokens ?? 0} in / {call.output_tokens ?? 0} out</span></span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-gray-700 truncate">
            run {call.run_id ?? '—'}
            {call.created_at && <span className="ml-3">{new Date(call.created_at).toLocaleString()}</span>}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {parsed.system && (
            <section>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">System</p>
              <div className="border-l-2 border-white/10 pl-4 py-1">
                <pre className="font-mono text-[11px] text-gray-400 whitespace-pre-wrap leading-5">{parsed.system}</pre>
              </div>
            </section>
          )}

          {parsed.messages && parsed.messages.length > 0 && (
            <section>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">Messages</p>
              <div className="space-y-2">
                {parsed.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={[
                      'border-l-2 pl-4 py-2',
                      msg.role === 'user' ? 'border-white/10' : 'border-violet-600',
                    ].join(' ')}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-wider mb-1 text-gray-700">{msg.role}</p>
                    <p className="font-mono text-[11px] text-gray-300 whitespace-pre-wrap leading-5">{msg.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {call.output_code && (
            <section>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">Output</p>
              <div className="border-l-2 border-green-700 pl-4 py-1">
                <pre className="font-mono text-[11px] text-green-300 whitespace-pre-wrap leading-5">{call.output_code}</pre>
              </div>
            </section>
          )}

          {isError && call.error && (
            <section>
              <p className="font-mono text-[10px] text-red-600 uppercase tracking-widest mb-2">Error</p>
              <div className="border-l-2 border-red-600 pl-4 py-1">
                <pre className="font-mono text-[11px] text-red-400 leading-5 whitespace-pre-wrap">{call.error}</pre>
              </div>
            </section>
          )}

          {anomalyStep && anomalyStep.codes.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] text-yellow-600 uppercase tracking-widest">Anomaly conditions</p>
                <span className="font-mono text-[10px] text-gray-700">
                  {anomalyStep.codes.reduce((s, c) => s + c.score, 0)} pts total
                </span>
              </div>
              <div className="space-y-2">
                {anomalyStep.codes.map(({ code, score }) => {
                  const info = registry?.[String(code)];
                  const isCritical = score >= 50;
                  return (
                    <div
                      key={code}
                      className={`border-l-2 pl-4 py-2 ${isCritical ? 'border-red-600' : 'border-yellow-600'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[10px] text-gray-600">{code}</span>
                        <span className={`font-mono text-[11px] font-bold ${isCritical ? 'text-red-300' : 'text-yellow-300'}`}>
                          {info?.name ?? `code_${code}`}
                        </span>
                        <span className={`font-mono text-[10px] ml-auto shrink-0 ${isCritical ? 'text-red-400' : 'text-yellow-500'}`}>
                          +{score}pts
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-gray-600 leading-5">{info?.description ?? '—'}</p>
                      {info?.layer && <p className="font-mono text-[10px] text-gray-700 mt-0.5">{info.layer}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ── Step breakdown ────────────────────────────────────────────────────────────

function StepBreakdown({ calls }: { calls: Call[] }) {
  if (!calls.length) return null;

  const byStep = new Map<string, { latencies: number[]; errors: number; costs: number[]; total: number }>();
  for (const c of calls) {
    const name = c.step_name ?? 'unknown';
    if (!byStep.has(name)) byStep.set(name, { latencies: [], errors: 0, costs: [], total: 0 });
    const s = byStep.get(name)!;
    s.total++;
    if (c.latency_ms != null) s.latencies.push(c.latency_ms);
    if (c.status_success === false) s.errors++;
    if (c.cost != null) s.costs.push(c.cost);
  }

  const rows = Array.from(byStep.entries()).map(([name, { latencies, errors, costs, total }]) => {
    const sorted  = [...latencies].sort((a, b) => a - b);
    const p95     = sorted.length ? sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)] : 0;
    const avg     = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    return { name, total, avg, p95, errors, errorRate: total > 0 ? (errors / total) * 100 : 0, avgCost };
  }).sort((a, b) => b.total - a.total);

  if (!rows.length) return null;
  const maxAvg = Math.max(...rows.map(r => r.avg), 1);

  return (
    <div className="bg-[#0a0a0a] border border-white/8 overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8">
        <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest">Steps</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-b border-white/8">
              <th className="text-left px-5 py-2.5 text-gray-700 font-normal">step</th>
              <th className="text-right px-4 py-2.5 text-gray-700 font-normal">calls</th>
              <th className="px-4 py-2.5 text-gray-700 font-normal w-40">avg latency</th>
              <th className="text-right px-4 py-2.5 text-gray-700 font-normal">p95</th>
              <th className="text-right px-4 py-2.5 text-gray-700 font-normal">errors</th>
              <th className="text-right px-5 py-2.5 text-gray-700 font-normal">avg cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(row => (
              <tr key={row.name} className="hover:bg-white/2 transition-colors">
                <td className="px-5 py-3 text-gray-300">{row.name}</td>
                <td className="px-4 py-3 text-gray-600 text-right tabular-nums">{row.total}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-white/8">
                      <div className="h-full bg-violet-500/60" style={{ width: `${(row.avg / maxAvg) * 100}%` }} />
                    </div>
                    <span className="text-gray-400 tabular-nums w-16 text-right shrink-0">{row.avg}ms</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 text-right tabular-nums">{row.p95}ms</td>
                <td className={`px-4 py-3 text-right tabular-nums ${row.errors > 0 ? 'text-red-400' : 'text-gray-800'}`}>
                  {row.errors > 0 ? `${row.errorRate.toFixed(1)}%` : '—'}
                </td>
                <td className="px-5 py-3 text-gray-600 text-right tabular-nums">${row.avgCost.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AI analysis panel ─────────────────────────────────────────────────────────

function AnalysisPanel({ text, costUsd, onClose }: { text: string; costUsd: number; onClose: () => void }) {
  const lines = text.split('\n');
  return (
    <div className="mb-6 bg-[#0a0a0a] border border-white/8 border-l-2 border-l-violet-600 px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-violet-500 text-sm">✦</span>
          <span className="font-mono text-[10px] text-violet-500 uppercase tracking-widest">AI Analysis</span>
          <span className="font-mono text-[10px] text-gray-700">claude-sonnet-4-6 · ${costUsd.toFixed(5)}</span>
        </div>
        <button onClick={onClose} className="font-mono text-gray-600 hover:text-gray-300 text-sm leading-none">×</button>
      </div>
      <div className="space-y-1">
        {lines.map((line, i) => {
          if (!line.trim()) return <div key={i} className="h-2" />;
          const isBold = line.startsWith('**') && line.endsWith('**');
          const clean = isBold ? line.slice(2, -2) : line.replace(/\*\*(.*?)\*\*/g, '$1');
          return isBold
            ? <p key={i} className="font-mono text-[10px] text-violet-400 uppercase tracking-widest mt-4 first:mt-0">{clean}</p>
            : <p key={i} className={`font-mono text-[11px] leading-5 ${line.startsWith('- ') ? 'pl-3 text-gray-600' : 'text-gray-400'}`}>{clean}</p>;
        })}
      </div>
    </div>
  );
}

// ── Anomalies tab ─────────────────────────────────────────────────────────────

function AnomaliesTab({ runs, registry }: { runs: AnomalyRun[]; registry: ConditionRegistry }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ runId: string; text: string; costUsd: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [query, setQuery] = useState('');

  async function analyzeRun(runId: string) {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch(`${BACKEND}/analyze/run/${runId}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAnalysis({ runId, text: data.analysis, costUsd: data.cost_usd });
    } catch (e) {
      console.error('[analyze]', e);
    } finally {
      setAnalyzing(false);
    }
  }

  if (runs.length === 0) return <EmptyState text="No anomalies detected yet." />;

  const q = query.toLowerCase();
  const filtered = runs.filter(r =>
    !q || r.run_id.toLowerCase().includes(q) || r.steps.some(s => s.step_name.toLowerCase().includes(q))
  );

  return (
    <div className="space-y-2 max-w-3xl">
      <SearchInput value={query} onChange={setQuery} placeholder="Filter by run ID or step name…" />
      {filtered.length === 0 && <EmptyState text="No anomalies match that filter." />}
      {filtered.map((run) => {
        const isOpen = expanded === run.run_id;
        return (
          <div
            key={run.run_id}
            className={[
              'border-l-2',
              run.is_critical ? 'border-red-600' : 'border-yellow-600',
            ].join(' ')}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : run.run_id)}
              className="w-full flex items-center justify-between gap-4 px-4 py-4 text-left bg-[#0a0a0a] hover:bg-white/4 transition-colors border border-l-0 border-white/8"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant={run.is_critical ? 'critical' : 'warning'}>
                  {run.is_critical ? 'critical' : 'warning'}
                </Badge>
                <code className="font-mono text-xs text-gray-400 truncate">{run.run_id}</code>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className={`font-sans font-black text-sm tabular-nums ${run.is_critical ? 'text-red-400' : 'text-yellow-500'}`}>
                  {run.total_score} pts
                </span>
                <span className="font-mono text-[10px] text-gray-700">{new Date(run.latest_at).toLocaleString()}</span>
                <span className="font-mono text-gray-700 text-xs">{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {isOpen && (
              <div className="bg-[#080808] border border-l-0 border-t-0 border-white/8 px-5 py-4 space-y-5">
                {run.steps.map((step) => (
                  <div key={step.step_name}>
                    <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-2">{step.step_name}</p>
                    <div className="space-y-2">
                      {step.codes.map(({ code, score }) => {
                        const info = registry[String(code)];
                        const isCrit = score >= 50;
                        return (
                          <div key={code} className={`border-l-2 pl-4 py-1.5 ${isCrit ? 'border-red-600' : 'border-yellow-600'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[10px] text-gray-700">{code}</span>
                              <span className={`font-mono text-[11px] font-bold ${isCrit ? 'text-red-300' : 'text-yellow-300'}`}>
                                {info?.name ?? `code_${code}`}
                              </span>
                              <span className={`font-mono text-[10px] ml-auto shrink-0 ${isCrit ? 'text-red-400' : 'text-yellow-500'}`}>
                                +{score}pts
                              </span>
                              {info?.layer && <span className="font-mono text-[10px] text-gray-700">{info.layer}</span>}
                            </div>
                            {info?.description && (
                              <p className="font-mono text-[10px] text-gray-700 mt-0.5 leading-5">{info.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-right font-mono text-[10px] text-gray-700 mt-1">
                      step total: {step.codes.reduce((s, c) => s + c.score, 0)} pts
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-3 border-t border-white/8">
                  <span className="font-mono text-[10px] text-gray-700">
                    threshold: {ANOMALY_THRESHOLD} pts — total: <span className={run.is_critical ? 'text-red-400 font-bold' : 'text-yellow-500'}>{run.total_score} pts</span>
                  </span>
                  <button
                    onClick={() => analyzeRun(run.run_id)}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] border border-violet-700/60 text-violet-400 hover:bg-violet-900/20 hover:border-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {analyzing && analysis?.runId !== run.run_id ? <><span className="animate-spin text-[10px]">◌</span> analyzing…</> : <>✦ analyze</>}
                  </button>
                </div>
                {analysis && analysis.runId === run.run_id && (
                  <AnalysisPanel text={analysis.text} costUsd={analysis.costUsd} onClose={() => setAnalysis(null)} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Steps health tab ──────────────────────────────────────────────────────────

function StepsHealthTab({ health }: { health: StepHealthRow[] }) {
  if (health.length === 0) {
    return <EmptyState text="No step profiles yet — run a trace to create step profiles." />;
  }

  const order = { critical: 0, degrading: 1, warming: 2, healthy: 3 };
  const sorted = [...health].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const activeCount  = health.filter(s => s.status !== 'warming').length;
  const warmingCount = health.filter(s => s.status === 'warming').length;

  function fmtMetric(metric: string, value: number) {
    if (metric === 'latency_ms') return `${Math.round(value)}ms`;
    if (metric === 'cost') return `$${value.toFixed(5)}`;
    return Math.round(value).toLocaleString();
  }

  function metricLabel(metric: string) {
    if (metric === 'latency_ms') return 'latency';
    if (metric === 'total_tokens') return 'tokens';
    return metric;
  }

  return (
    <div className="space-y-2 max-w-3xl">

      {/* L5 status banner */}
      <div className="bg-[#0a0a0a] border border-white/8 px-5 py-3 flex items-center justify-between gap-4 mb-4">
        <div className="font-mono text-[11px]">
          <span className="text-white font-bold">L5 statistical detection</span>
          <span className="text-gray-700 mx-2">·</span>
          {activeCount > 0
            ? <span className="text-green-500">{activeCount} step{activeCount !== 1 ? 's' : ''} active</span>
            : <span className="text-gray-700">no steps active yet</span>
          }
          {warmingCount > 0 && <span className="text-gray-700 ml-2">· {warmingCount} warming</span>}
        </div>
        <span className="font-mono text-[10px] text-gray-700 shrink-0">{L5_MIN_SAMPLES} calls/step to activate</span>
      </div>

      {sorted.map(row => {
        const isWarming  = row.status === 'warming';
        const isCritical = row.status === 'critical';
        const pct = Math.min((row.sample_count / L5_MIN_SAMPLES) * 100, 100);

        const accentBorder = isCritical ? 'border-red-600'
          : row.status === 'degrading' ? 'border-yellow-600'
          : isWarming ? 'border-white/10'
          : 'border-green-600';

        return (
          <div key={row.step_profile_id} className={`bg-[#0a0a0a] border border-white/8 border-l-2 ${accentBorder} px-5 py-4`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className={[
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  isCritical  ? 'bg-red-500'
                    : row.status === 'degrading' ? 'bg-yellow-500'
                    : isWarming ? 'bg-gray-700'
                    : 'bg-green-500',
                ].join(' ')} />
                <span className={`font-mono text-sm ${isWarming ? 'text-gray-600' : 'text-gray-300'}`}>
                  {row.step_name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[10px] text-gray-700">{row.sample_count} calls</span>
                <Badge variant={isCritical ? 'critical' : row.status === 'degrading' ? 'warning' : row.status === 'warming' ? 'neutral' : 'ok'}>
                  {row.status}
                </Badge>
              </div>
            </div>

            {isWarming && (
              <div className="mt-3">
                <div className="flex justify-between font-mono text-[10px] text-gray-700 mb-1.5">
                  <span>{row.sample_count} / {L5_MIN_SAMPLES} calls to activate L5</span>
                  <span>{Math.round(pct)}%</span>
                </div>
                <div className="h-px bg-white/8">
                  <div className="h-full bg-violet-500/50 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            {row.trends.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
                {row.trends.map(t => (
                  <div key={t.metric} className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-gray-700 w-16 shrink-0">{metricLabel(t.metric)}</span>
                    <span className="text-gray-700">baseline <span className="text-gray-400">{fmtMetric(t.metric, t.baseline_mean)}</span></span>
                    <span className={t.direction === 'up' ? 'text-red-400' : 'text-blue-400'}>{t.direction === 'up' ? '↑' : '↓'}</span>
                    <span className="text-gray-700">recent <span className={isCritical ? 'text-red-300' : 'text-yellow-300'}>{fmtMetric(t.metric, t.recent_mean)}</span></span>
                    <span className={['ml-auto shrink-0 font-bold', Math.abs(t.sigma) >= 2.5 ? 'text-red-400' : 'text-yellow-500'].join(' ')}>
                      {t.sigma > 0 ? '+' : ''}{t.sigma}×IQR
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Usage tab ─────────────────────────────────────────────────────────────────

function UsageTab({ project }: { project: Project }) {
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  const [data, setData] = useState<{
    month_cost_usd: number;
    total_cost_usd: number;
    budget_usd: number | null;
    budget_pct: number | null;
    by_feature: Record<string, number>;
    recent: Array<{ id: number; feature: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; run_id: string }>;
  } | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/projects/${project.id}/usage`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [project.id, BACKEND_URL]);

  if (!data) return <div className="font-mono text-xs text-gray-700 py-8">loading…</div>;

  const budgetPct = data.budget_pct ?? 0;
  const overBudget = data.budget_usd != null && data.month_cost_usd >= data.budget_usd;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/8">
        <StatCard label="This month" value={`$${data.month_cost_usd.toFixed(4)}`} mono />
        <StatCard label="All time"   value={`$${data.total_cost_usd.toFixed(4)}`} mono />
        <div className="border border-white/8 px-4 py-4">
          {data.budget_usd != null ? (
            <>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">Budget</p>
              <p className={`font-sans font-black text-xl tabular-nums ${overBudget ? 'text-red-400' : 'text-white'}`}>
                {budgetPct.toFixed(1)}%
              </p>
              <p className="font-mono text-[10px] text-gray-700 mt-1">of ${data.budget_usd.toFixed(2)}/mo</p>
              <div className="mt-3 h-px bg-white/8">
                <div
                  className={`h-full transition-all ${overBudget ? 'bg-red-500' : budgetPct > 80 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(budgetPct, 100)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">Budget</p>
              <p className="font-sans font-black text-xl text-gray-800">—</p>
              <p className="font-mono text-[10px] text-gray-700 mt-1">not set</p>
            </>
          )}
        </div>
      </div>

      {Object.keys(data.by_feature).length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/8 divide-y divide-white/8">
          <div className="px-4 py-3">
            <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest">This month by feature</p>
          </div>
          {Object.entries(data.by_feature).map(([feature, cost]) => (
            <div key={feature} className="flex items-center justify-between px-4 py-3">
              <span className="font-mono text-[11px] text-gray-500">{feature}</span>
              <span className="font-mono text-[11px] text-gray-300">${cost.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      {data.recent.length > 0 ? (
        <div className="border border-white/8">
          <div className="px-4 py-3 border-b border-white/8">
            <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest">Recent usage</p>
          </div>
          <div className="divide-y divide-white/8">
            {data.recent.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <span className="font-mono text-[11px] text-gray-400">{r.feature}</span>
                  <span className="font-mono text-[10px] text-gray-700 mx-2">·</span>
                  <span className="font-mono text-[10px] text-gray-700">{r.model}</span>
                  <div className="font-mono text-[10px] text-gray-700 mt-0.5">{r.input_tokens + r.output_tokens} tokens · run {r.run_id.slice(0, 8)}…</div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="font-mono text-[11px] text-gray-300">${r.cost_usd.toFixed(6)}</div>
                  <div className="font-mono text-[10px] text-gray-700">{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState text="No usage recorded yet — click ✦ Analyze Run on any run to generate a report." />
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

interface ThresholdData {
  mode: 'static' | 'dynamic';
  calls_used: number;
  calls_needed: number;
  thresholds: { latency_ms_max: number; total_tokens_max: number; cost_max: number };
  baselines?: {
    latency_ms?: { p50: number; p95: number };
    total_tokens?: { p50: number; p95: number };
    cost?: { p50: number; p95: number };
  };
}

function SettingSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="pt-8 border-t border-white/8 first:border-t-0 first:pt-0">
      <h2 className="font-sans font-bold text-sm uppercase tracking-widest text-white mb-1">{title}</h2>
      {description && <p className="font-mono text-[11px] text-gray-600 mb-5 leading-5">{description}</p>}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'bg-black border border-white/8 px-3 py-2 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20 w-full';

function SettingsTab({ project }: { project: Project }) {
  const [url, setUrl]             = useState(project.slack_webhook_url ?? '');
  const [alertOnError, setAlertOnError] = useState(project.alert_on_error ?? true);
  const [rateThreshold, setRateThreshold] = useState(Math.round((project.alert_error_rate_threshold ?? 0.25) * 100));
  const [rateWindow, setRateWindow]   = useState(project.alert_error_rate_window ?? 20);
  const [sentryDsn, setSentryDsn]   = useState(project.sentry_dsn ?? '');
  const [sentryLevel, setSentryLevel] = useState<'critical' | 'warning' | 'none'>((project.sentry_alert_level as 'critical' | 'warning' | 'none') ?? 'critical');
  const [slackAnomalyLevel, setSlackAnomalyLevel] = useState<'critical' | 'warning' | 'none'>((project.slack_anomaly_level as 'critical' | 'warning' | 'none') ?? 'critical');
  const [budget, setBudget]         = useState(project.monthly_budget_usd?.toString() ?? '');
  const [thresholdMode, setThresholdMode] = useState<'dynamic' | 'manual'>((project.threshold_mode as 'dynamic' | 'manual') ?? 'dynamic');
  const [manualLatency, setManualLatency] = useState(project.threshold_latency_ms?.toString() ?? '');
  const [manualTokens, setManualTokens]   = useState(project.threshold_tokens?.toString() ?? '');
  const [manualCost, setManualCost]       = useState(project.threshold_cost?.toString() ?? '');
  const [baseline, setBaseline]     = useState<ThresholdData | null>(null);
  const [saving, setSaving]         = useState(false);
  const [testing, setTesting]       = useState(false);
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null);
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

  useEffect(() => {
    fetch(`${BACKEND_URL}/projects/${project.id}/thresholds`)
      .then(r => r.json()).then(setBaseline).catch(() => {});
  }, [project.id, BACKEND_URL]);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`${BACKEND_URL}/projects/${project.id}/webhook`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slack_webhook_url: url.trim() || null,
          alert_on_error: alertOnError,
          alert_error_rate_threshold: rateThreshold / 100,
          alert_error_rate_window: rateWindow,
          sentry_dsn: sentryDsn.trim() || null,
          sentry_alert_level: sentryLevel,
          slack_anomaly_level: slackAnomalyLevel,
          threshold_mode: thresholdMode,
          threshold_latency_ms: thresholdMode === 'manual' && manualLatency ? parseFloat(manualLatency) : null,
          threshold_tokens: thresholdMode === 'manual' && manualTokens ? parseFloat(manualTokens) : null,
          threshold_cost: thresholdMode === 'manual' && manualCost ? parseFloat(manualCost) : null,
          monthly_budget_usd: budget ? parseFloat(budget) : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function testWebhook() {
    setTesting(true); setMsg(null);
    try {
      const res = await fetch(`${BACKEND_URL}/projects/${project.id}/webhook/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ ok: true, text: 'Test message sent — check Slack.' });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  const alertLevelOptions = [
    { value: 'critical' as const, label: 'critical only' },
    { value: 'warning'  as const, label: 'warning + critical' },
    { value: 'none'     as const, label: 'off' },
  ];

  return (
    <div className="max-w-xl space-y-0">

      <SettingSection
        title="Slack alerts"
        description="Paste an Incoming Webhook URL to receive alerts in Slack."
      >
        <div className="space-y-4">
          <Field label="Webhook URL">
            <div className="flex gap-2">
              <input
                type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                className={inputCls}
              />
              <button
                onClick={testWebhook} disabled={testing || !url.trim()}
                className="px-4 py-2 font-mono text-xs border border-white/8 text-gray-400 hover:bg-white/4 disabled:opacity-40 transition-colors shrink-0"
              >
                {testing ? 'sending…' : 'test'}
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-gray-300">Alert on every error call</p>
              <p className="font-mono text-[10px] text-gray-700 mt-0.5">Fires immediately whenever a call returns an error</p>
            </div>
            <Toggle checked={alertOnError} onChange={setAlertOnError} />
          </div>

          <div className="flex items-center gap-8">
            <Field label="Error rate threshold">
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={100} value={rateThreshold}
                  onChange={e => setRateThreshold(Number(e.target.value))}
                  className="w-20 bg-black border border-white/8 px-3 py-2 font-mono text-xs text-gray-300 focus:outline-none focus:border-white/20 text-center"
                />
                <span className="font-mono text-xs text-gray-700">%</span>
              </div>
            </Field>
            <Field label="Over last">
              <div className="flex items-center gap-2">
                <input
                  type="number" min={5} max={100} value={rateWindow}
                  onChange={e => setRateWindow(Number(e.target.value))}
                  className="w-20 bg-black border border-white/8 px-3 py-2 font-mono text-xs text-gray-300 focus:outline-none focus:border-white/20 text-center"
                />
                <span className="font-mono text-xs text-gray-700">calls</span>
              </div>
            </Field>
          </div>

          <Field label="Anomaly alerts">
            <SegmentedControl options={alertLevelOptions} value={slackAnomalyLevel} onChange={setSlackAnomalyLevel} />
            <p className="font-mono text-[10px] text-gray-700 mt-2">
              {slackAnomalyLevel === 'critical' && 'Alerts when anomaly score reaches ≥ 100pts.'}
              {slackAnomalyLevel === 'warning'  && 'Alerts on any anomaly hit, even below threshold.'}
              {slackAnomalyLevel === 'none'      && 'No anomaly alerts sent to Slack.'}
            </p>
          </Field>
        </div>
      </SettingSection>

      <SettingSection
        title="Sentry integration"
        description="When trace.ai detects a critical anomaly, it sends a structured event to your Sentry project — grouped by step name, tagged with model and layer."
      >
        <div className="space-y-4">
          <Field label="Sentry DSN">
            <input
              type="url" value={sentryDsn} onChange={e => setSentryDsn(e.target.value)}
              placeholder="https://…@o….ingest.sentry.io/…"
              className={inputCls}
            />
            <p className="font-mono text-[10px] text-gray-700 mt-1.5">Settings → Client Keys (DSN) in your Sentry project.</p>
          </Field>
          <Field label="Forward to Sentry when">
            <SegmentedControl options={alertLevelOptions} value={sentryLevel} onChange={setSentryLevel} />
            <p className="font-mono text-[10px] text-gray-700 mt-2">
              {sentryLevel === 'critical' && 'Sends to Sentry when run score crosses the threshold (≥ 100pts).'}
              {sentryLevel === 'warning'  && 'Sends to Sentry for any anomaly hit, even below threshold.'}
              {sentryLevel === 'none'      && 'Sentry DSN saved but no events will be forwarded.'}
            </p>
          </Field>
        </div>
      </SettingSection>

      <SettingSection
        title="L4 anomaly thresholds"
        description="Latency, token, and cost limits for anomaly detection."
      >
        <div className="space-y-4">
          <SegmentedControl
            options={[{ value: 'dynamic' as const, label: 'dynamic' }, { value: 'manual' as const, label: 'manual' }]}
            value={thresholdMode}
            onChange={setThresholdMode}
          />
          {thresholdMode === 'dynamic' ? (
            baseline ? (
              <div className="space-y-2">
                <p className="font-mono text-[10px] text-gray-700">
                  {baseline.mode === 'dynamic'
                    ? `Learned from ${baseline.calls_used} calls (p95). Updates automatically.`
                    : `Static defaults active — ${baseline.calls_needed} more calls needed to adapt.`}
                </p>
                {[
                  { label: 'Latency', value: baseline.thresholds.latency_ms_max != null ? `${baseline.thresholds.latency_ms_max.toLocaleString()}ms` : '—', sub: baseline.baselines?.latency_ms?.p50 != null ? `p50 ${baseline.baselines.latency_ms.p50.toLocaleString()}ms` : null },
                  { label: 'Tokens',  value: baseline.thresholds.total_tokens_max != null ? baseline.thresholds.total_tokens_max.toLocaleString() : '—', sub: baseline.baselines?.total_tokens?.p50 != null ? `p50 ${Math.round(baseline.baselines.total_tokens.p50).toLocaleString()}` : null },
                  { label: 'Cost',    value: baseline.thresholds.cost_max != null ? `$${baseline.thresholds.cost_max.toFixed(4)}` : '—', sub: baseline.baselines?.cost?.p50 != null ? `p50 $${baseline.baselines.cost.p50.toFixed(4)}` : null },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="flex items-center justify-between border-b border-white/5 py-2 last:border-b-0">
                    <span className="font-mono text-[11px] text-gray-600">{label}</span>
                    <div className="text-right">
                      <span className="font-mono text-[11px] text-gray-300">{value}</span>
                      {sub && <div className="font-mono text-[10px] text-gray-700">{sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="font-mono text-[10px] text-gray-700">loading baseline…</p>
          ) : (
            <div className="space-y-3">
              <p className="font-mono text-[10px] text-gray-700">Override limits — leave blank to keep the static default.</p>
              {[
                { label: 'Max latency (ms)', placeholder: '10000', value: manualLatency, onChange: setManualLatency },
                { label: 'Max total tokens', placeholder: '50000', value: manualTokens, onChange: setManualTokens },
                { label: 'Max cost (USD)',   placeholder: '1.00',  value: manualCost,   onChange: setManualCost },
              ].map(({ label, placeholder, value, onChange }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <label className="font-mono text-[11px] text-gray-600 shrink-0">{label}</label>
                  <input
                    type="number" min="0" step="any" placeholder={placeholder} value={value}
                    onChange={e => onChange(e.target.value)}
                    className="w-36 bg-black border border-white/8 px-3 py-1.5 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingSection>

      <SettingSection
        title="Monthly budget"
        description="Get a Slack alert when AI analysis spend crosses this amount in the current calendar month."
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-700">$</span>
          <input
            type="number" min="0" step="0.01" placeholder="e.g. 10.00" value={budget}
            onChange={e => setBudget(e.target.value)}
            className="w-36 bg-black border border-white/8 px-3 py-2 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20"
          />
          <span className="font-mono text-[10px] text-gray-700">USD / month — leave blank to disable</span>
        </div>
      </SettingSection>

      <div className="pt-8 border-t border-white/8">
        {msg && <p className={['font-mono text-xs mb-4', msg.ok ? 'text-green-500' : 'text-red-400'].join(' ')}>{msg.text}</p>}
        <button
          onClick={save} disabled={saving}
          className="font-mono text-xs font-bold px-5 py-2.5 bg-white text-black hover:bg-gray-100 disabled:opacity-50 transition-colors"
        >
          {saving ? 'saving…' : 'save settings'}
        </button>
      </div>

      <SettingSection title="Project details">
        <div className="bg-[#0a0a0a] border border-white/8 divide-y divide-white/8">
          {[
            { label: 'Project ID', value: project.id, mono: true },
            { label: 'API key',    value: `${project.API_KEY.slice(0, 12)}…`, mono: true },
            { label: 'Created',   value: new Date(project.created_at).toLocaleDateString() },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3">
              <span className="font-mono text-[11px] text-gray-700">{label}</span>
              <span className="font-mono text-[11px] text-gray-400">{value}</span>
            </div>
          ))}
        </div>
      </SettingSection>

    </div>
  );
}
