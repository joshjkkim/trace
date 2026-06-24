'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 'trace_' + Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

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

      const { data: profile, error: profileError } = await supabase
        .from('PROFILES')
        .select('id')
        .eq('email', session.user.email)
        .single();

      console.log('[create-project] profile:', profile, 'error:', profileError);
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
      <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <h2 className="text-sm font-medium text-gray-200">Project created — {created.name}</h2>
              </div>
              <p className="text-xs text-gray-500">Project ID: {created.id}</p>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-2">Your API key — copy it now, it won't be shown again</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-green-300 font-mono truncate">
                  {created.apiKey}
                </code>
                <button
                  onClick={copyKey}
                  className="shrink-0 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-200 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 text-xs font-mono text-gray-400 space-y-1">
              <p className="text-gray-500 mb-2"># Use in your app:</p>
              <p>{'const tracer = new Tracer({'}</p>
              <p className="pl-4">{'apiKey: '}<span className="text-green-300">&apos;{created.apiKey}&apos;</span>,</p>
              <p>{'});'}</p>
            </div>

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full bg-white text-gray-950 rounded-lg py-2 text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
          <div>
            <h1 className="text-lg font-semibold">New project</h1>
            <p className="text-xs text-gray-500 mt-1">Creates a project and generates an SDK API key</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Project name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My AI app"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1.5">Generated API key</p>
            <code className="block bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-green-300 font-mono truncate">
              {apiKey || '—'}
            </code>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !profileId || !name.trim()}
              className="flex-1 bg-white text-gray-950 rounded-lg py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
