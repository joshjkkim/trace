'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

interface Project {
  id: number;
  name: string;
  API_KEY: string;
  owner: number;
  created_at: string;
  call_count: number;
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

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">trace.ai</h1>
            <p className="text-gray-500 text-sm mt-1">{email}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/create-project"
              className="text-sm bg-white text-gray-950 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              New project
            </a>
            <button
              onClick={signOut}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-600 text-sm">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-24 text-gray-600 text-sm">
            No projects yet —{' '}
            <a href="/create-project" className="text-gray-400 hover:text-white underline">
              create your first one
            </a>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <a
                key={p.id}
                href={`/dashboard/${p.id}`}
                className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center justify-between hover:border-gray-600 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-100">{p.name}</span>
                    <span className="text-xs text-gray-500">#{p.id}</span>
                  </div>
                  <code className="text-xs text-green-400 font-mono truncate block max-w-sm">
                    {p.API_KEY}
                  </code>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-lg font-semibold text-gray-100">{p.call_count}</div>
                  <div className="text-xs text-gray-500">calls</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
