'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AuthForm from '@/components/AuthForm';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard');
    });
  }, [router]);

  return (
    <main className="min-h-screen bg-black text-white antialiased flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 font-sans font-black text-lg text-white">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            trace.ai
          </a>
          <p className="font-mono text-[11px] text-gray-600 mt-2">sign in to your account</p>
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
