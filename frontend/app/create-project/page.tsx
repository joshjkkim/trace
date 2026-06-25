'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 'trace_' + Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const inputCls = 'w-full bg-black border border-white/8 px-3 py-2.5 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20';

export default function CreateProject() {
  const router = useRouter();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [apiKey, setApiKey]       = useState('');
  const [name, setName]           = useState('');
  const [created, setCreated]     = useState<{ id: string; apiKey: string; name: string } | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState(false);

  useEffect(() => {
    setApiKey(generateApiKey());
    async function loadProfile() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/'); return; }
      const { data: profile } = await supabase.from('PROFILES').select('id').eq('email', session.user.email).single();
      if (profile) setProfileId(profile.id);
    }
    loadProfile();
  }, [router]);

  async function handleCreate() {
    if (!profileId || !name.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/projects/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: profileId, API_KEY: apiKey, name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const project = await res.json();
      setCreated({ id: project.id, apiKey, name: name.trim() });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(created!.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (created) {
    return (
      <main className="min-h-screen bg-black text-white antialiased flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[#0a0a0a] border border-white/8">

            {/* Header */}
            <div className="border-b border-white/8 px-6 py-5 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <div>
                <p className="font-sans font-black text-sm text-white">{created.name}</p>
                <p className="font-mono text-[10px] text-gray-700 mt-0.5">project id: {created.id}</p>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* API key */}
              <div>
                <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">
                  API key — copy it now, it won&apos;t be shown again
                </p>
                <div className="flex items-center gap-2 border border-white/8 bg-black">
                  <code className="flex-1 font-mono text-[11px] text-green-500 px-3 py-2.5 truncate">
                    {created.apiKey}
                  </code>
                  <button
                    onClick={copyKey}
                    className="shrink-0 px-4 py-2.5 font-mono text-[11px] text-gray-600 hover:text-white border-l border-white/8 transition-colors"
                  >
                    {copied ? 'copied ✓' : 'copy'}
                  </button>
                </div>
              </div>

              {/* Code snippet */}
              <div className="border border-white/8">
                <div className="border-b border-white/8 px-4 py-2">
                  <span className="font-mono text-[10px] text-gray-700 uppercase tracking-widest">typescript</span>
                </div>
                <pre className="px-4 py-4 font-mono text-[11px] text-violet-300 leading-6 overflow-x-auto">{`const tracer = new Tracer({
  apiKey: '${created.apiKey}',
})`}</pre>
              </div>

              <button
                onClick={() => router.push('/dashboard')}
                className="w-full bg-white text-black py-2.5 font-mono text-xs font-bold hover:bg-gray-100 transition-colors"
              >
                go to dashboard →
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white antialiased flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <a href="/dashboard" className="font-mono text-[11px] text-gray-700 hover:text-white transition-colors">← dashboard</a>
        </div>
        <div className="bg-[#0a0a0a] border border-white/8">
          <div className="border-b border-white/8 px-6 py-5">
            <h1 className="font-sans font-black text-lg text-white">New project</h1>
            <p className="font-mono text-[11px] text-gray-600 mt-1">Creates a project and generates an SDK API key</p>
          </div>

          <div className="px-6 py-6 space-y-5">
            <div>
              <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Project name</label>
              <input
                type="text" required value={name} onChange={e => setName(e.target.value)}
                placeholder="my-ai-app"
                className={inputCls}
              />
            </div>

            <div>
              <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Generated API key</p>
              <code className="block border border-white/8 bg-black px-3 py-2.5 font-mono text-[11px] text-green-500 truncate">
                {apiKey || '—'}
              </code>
            </div>

            {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex-1 py-2.5 font-mono text-xs text-gray-600 hover:text-white border border-white/8 hover:border-white/20 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !profileId || !name.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 font-mono text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'creating…' : 'create project'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
