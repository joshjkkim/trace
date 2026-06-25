'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const inputCls = 'w-full bg-black border border-white/8 px-3 py-2.5 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady]       = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password !== confirm) { setMsg({ ok: false, text: 'Passwords do not match.' }); return; }
    if (password.length < 6)  { setMsg({ ok: false, text: 'Password must be at least 6 characters.' }); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
    } else {
      setMsg({ ok: true, text: 'Password updated! Redirecting…' });
      setTimeout(() => router.replace('/dashboard'), 1500);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white antialiased flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 font-sans font-black text-lg text-white">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            trace.ai
          </a>
          <p className="font-mono text-[11px] text-gray-600 mt-2">set a new password</p>
        </div>

        <div className="bg-[#0a0a0a] border border-white/8 p-8">
          {!ready ? (
            <p className="font-mono text-xs text-gray-700 text-center">verifying reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">New password</label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Confirm password</label>
                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" className={inputCls} />
              </div>
              {msg && <p className={`font-mono text-[11px] ${msg.ok ? 'text-green-500' : 'text-red-400'}`}>{msg.text}</p>}
              <button type="submit" disabled={loading} className="w-full bg-white text-black py-2.5 font-mono text-xs font-bold hover:bg-gray-100 disabled:opacity-50 transition-colors">
                {loading ? 'saving…' : 'set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
