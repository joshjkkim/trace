'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const inputCls = 'w-full bg-black border border-white/8 px-3 py-2.5 font-mono text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20';

export default function SettingsPage() {
  const router = useRouter();
  const [email, setEmail]           = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm]       = useState('');
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading]       = useState(false);
  const [checking, setChecking]     = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setEmail(session.user.email ?? '');
      setChecking(false);
    });
  }, [router]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) { setMsg({ ok: false, text: 'Passwords do not match.' }); return; }
    if (newPassword.length < 6)  { setMsg({ ok: false, text: 'Password must be at least 6 characters.' }); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
    } else {
      setMsg({ ok: true, text: 'Password updated.' });
      setNewPassword('');
      setConfirm('');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="font-mono text-xs text-gray-700">loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white antialiased">

      {/* Nav */}
      <div className="border-b border-white/8">
        <div className="max-w-xl mx-auto px-6 h-12 flex items-center gap-2 font-mono text-xs">
          <a href="/dashboard" className="text-gray-600 hover:text-white transition-colors">dashboard</a>
          <span className="text-white/15">/</span>
          <span className="text-white">account settings</span>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-10 space-y-0">

        {/* Account */}
        <div className="border border-white/8 bg-[#0a0a0a]">
          <div className="border-b border-white/8 px-5 py-4">
            <h2 className="font-sans font-bold text-sm uppercase tracking-widest text-white">Account</h2>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1">Email</p>
            <p className="font-mono text-xs text-gray-300">{email}</p>
          </div>
        </div>

        {/* Change password */}
        <div className="border border-t-0 border-white/8 bg-[#0a0a0a]">
          <div className="border-b border-white/8 px-5 py-4">
            <h2 className="font-sans font-bold text-sm uppercase tracking-widest text-white">Change password</h2>
            <p className="font-mono text-[11px] text-gray-600 mt-1">
              You&apos;re already signed in — no email required.
            </p>
          </div>
          <form onSubmit={handleChangePassword} className="px-5 py-5 space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">New password</label>
              <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Confirm password</label>
              <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" className={inputCls} />
            </div>
            {msg && <p className={`font-mono text-[11px] ${msg.ok ? 'text-green-500' : 'text-red-400'}`}>{msg.text}</p>}
            <button type="submit" disabled={loading} className="w-full bg-white text-black py-2.5 font-mono text-xs font-bold hover:bg-gray-100 disabled:opacity-50 transition-colors">
              {loading ? 'saving…' : 'update password'}
            </button>
          </form>
        </div>

        {/* Sign out */}
        <div className="border border-t-0 border-white/8 bg-[#0a0a0a]">
          <div className="border-b border-white/8 px-5 py-4">
            <h2 className="font-sans font-bold text-sm uppercase tracking-widest text-white">Sign out</h2>
            <p className="font-mono text-[11px] text-gray-600 mt-1">Sign out of this device.</p>
          </div>
          <div className="px-5 py-5">
            <button
              onClick={signOut}
              className="font-mono text-xs px-5 py-2.5 border border-white/8 text-gray-400 hover:border-white/20 hover:text-white transition-colors"
            >
              sign out
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}
