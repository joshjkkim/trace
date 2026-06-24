'use client';

import { useEffect, useState, use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

type Tab = 'overview' | 'logs' | 'runs' | 'anomalies' | 'usage' | 'settings';

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
  return Array.from(map.values()).sort((a, b) =>
    b.latest_at.localeCompare(a.latest_at)
  );
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
  '15m': { label: '15m', hours: 0.25,  buckets: 15  },
  '1h':  { label: '1h',  hours: 1,     buckets: 12  },
  '6h':  { label: '6h',  hours: 6,     buckets: 12  },
  '24h': { label: '24h', hours: 24,    buckets: 24  },
  '7d':  { label: '7d',  hours: 168,   buckets: 28  },
  '30d': { label: '30d', hours: 720,   buckets: 30  },
};

// Bucket calls into N equal time windows over the last `hours` hours
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

  const runs = useMemo(() => groupIntoRuns(calls), [calls]);
  const selectedRun = useMemo(
    () => runs.find((r) => r.runId === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const anomalyRuns = useMemo(() => groupAnomalies(anomalies), [anomalies]);
  const criticalCount = anomalyRuns.filter((r) => r.is_critical).length;
  const anomalyMap = useMemo(
    () => new Map(anomalyRuns.map((r) => [r.run_id, r])),
    [anomalyRuns],
  );

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

      const [callsRes, anomaliesRes, registryRes] = await Promise.all([
        fetch(`${BACKEND}/calls/project/${projectId}`),
        fetch(`${BACKEND}/anomalies/project/${proj.id}`),
        fetch(`${BACKEND}/anomalies/registry`),
      ]);
      if (callsRes.ok) setCalls((await callsRes.json() as Call[]).slice().reverse());
      if (anomaliesRes.ok) setAnomalies(await anomaliesRes.json() as AnomalyRow[]);
      if (registryRes.ok) setConditionRegistry(await registryRes.json() as ConditionRegistry);
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
      <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-4">You don't have access to this project.</p>
          <a href="/dashboard" className="text-gray-400 hover:text-white text-sm underline">Back to dashboard</a>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <p className="text-gray-600 text-sm">Loading…</p>
      </main>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'logs',      label: 'Logs' },
    { id: 'runs',      label: `Runs${runs.length ? ` (${runs.length})` : ''}` },
    { id: 'anomalies', label: `Anomalies${criticalCount ? ` (${criticalCount} critical)` : anomalyRuns.length ? ` (${anomalyRuns.length})` : ''}` },
    { id: 'usage',     label: 'Usage' },
    { id: 'settings',  label: 'Settings' },
  ];

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <div className="border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <a href="/dashboard" className="text-gray-500 hover:text-gray-300 transition-colors shrink-0">Projects</a>
              <span className="text-gray-700">/</span>
              <span className="text-gray-100 font-medium truncate">{project.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={[
                'w-1.5 h-1.5 rounded-full shrink-0',
                status === 'connected'  ? 'bg-green-400' : '',
                status === 'connecting' ? 'bg-yellow-400 animate-pulse' : '',
                status === 'error'      ? 'bg-red-500' : '',
              ].join(' ')} />
              <span className="text-gray-600 text-xs">
                {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Realtime error'}
              </span>
            </div>
          </div>
          <code className="hidden sm:block text-xs text-green-400 font-mono bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 max-w-[200px] truncate shrink-0">
            {project.API_KEY}
          </code>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto flex gap-0.5 mt-4 overflow-x-auto scrollbar-none -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelectedRunId(null); }}
              className={[
                'px-3 py-1.5 text-xs sm:text-sm font-medium rounded-t border-b-2 transition-colors whitespace-nowrap shrink-0',
                tab === t.id
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-gray-500 hover:text-gray-300',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">

        {/* ── Overview ── */}
        {tab === 'overview' && <OverviewTab calls={calls} />}

        {/* ── Logs ── */}
        {tab === 'logs' && (() => {
          const q = logsQuery.toLowerCase();
          const filtered = calls.filter(c =>
            !q ||
            (c.step_name ?? '').toLowerCase().includes(q) ||
            (c.model ?? '').toLowerCase().includes(q) ||
            (c.run_id ?? '').toLowerCase().includes(q) ||
            (c.error ?? '').toLowerCase().includes(q)
          );
          return calls.length === 0
            ? <EmptyState text="No calls yet — run your first trace to see logs here." />
            : (
              <div>
                <SearchBar value={logsQuery} onChange={setLogsQuery} placeholder="Filter by step, model, run ID, error…" />
                {filtered.length === 0
                  ? <EmptyState text="No calls match that filter." />
                  : <div className="space-y-2">{filtered.map((c) => <CallRow key={`${c.id}`} call={c} anomaly={c.run_id ? anomalyMap.get(c.run_id) : undefined} onSelect={setSelectedCall} />)}</div>
                }
              </div>
            );
        })()}

        {/* ── Runs ── */}
        {tab === 'runs' && !selectedRunId && (() => {
          const q = runsQuery.toLowerCase();
          const filtered = runs.filter(r =>
            !q ||
            r.runId.toLowerCase().includes(q) ||
            r.steps.some(s => (s.step_name ?? '').toLowerCase().includes(q) || (s.model ?? '').toLowerCase().includes(q))
          );
          return runs.length === 0
            ? <EmptyState text="No runs yet." />
            : (
              <div>
                <SearchBar value={runsQuery} onChange={setRunsQuery} placeholder="Filter by run ID, step name, model…" />
                {filtered.length === 0
                  ? <EmptyState text="No runs match that filter." />
                  : <div className="space-y-2">{filtered.map((r) => <RunCard key={r.runId} run={r} anomaly={anomalyMap.get(r.runId)} onClick={() => setSelectedRunId(r.runId)} />)}</div>
                }
              </div>
            );
        })()}

        {/* ── Run detail / graph ── */}
        {tab === 'runs' && selectedRunId && selectedRun && (
          <div>
            <button
              onClick={() => { setSelectedRunId(null); setAnalysis(null); }}
              className="text-gray-500 hover:text-gray-300 text-sm mb-6 transition-colors flex items-center gap-1.5"
            >
              ← Runs
            </button>
            <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-gray-500 mb-1">Run ID</p>
                <code className="text-sm font-mono text-gray-300 break-all">{selectedRun.runId}</code>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span>{selectedRun.steps.length} steps</span>
                  <span>${selectedRun.totalCost.toFixed(6)}</span>
                  <span>{selectedRun.totalLatency}ms total</span>
                  {selectedRun.errorCount > 0 && <span className="text-red-400">{selectedRun.errorCount} error{selectedRun.errorCount > 1 ? 's' : ''}</span>}
                </div>
              </div>
              <button
                onClick={() => analyzeRun(selectedRun.runId)}
                disabled={analyzing}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-700 bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/60 hover:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {analyzing ? (
                  <><span className="animate-spin text-[10px]">◌</span> Analyzing…</>
                ) : (
                  <>✦ Analyze Run</>
                )}
              </button>
            </div>

            {analysis && analysis.runId === selectedRun.runId && (
              <AnalysisPanel text={analysis.text} costUsd={analysis.costUsd} onClose={() => setAnalysis(null)} />
            )}

            <RunGraph steps={selectedRun.steps} anomalyRun={anomalyMap.get(selectedRun.runId)} registry={conditionRegistry} onSelect={setSelectedCall} />
          </div>
        )}

        {/* ── Anomalies ── */}
        {tab === 'anomalies' && <AnomaliesTab runs={anomalyRuns} registry={conditionRegistry} />}

        {/* ── Settings ── */}
        {tab === 'usage'    && <UsageTab project={project} />}
        {tab === 'settings' && <SettingsTab project={project} />}

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

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative mb-4">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs pointer-events-none">⌕</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-7 pr-9 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-sm leading-none">×</button>
      )}
    </div>
  );
}

function OverviewTab({ calls }: { calls: Call[] }) {
  const [range, setRange] = useState<TimeRange>('24h');
  const cfg = RANGES[range];

  const fc = useMemo(() => {
    const cutoff = Date.now() - cfg.hours * 3_600_000;
    return calls.filter((c) => c.created_at ? new Date(c.created_at).getTime() >= cutoff : false);
  }, [calls, cfg.hours]);

  const filteredRuns = useMemo(() => groupIntoRuns(fc), [fc]);

  const totalCost   = fc.reduce((s, c) => s + (c.cost ?? 0), 0);
  const totalTokens = fc.reduce((s, c) => s + (c.total_tokens ?? 0), 0);
  const errorCount  = fc.filter((c) => c.status_success === false).length;
  const avgLatency  = fc.length ? Math.round(fc.reduce((s, c) => s + (c.latency_ms ?? 0), 0) / fc.length) : 0;
  const errorRate   = fc.length ? (errorCount / fc.length) * 100 : 0;

  const buckets   = useMemo(() => timeBuckets(fc, cfg.buckets, cfg.hours), [fc, cfg]);
  const callData  = buckets.map((b) => b.calls);
  const costData  = buckets.map((b) => b.cost);
  const tokenData = buckets.map((b) => b.tokens);

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

  return (
    <div className="space-y-6">

      {/* Range picker */}
      <div className="flex justify-end">
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5 gap-0.5">
          {(Object.keys(RANGES) as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                range === r
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300',
              ].join(' ')}
            >
              {RANGES[r].label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Runs"        value={filteredRuns.length.toString()} />
        <StatCard label="Calls"       value={fc.length.toString()} />
        <StatCard label="Total cost"  value={`$${totalCost.toFixed(4)}`} mono />
        <StatCard label="Avg latency" value={fc.length ? `${avgLatency}ms` : '—'} />
        <StatCard label="Error rate"  value={fc.length ? `${errorRate.toFixed(1)}%` : '—'} alert={errorRate > 5} />
        <StatCard label="Tokens"      value={totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens.toString()} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 font-medium mb-4">Calls · {cfg.label}</p>
          <BarChart data={callData} color="bg-indigo-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 font-medium mb-4">Models</p>
          {models.length === 0 ? (
            <p className="text-gray-700 text-xs mt-8 text-center">No data</p>
          ) : (
            <div className="space-y-3">
              {models.map(([model, { calls: cnt, cost }]) => (
                <div key={model}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs font-mono text-gray-400 truncate max-w-[140px]">{model.replace('claude-', '')}</span>
                    <span className="text-xs text-gray-500 shrink-0 ml-2">{cnt} · ${cost.toFixed(4)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(cnt / totalModelCalls) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost + tokens charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 font-medium mb-4">Cost · {cfg.label}</p>
          <BarChart data={costData} color="bg-emerald-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 font-medium mb-4">Tokens · {cfg.label}</p>
          <BarChart data={tokenData} color="bg-violet-500" />
          <ChartAxis first={firstLabel} last={lastLabel} />
        </div>
      </div>

      {/* Recent errors */}
      {errorCount > 0 && (
        <div className="bg-gray-900 border border-red-900/50 rounded-xl p-5">
          <p className="text-xs text-red-400 font-medium mb-3">Recent errors</p>
          <div className="space-y-2">
            {fc.filter((c) => c.status_success === false).slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-start gap-3 text-xs font-mono">
                <span className="text-red-500 shrink-0">✕</span>
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

// ── Small reusable components ─────────────────────────────────────────────────

function StatCard({ label, value, mono, alert }: { label: string; value: string; mono?: boolean; alert?: boolean }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-4">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <p className={['text-xl font-semibold tabular-nums', alert ? 'text-red-400' : 'text-gray-100', mono ? 'font-mono' : ''].join(' ')}>
        {value}
      </p>
    </div>
  );
}

function BarChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${color} transition-all`}
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '3px' : '0', opacity: 0.75 }}
        />
      ))}
    </div>
  );
}

function ChartAxis({ first, last }: { first?: Date; last?: Date }) {
  const fmt = (d?: Date) => d?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  return (
    <div className="flex justify-between mt-1.5">
      <span className="text-[10px] text-gray-700">{fmt(first)}</span>
      <span className="text-[10px] text-gray-700">{fmt(last)}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center py-24 text-gray-600 text-sm">{text}</div>;
}

// ── Raw log row ───────────────────────────────────────────────────────────────

function CallRow({ call, anomaly, onSelect }: { call: Call; anomaly?: AnomalyRun; onSelect: (c: Call) => void }) {
  const isError = call.status_success === false;
  return (
    <div
      onClick={() => onSelect(call)}
      className={[
        'rounded-lg border px-4 py-3 font-mono text-xs grid grid-cols-[1fr_auto] gap-x-4 cursor-pointer transition-colors',
        isError ? 'border-red-800 bg-red-950/40 hover:border-red-700'
          : anomaly?.is_critical ? 'border-red-800/50 bg-red-950/20 hover:border-red-700/50'
          : anomaly ? 'border-yellow-800/40 bg-yellow-950/10 hover:border-yellow-700/50'
          : 'border-gray-800 bg-gray-900 hover:border-gray-600',
      ].join(' ')}
    >
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
            isError ? 'bg-red-800 text-red-200' : 'bg-green-900 text-green-300'].join(' ')}>
            {isError ? 'error' : 'ok'}
          </span>
          {anomaly && (
            <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
              anomaly.is_critical ? 'bg-red-900 text-red-300' : 'bg-yellow-900/60 text-yellow-400'].join(' ')}>
              {anomaly.is_critical ? `critical ${anomaly.total_score}pts` : `warn ${anomaly.total_score}pts`}
            </span>
          )}
          <span className="text-gray-200 font-semibold">{call.step_name ?? '—'}</span>
          <span className="text-gray-500">{call.model ?? ''}</span>
          {call.step_index != null && <span className="text-gray-700">#{call.step_index + 1}</span>}
        </div>
        {isError && call.error && <div className="text-red-400 truncate">{call.error}</div>}
        {!isError && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-400">
            <span><span className="text-gray-600">tokens </span>{call.input_tokens ?? 0} / {call.output_tokens ?? 0}</span>
            {call.cost != null && <span><span className="text-gray-600">cost </span>${Number(call.cost).toFixed(6)}</span>}
          </div>
        )}
        <div className="text-gray-700 truncate">run {call.run_id ?? '—'}</div>
      </div>
      <div className="text-right text-gray-500 whitespace-nowrap">
        {call.latency_ms != null && <div className="text-gray-300">{call.latency_ms}ms</div>}
        {call.created_at && <div className="text-gray-600 text-[10px]">{new Date(call.created_at).toLocaleTimeString()}</div>}
      </div>
    </div>
  );
}

// ── Run summary card ──────────────────────────────────────────────────────────

function RunCard({ run, anomaly, onClick }: { run: Run; anomaly?: AnomalyRun; onClick: () => void }) {
  const hasError = run.errorCount > 0;
  return (
    <button onClick={onClick} className={[
      'w-full text-left border rounded-xl px-5 py-4 hover:border-gray-600 transition-colors',
      anomaly?.is_critical ? 'bg-red-950/20 border-red-800/50 hover:border-red-700/60'
        : anomaly ? 'bg-yellow-950/10 border-yellow-800/30 hover:border-yellow-700/50'
        : 'bg-gray-900 border-gray-800',
    ].join(' ')}>
      <div className="flex items-center justify-between">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
              hasError ? 'bg-red-800 text-red-200' : 'bg-green-900 text-green-300'].join(' ')}>
              {hasError ? `${run.errorCount} err` : 'ok'}
            </span>
            {anomaly && (
              <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
                anomaly.is_critical ? 'bg-red-900 text-red-300' : 'bg-yellow-900/60 text-yellow-400'].join(' ')}>
                {anomaly.is_critical ? `critical ${anomaly.total_score}pts` : `warn ${anomaly.total_score}pts`}
              </span>
            )}
            <code className="text-xs font-mono text-gray-400">{run.runId.slice(0, 16)}…</code>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{run.steps.length} step{run.steps.length !== 1 ? 's' : ''}</span>
            <span>${run.totalCost.toFixed(6)}</span>
            <span>{run.totalLatency}ms</span>
            <span>{run.totalTokens.toLocaleString()} tok</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {run.steps.map((s) => (
              <span key={s.id} className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">
                {s.step_name ?? `step_${(s.step_index ?? 0) + 1}`}
              </span>
            ))}
          </div>
        </div>
        <div className="text-gray-600 text-xs ml-6 shrink-0">
          {run.createdAt && new Date(run.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </button>
  );
}

// ── Run graph ─────────────────────────────────────────────────────────────────

function RunGraph({ steps, anomalyRun, registry, onSelect }: { steps: Call[]; anomalyRun?: AnomalyRun; registry?: ConditionRegistry; onSelect: (c: Call) => void }) {
  return (
    <div className="flex flex-col items-center w-full">
      {steps.map((step, i) => {
        const anomalyStep = anomalyRun?.steps.find((s) => s.step_name === step.step_name);
        return (
        <div key={step.id} className="flex flex-col items-center w-full max-w-xl">
          <GraphNode step={step} index={i} anomalyStep={anomalyStep} registry={registry} onSelect={onSelect} />
          {i < steps.length - 1 && (
            <div className="flex flex-col items-center py-1">
              <div className="w-px h-5 bg-gray-700" />
              <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-700" />
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

// ── Call detail drawer ────────────────────────────────────────────────────────

interface ParsedPrompt {
  system?: string;
  messages?: Array<{ role: string; content: string }>;
}

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
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-gray-950 border-l border-gray-800 z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={[
              'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0',
              isError ? 'bg-red-800 text-red-200' : 'bg-green-900 text-green-300',
            ].join(' ')}>
              {isError ? 'error' : 'ok'}
            </span>
            <span className="font-semibold text-gray-100 truncate">{call.step_name ?? '—'}</span>
            {call.step_index != null && <span className="text-gray-600 text-xs shrink-0">#{call.step_index + 1}</span>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none ml-4 shrink-0">×</button>
        </div>

        {/* Metadata strip */}
        <div className="px-5 py-3 border-b border-gray-800 shrink-0">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono">
            <span className="text-gray-500">model <span className="text-gray-300">{call.model ?? '—'}</span></span>
            <span className="text-gray-500">latency <span className="text-gray-300">{call.latency_ms != null ? `${call.latency_ms}ms` : '—'}</span></span>
            <span className="text-gray-500">cost <span className="text-gray-300">${Number(call.cost ?? 0).toFixed(6)}</span></span>
            <span className="text-gray-500">tokens <span className="text-gray-300">{call.input_tokens ?? 0} in / {call.output_tokens ?? 0} out</span></span>
          </div>
          <div className="mt-1.5 text-[10px] font-mono text-gray-700 truncate">
            run {call.run_id ?? '—'}
            {call.created_at && <span className="ml-3">{new Date(call.created_at).toLocaleString()}</span>}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {parsed.system && (
            <section>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">System</p>
              <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-3 text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {parsed.system}
              </div>
            </section>
          )}

          {parsed.messages && parsed.messages.length > 0 && (
            <section>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Messages</p>
              <div className="space-y-2">
                {parsed.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={[
                      'rounded-lg px-3 py-2.5 text-xs font-mono leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-gray-900 border border-gray-800 text-gray-300'
                        : 'bg-indigo-950/40 border border-indigo-900/40 text-indigo-200',
                    ].join(' ')}
                  >
                    <p className="text-[10px] uppercase tracking-wider mb-1.5 opacity-50">{msg.role}</p>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {call.output_code && (
            <section>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Output</p>
              <div className="bg-gray-900 border border-emerald-900/40 rounded-lg px-3 py-3 text-xs text-emerald-200 whitespace-pre-wrap font-mono leading-relaxed">
                {call.output_code}
              </div>
            </section>
          )}

          {isError && call.error && (
            <section>
              <p className="text-[10px] text-red-500 uppercase tracking-widest mb-2">Error</p>
              <div className="bg-red-950/40 border border-red-800 rounded-lg px-3 py-3 text-xs text-red-300 font-mono leading-relaxed whitespace-pre-wrap">
                {call.error}
              </div>
            </section>
          )}

          {anomalyStep && anomalyStep.codes.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-yellow-600 uppercase tracking-widest">Anomaly conditions</p>
                <span className="text-[10px] font-mono text-gray-600">
                  {anomalyStep.codes.reduce((s, c) => s + c.score, 0)} pts total
                </span>
              </div>
              <div className="space-y-2">
                {anomalyStep.codes.map(({ code, score }) => {
                  const info = registry?.[String(code)];
                  const layer = info?.layer ?? '';
                  const isCritical = score >= 50;
                  return (
                    <div key={code} className={[
                      'rounded-lg border px-3 py-2.5',
                      isCritical ? 'bg-red-950/30 border-red-800/60' : 'bg-yellow-950/20 border-yellow-800/40',
                    ].join(' ')}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-gray-600 shrink-0">{code}</span>
                        <span className={`text-xs font-semibold ${isCritical ? 'text-red-300' : 'text-yellow-300'}`}>
                          {info?.name ?? `code_${code}`}
                        </span>
                        <span className={`text-[10px] font-mono ml-auto shrink-0 ${isCritical ? 'text-red-400' : 'text-yellow-500'}`}>
                          +{score}pts
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">{info?.description ?? '—'}</p>
                      {layer && <p className="text-[10px] text-gray-600 mt-1 font-mono">{layer}</p>}
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

type AnomalyStep = AnomalyRun['steps'][number];

function GraphNode({ step, index, anomalyStep, registry, onSelect }: {
  step: Call;
  index: number;
  anomalyStep?: AnomalyStep;
  registry?: ConditionRegistry;
  onSelect: (c: Call) => void;
}) {
  const isError = step.status_success === false;
  const stepScore = anomalyStep?.codes.reduce((s, c) => s + c.score, 0) ?? 0;
  return (
    <div
      onClick={() => onSelect(step)}
      className={[
        'w-full rounded-xl border px-5 py-4 font-mono text-xs cursor-pointer transition-colors',
        isError ? 'border-red-800 bg-red-950/40 hover:border-red-700'
          : anomalyStep ? 'border-yellow-700/50 bg-yellow-950/15 hover:border-yellow-600/60'
          : 'border-gray-700 bg-gray-900 hover:border-gray-500',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-600 text-[10px]">#{index + 1}</span>
            <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
              isError ? 'bg-red-800 text-red-200' : 'bg-green-900 text-green-300'].join(' ')}>
              {isError ? 'error' : 'ok'}
            </span>
            {anomalyStep && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-yellow-900/60 text-yellow-400">
                {stepScore}pts
              </span>
            )}
            <span className="text-gray-100 font-semibold text-sm">{step.step_name ?? `step_${index + 1}`}</span>
          </div>
          <div className="text-gray-500">{step.model}</div>
          {isError && step.error && <div className="text-red-400">{step.error}</div>}
          {!isError && (
            <div className="flex gap-4 text-gray-400">
              <span><span className="text-gray-600">in </span>{step.input_tokens ?? 0}</span>
              <span><span className="text-gray-600">out </span>{step.output_tokens ?? 0}</span>
              {step.cost != null && <span><span className="text-gray-600">cost </span>${Number(step.cost).toFixed(6)}</span>}
            </div>
          )}
          {anomalyStep && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {anomalyStep.codes.map(({ code, score }) => {
                const info = registry?.[String(code)];
                return (
                  <span key={code} title={info?.description} className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                    <span className="text-gray-500">{code}</span>
                    {info && <span className="text-gray-300">{info.name}</span>}
                    <span className={score >= 50 ? 'text-red-400' : 'text-yellow-500'}>+{score}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          {step.latency_ms != null && <div className="text-gray-200 text-sm">{step.latency_ms}ms</div>}
          {step.created_at && <div className="text-gray-600 text-[10px] mt-1">{new Date(step.created_at).toLocaleTimeString()}</div>}
        </div>
      </div>
    </div>
  );
}

// ── AI Analysis panel ─────────────────────────────────────────────────────────

function AnalysisPanel({ text, costUsd, onClose }: { text: string; costUsd: number; onClose: () => void }) {
  const lines = text.split('\n');
  return (
    <div className="mb-6 rounded-xl border border-indigo-800/60 bg-indigo-950/30 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-sm">✦</span>
          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">AI Analysis</span>
          <span className="text-[10px] text-gray-600 font-mono">claude-sonnet-4-6 · ${costUsd.toFixed(5)}</span>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-sm leading-none">×</button>
      </div>
      <div className="text-sm text-gray-300 leading-relaxed space-y-1">
        {lines.map((line, i) => {
          if (!line.trim()) return <div key={i} className="h-2" />;
          const isBold = line.startsWith('**') && line.endsWith('**');
          const clean = isBold ? line.slice(2, -2) : line.replace(/\*\*(.*?)\*\*/g, '$1');
          return isBold
            ? <p key={i} className="text-indigo-200 font-semibold text-xs uppercase tracking-wider mt-3 first:mt-0">{clean}</p>
            : <p key={i} className={line.startsWith('- ') ? 'pl-3 text-gray-400 text-xs' : 'text-gray-300 text-xs'}>{clean}</p>;
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

  if (runs.length === 0) {
    return <EmptyState text="No anomalies detected yet." />;
  }

  const q = query.toLowerCase();
  const filtered = runs.filter(r =>
    !q ||
    r.run_id.toLowerCase().includes(q) ||
    r.steps.some(s => s.step_name.toLowerCase().includes(q))
  );

  return (
    <div className="space-y-3 max-w-3xl">
      <SearchBar value={query} onChange={setQuery} placeholder="Filter by run ID or step name…" />
      {filtered.length === 0 && <EmptyState text="No anomalies match that filter." />}
      {filtered.map((run) => {
        const isOpen = expanded === run.run_id;
        return (
          <div
            key={run.run_id}
            className={[
              'rounded-xl border transition-colors',
              run.is_critical ? 'border-red-800 bg-red-950/30' : 'border-yellow-800/50 bg-yellow-950/20',
            ].join(' ')}
          >
            {/* Header row */}
            <button
              onClick={() => setExpanded(isOpen ? null : run.run_id)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={[
                  'text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0',
                  run.is_critical ? 'bg-red-900 text-red-300' : 'bg-yellow-900/60 text-yellow-400',
                ].join(' ')}>
                  {run.is_critical ? 'critical' : 'warning'}
                </span>
                <code className="text-sm text-gray-300 font-mono truncate">{run.run_id}</code>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className={[
                  'text-sm font-semibold tabular-nums',
                  run.is_critical ? 'text-red-400' : 'text-yellow-500',
                ].join(' ')}>
                  {run.total_score} pts
                </span>
                <span className="text-gray-600 text-xs">{new Date(run.latest_at).toLocaleString()}</span>
                <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {/* Expanded step breakdown */}
            {isOpen && (
              <div className="border-t border-gray-800 px-5 py-4 space-y-4">
                {run.steps.map((step) => (
                  <div key={step.step_name}>
                    <div className="text-xs text-gray-500 font-mono mb-2">{step.step_name}</div>
                    <div className="space-y-2">
                      {step.codes.map(({ code, score }) => {
                        const info = registry[String(code)];
                        return (
                          <div
                            key={code}
                            className="flex items-start gap-3 rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2"
                          >
                            <span className="text-gray-600 font-mono text-[10px] shrink-0 pt-0.5">{code}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-gray-200 text-xs font-semibold">
                                  {info?.name ?? `code_${code}`}
                                </span>
                                <span className={[
                                  'text-[10px] font-mono font-semibold shrink-0',
                                  score >= 50 ? 'text-red-400' : 'text-yellow-500',
                                ].join(' ')}>
                                  +{score}pts
                                </span>
                                {info?.layer && (
                                  <span className="text-[10px] text-gray-600 font-mono">{info.layer}</span>
                                )}
                              </div>
                              {info?.description && (
                                <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed">{info.description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-right text-xs text-gray-600 mt-1">
                      step total: {step.codes.reduce((s, c) => s + c.score, 0)} pts
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-gray-800 mt-2">
                  <span className="text-xs text-gray-500">
                    threshold: {ANOMALY_THRESHOLD} pts — run total: <span className={run.is_critical ? 'text-red-400 font-semibold' : 'text-yellow-500'}>{run.total_score} pts</span>
                  </span>
                  <button
                    onClick={() => analyzeRun(run.run_id)}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-indigo-700 bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/60 hover:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {analyzing && analysis?.runId !== run.run_id ? <><span className="animate-spin text-[10px]">◌</span> Analyzing…</> : <>✦ Analyze</>}
                  </button>
                </div>
                {analysis && analysis.runId === run.run_id && (
                  <div className="mt-3">
                    <AnalysisPanel text={analysis.text} costUsd={analysis.costUsd} onClose={() => setAnalysis(null)} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
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

function UsageTab({ project }: { project: Project }) {
  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  const [data, setData] = useState<{
    month_cost_usd: number;
    total_cost_usd: number;
    budget_usd: number | null;
    budget_pct: number | null;
    by_feature: Record<string, number>;
    recent: Array<{ id: number; feature: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; run_id: string }>;
  } | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/projects/${project.id}/usage`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [project.id, BACKEND]);

  if (!data) return <div className="text-sm text-gray-600 py-8">Loading…</div>;

  const budgetPct = data.budget_pct ?? 0;
  const overBudget = data.budget_usd != null && data.month_cost_usd >= data.budget_usd;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
          <div className="text-2xl font-semibold text-gray-100">${data.month_cost_usd.toFixed(4)}</div>
          <div className="text-xs text-gray-500 mt-1">This month</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
          <div className="text-2xl font-semibold text-gray-100">${data.total_cost_usd.toFixed(4)}</div>
          <div className="text-xs text-gray-500 mt-1">All time</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
          {data.budget_usd != null ? (
            <>
              <div className={`text-2xl font-semibold ${overBudget ? 'text-red-400' : 'text-gray-100'}`}>
                {budgetPct.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">of ${data.budget_usd.toFixed(2)} budget</div>
              <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : budgetPct > 80 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(budgetPct, 100)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-semibold text-gray-600">—</div>
              <div className="text-xs text-gray-600 mt-1">No budget set</div>
            </>
          )}
        </div>
      </div>

      {/* By feature */}
      {Object.keys(data.by_feature).length > 0 && (
        <div className="border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">This month by feature</h3>
          {Object.entries(data.by_feature).map(([feature, cost]) => (
            <div key={feature} className="flex items-center justify-between text-sm">
              <span className="text-gray-400 font-mono text-xs">{feature}</span>
              <span className="text-gray-200">${cost.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent entries */}
      {data.recent.length > 0 ? (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Recent usage</h3>
          </div>
          <div className="divide-y divide-gray-800">
            {data.recent.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <span className="text-gray-400 font-mono text-xs">{r.feature}</span>
                  <span className="text-gray-600 mx-2">·</span>
                  <span className="text-gray-600 text-xs">{r.model}</span>
                  <div className="text-gray-600 text-xs mt-0.5">{r.input_tokens + r.output_tokens} tokens · run {r.run_id.slice(0, 8)}…</div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-gray-200">${r.cost_usd.toFixed(6)}</div>
                  <div className="text-gray-600 text-xs">{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-gray-600 text-sm">
          No usage recorded yet — click <strong className="text-gray-500">✦ Analyze Run</strong> on any run to generate a report.
        </div>
      )}
    </div>
  );
}

function SettingsTab({ project }: { project: Project }) {
  const [url, setUrl] = useState(project.slack_webhook_url ?? '');
  const [alertOnError, setAlertOnError] = useState(project.alert_on_error ?? true);
  const [rateThreshold, setRateThreshold] = useState(
    Math.round((project.alert_error_rate_threshold ?? 0.25) * 100)
  );
  const [rateWindow, setRateWindow] = useState(project.alert_error_rate_window ?? 20);
  const [sentryDsn, setSentryDsn] = useState(project.sentry_dsn ?? '');
  const [sentryLevel, setSentryLevel] = useState<'critical' | 'warning' | 'none'>(
    (project.sentry_alert_level as 'critical' | 'warning' | 'none') ?? 'critical'
  );
  const [slackAnomalyLevel, setSlackAnomalyLevel] = useState<'critical' | 'warning' | 'none'>(
    (project.slack_anomaly_level as 'critical' | 'warning' | 'none') ?? 'critical'
  );
  const [budget, setBudget] = useState(project.monthly_budget_usd?.toString() ?? '');
  const [thresholdMode, setThresholdMode] = useState<'dynamic' | 'manual'>(
    (project.threshold_mode as 'dynamic' | 'manual') ?? 'dynamic'
  );
  const [manualLatency, setManualLatency] = useState(project.threshold_latency_ms?.toString() ?? '');
  const [manualTokens, setManualTokens]   = useState(project.threshold_tokens?.toString() ?? '');
  const [manualCost, setManualCost]       = useState(project.threshold_cost?.toString() ?? '');
  const [baseline, setBaseline] = useState<ThresholdData | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

  useEffect(() => {
    fetch(`${BACKEND_URL}/projects/${project.id}/thresholds`)
      .then(r => r.json())
      .then(setBaseline)
      .catch(() => {});
  }, [project.id, BACKEND_URL]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/projects/${project.id}/webhook`, {
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
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/projects/${project.id}/webhook/test`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ ok: true, text: 'Test message sent — check Slack.' });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-8">

      {/* Slack webhook */}
      <div>
        <h2 className="text-base font-semibold text-gray-100 mb-1">Slack alerts</h2>
        <p className="text-sm text-gray-500 mb-4">
          Paste an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="underline text-gray-400 hover:text-gray-200">Incoming Webhook</a> URL to receive alerts in Slack.
        </p>
        <label className="block text-xs text-gray-400 mb-1.5">Webhook URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
          />
          <button
            onClick={testWebhook}
            disabled={testing || !url.trim()}
            className="px-4 py-2 bg-gray-800 text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {testing ? 'Sending…' : 'Test'}
          </button>
        </div>
      </div>

      {/* Alert rules */}
      <div>
        <h2 className="text-base font-semibold text-gray-100 mb-4">Alert rules</h2>
        <div className="space-y-5">

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="text-sm text-gray-200">Alert on every error call</p>
              <p className="text-xs text-gray-500 mt-0.5">Fires immediately whenever a call returns an error</p>
            </div>
            <button
              role="switch"
              aria-checked={alertOnError}
              onClick={() => setAlertOnError((v) => !v)}
              className={[
                'relative w-10 h-5 rounded-full transition-colors shrink-0',
                alertOnError ? 'bg-white' : 'bg-gray-700',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition-transform',
                alertOnError ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')} />
            </button>
          </label>

          <div className="flex items-center gap-6">
            <div>
              <label className="block text-sm text-gray-200 mb-1">Error rate threshold</label>
              <p className="text-xs text-gray-500 mb-2">5 min cooldown between alerts</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={100} value={rateThreshold}
                  onChange={(e) => setRateThreshold(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500 text-center"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-200 mb-1">Over last</label>
              <p className="text-xs text-gray-500 mb-2">&nbsp;</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={5} max={100} value={rateWindow}
                  onChange={(e) => setRateWindow(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500 text-center"
                />
                <span className="text-sm text-gray-500">calls</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm text-gray-200 mb-1">Anomaly alerts</p>
            <p className="text-xs text-gray-500 mb-2">Send a Slack message when anomalies are detected. 1 min cooldown between alerts.</p>
            <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
              {(['critical', 'warning', 'none'] as const).map((opt, i) => (
                <button
                  key={opt}
                  onClick={() => setSlackAnomalyLevel(opt)}
                  className={[
                    'px-4 py-2 text-xs font-medium transition-colors',
                    i < 2 ? 'border-r border-gray-700' : '',
                    slackAnomalyLevel === opt
                      ? opt === 'critical' ? 'bg-red-900/60 text-red-300'
                        : opt === 'warning' ? 'bg-yellow-900/40 text-yellow-400'
                        : 'bg-gray-800 text-gray-300'
                      : 'bg-transparent text-gray-500 hover:text-gray-300',
                  ].join(' ')}
                >
                  {opt === 'critical' ? 'Critical only' : opt === 'warning' ? 'Warning + critical' : 'Off'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {slackAnomalyLevel === 'critical' && 'Alerts when anomaly score reaches ≥ 100pts.'}
              {slackAnomalyLevel === 'warning' && 'Alerts on any anomaly hit, even below threshold.'}
              {slackAnomalyLevel === 'none' && 'No anomaly alerts sent to Slack.'}
            </p>
          </div>

        </div>
      </div>

      {/* Sentry integration */}
      <div>
        <h2 className="text-base font-semibold text-gray-100 mb-1">Sentry integration</h2>
        <p className="text-sm text-gray-500 mb-4">
          When trace.ai detects a critical anomaly, it sends a structured event to your Sentry project — grouped by step name, tagged with model and layer, ready to trigger your existing alerts.
        </p>
        <label className="block text-xs text-gray-400 mb-1.5">Sentry DSN</label>
        <input
          type="url"
          value={sentryDsn}
          onChange={(e) => setSentryDsn(e.target.value)}
          placeholder="https://…@o….ingest.sentry.io/…"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
        />
        <p className="text-xs text-gray-600 mt-2">
          Find this in your Sentry project under Settings → Client Keys (DSN).
        </p>

        <div className="mt-5">
          <label className="block text-xs text-gray-400 mb-2">Forward to Sentry when</label>
          <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
            {(['critical', 'warning', 'none'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setSentryLevel(opt)}
                className={[
                  'px-4 py-2 text-xs font-medium transition-colors capitalize',
                  sentryLevel === opt
                    ? opt === 'critical' ? 'bg-red-900/60 text-red-300 border-r border-gray-700'
                      : opt === 'warning' ? 'bg-yellow-900/40 text-yellow-400 border-r border-gray-700'
                      : 'bg-gray-800 text-gray-300'
                    : 'bg-transparent text-gray-500 hover:text-gray-300 border-r border-gray-700 last:border-r-0',
                ].join(' ')}
              >
                {opt === 'critical' ? 'Critical only' : opt === 'warning' ? 'Warning + critical' : 'Off'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {sentryLevel === 'critical' && 'Sends to Sentry when run score crosses the threshold (≥ 100pts).'}
            {sentryLevel === 'warning' && 'Sends to Sentry for any anomaly hit, even below threshold.'}
            {sentryLevel === 'none' && 'Sentry DSN saved but no events will be forwarded.'}
          </p>
        </div>
      </div>

      {/* L4 thresholds */}
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">L4 anomaly thresholds</h3>
            <p className="text-xs text-gray-600 mt-0.5">Latency, token, and cost limits for anomaly detection</p>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
            {(['dynamic', 'manual'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setThresholdMode(opt)}
                className={`px-3 py-1.5 capitalize transition-colors ${
                  thresholdMode === opt
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {thresholdMode === 'dynamic' ? (
          baseline ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                {baseline.mode === 'dynamic'
                  ? `Learned from ${baseline.calls_used} calls (p95). Updates automatically.`
                  : `Static defaults active — ${baseline.calls_needed} more calls needed to adapt.`}
              </p>
              {[
                { label: 'Latency', value: baseline.thresholds.latency_ms_max != null ? `${baseline.thresholds.latency_ms_max.toLocaleString()}ms` : '—', sub: baseline.baselines?.latency_ms?.p50 != null ? `p50 ${baseline.baselines.latency_ms.p50.toLocaleString()}ms` : null },
                { label: 'Tokens', value: baseline.thresholds.total_tokens_max != null ? baseline.thresholds.total_tokens_max.toLocaleString() : '—', sub: baseline.baselines?.total_tokens?.p50 != null ? `p50 ${Math.round(baseline.baselines.total_tokens.p50).toLocaleString()}` : null },
                { label: 'Cost', value: baseline.thresholds.cost_max != null ? `$${baseline.thresholds.cost_max.toFixed(4)}` : '—', sub: baseline.baselines?.cost?.p50 != null ? `p50 $${baseline.baselines.cost.p50.toFixed(4)}` : null },
              ].map(({ label, value, sub }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <div className="text-right">
                    <span className="text-gray-300 font-mono text-xs">{value}</span>
                    {sub && <div className="text-xs text-gray-600">{sub}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-600">Loading baseline…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">Override limits — leave blank to keep the static default.</p>
            {[
              { label: 'Max latency (ms)', placeholder: '10000', value: manualLatency, onChange: setManualLatency },
              { label: 'Max total tokens', placeholder: '50000', value: manualTokens, onChange: setManualTokens },
              { label: 'Max cost (USD)', placeholder: '1.00', value: manualCost, onChange: setManualCost },
            ].map(({ label, placeholder, value, onChange }) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <label className="text-sm text-gray-400 shrink-0">{label}</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder={placeholder}
                  value={value}
                  onChange={e => onChange(e.target.value)}
                  className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Budget */}
      <div className="border border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Monthly budget</h3>
        <p className="text-xs text-gray-600">Get a Slack alert when AI analysis spend crosses this amount in the current calendar month.</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 10.00"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <span className="text-xs text-gray-600">USD / month — leave blank to disable</span>
        </div>
      </div>

      {/* Save — covers everything above */}
      {msg && (
        <p className={['text-sm', msg.ok ? 'text-green-400' : 'text-red-400'].join(' ')}>
          {msg.text}
        </p>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="px-5 py-2.5 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      {/* Project info */}
      <div className="border border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Project details</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Project ID</span>
            <code className="text-gray-400 font-mono text-xs">{project.id}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">API key</span>
            <code className="text-gray-400 font-mono text-xs">{project.API_KEY.slice(0, 12)}…</code>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Created</span>
            <span className="text-gray-400 text-xs">{new Date(project.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

    </div>
  );
}
