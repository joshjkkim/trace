'use client';

import { useEffect, useState } from 'react';
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
  error_count: number;
  anomaly_count: number;
  last_active: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusDot({ errorRate }: { errorRate: number }) {
  if (errorRate === 0) return <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />;
  if (errorRate < 0.1) return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-2 shrink-0"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail]       = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/'); return; }
      setEmail(session.user.email ?? null);

      const { data: profile } = await supabase
        .from('PROFILES')
        .select('id')
        .eq('email', session.user.email)
        .single();

      if (!profile) { setLoading(false); return; }

      const res = await fetch(`${BACKEND}/projects/owner/${profile.id}`);
      if (res.ok) setProjects(await res.json());
      setLoading(false);
    }
    load();
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  const totalCalls    = projects.reduce((s, p) => s + p.call_count, 0);
  const totalErrors   = projects.reduce((s, p) => s + p.error_count, 0);
  const totalAnomalies = projects.reduce((s, p) => s + p.anomaly_count, 0);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="trace.ai" className="w-7 h-7" />
            <span className="text-lg font-semibold tracking-tight">trace.ai</span>
            <span className="text-gray-700">|</span>
            <span className="text-sm text-gray-500">{email}</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors">Docs</a>
            <a href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">Settings</a>
            <a
              href="/create-project"
              className="text-sm bg-white text-gray-950 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              + New project
            </a>
            <button
              onClick={signOut}
              className="text-sm text-gray-500 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-gray-600 text-sm">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-32">
            <div className="text-4xl mb-4">◎</div>
            <p className="text-gray-400 font-medium mb-1">No projects yet</p>
            <p className="text-gray-600 text-sm mb-6">Create a project to start tracing your AI workflows</p>
            <a
              href="/create-project"
              className="text-sm bg-white text-gray-950 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Create first project
            </a>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                { label: 'Total calls', value: totalCalls.toLocaleString() },
                { label: 'Errors', value: totalErrors.toLocaleString(), dim: totalErrors === 0 },
                { label: 'Anomalies flagged', value: totalAnomalies.toLocaleString(), dim: totalAnomalies === 0 },
              ].map(({ label, value, dim }) => (
                <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
                  <div className={`text-2xl font-semibold ${dim ? 'text-gray-600' : 'text-gray-100'}`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                </div>
              ))}
            </div>

            {/* Project cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-gray-400">Projects ({projects.length})</h2>
              </div>
              {projects.map((p) => {
                const errorRate = p.call_count > 0 ? p.error_count / p.call_count : 0;
                return (
                  <a
                    key={p.id}
                    href={`/dashboard/${p.id}`}
                    className="block bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 hover:border-gray-600 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <StatusDot errorRate={errorRate} />
                          <span className="font-medium text-gray-100 group-hover:text-white transition-colors">
                            {p.name}
                          </span>
                          <span className="text-xs text-gray-600">#{p.id}</span>
                        </div>
                        <div className="flex items-center min-w-0">
                          <code className="text-xs text-green-400 font-mono truncate">
                            {p.API_KEY}
                          </code>
                          <CopyButton value={p.API_KEY} />
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-6 shrink-0 text-right">
                        <div>
                          <div className="text-lg font-semibold text-gray-100">{p.call_count.toLocaleString()}</div>
                          <div className="text-xs text-gray-500">calls</div>
                        </div>
                        <div>
                          <div className={`text-lg font-semibold ${p.error_count > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                            {p.error_count}
                          </div>
                          <div className="text-xs text-gray-500">errors</div>
                        </div>
                        <div>
                          <div className={`text-lg font-semibold ${p.anomaly_count > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                            {p.anomaly_count}
                          </div>
                          <div className="text-xs text-gray-500">anomalies</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-400">{timeAgo(p.last_active)}</div>
                          <div className="text-xs text-gray-600">last active</div>
                        </div>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
