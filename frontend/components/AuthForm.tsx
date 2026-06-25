'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Mode = 'signin' | 'signup' | 'forgot';

function extractMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.error_description === 'string') return e.error_description;
    if (typeof e.error === 'string') return e.error;
    return JSON.stringify(err);
  }
  return 'Something went wrong';
}

const inputCls = 'w-full bg-black border border-white/8 px-3 py-2.5 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20';

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode]         = useState<Mode>('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setInfo('Check your email for a reset link. Supabase limits 2 reset emails per hour.');
      } else if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        router.push('/dashboard');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'forgot') {
    return (
      <div className="bg-[#0a0a0a] border border-white/8 p-8">
        <h2 className="font-sans font-black text-sm text-white mb-1">Reset password</h2>
        <p className="font-mono text-[11px] text-gray-600 mb-6">
          Enter your email and we&apos;ll send a reset link.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
          </div>
          {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}
          {info  && <p className="font-mono text-[11px] text-green-500">{info}</p>}
          <button type="submit" disabled={loading} className="w-full bg-white text-black py-2.5 font-mono text-xs font-bold hover:bg-gray-100 disabled:opacity-50 transition-colors">
            {loading ? 'sending…' : 'send reset link'}
          </button>
        </form>
        <button
          onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
          className="mt-5 font-mono text-[11px] text-gray-700 hover:text-white transition-colors"
        >
          ← back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0a0a] border border-white/8">
      {/* Tab switcher */}
      <div className="flex border-b border-white/8">
        {(['signin', 'signup'] as const).map((m, i) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); setInfo(null); }}
            className={[
              'flex-1 py-3 font-mono text-xs transition-colors',
              i === 0 ? 'border-r border-white/8' : '',
              mode === m ? 'bg-white/5 text-white font-bold' : 'text-gray-600 hover:text-gray-300',
            ].join(' ')}
          >
            {m === 'signin' ? 'sign in' : 'sign up'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-4">
        <div>
          <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Email</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-mono text-[10px] text-gray-700 uppercase tracking-widest">Password</label>
            {mode === 'signin' && (
              <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null); }} className="font-mono text-[10px] text-gray-700 hover:text-white transition-colors">
                forgot password?
              </button>
            )}
          </div>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
        </div>
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-white text-black py-2.5 font-mono text-xs font-bold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? 'loading…' : mode === 'signin' ? 'sign in' : 'create account'}
        </button>
      </form>
    </div>
  );
}
