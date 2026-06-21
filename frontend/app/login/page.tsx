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
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="text-2xl font-semibold tracking-tight text-white hover:opacity-80 transition-opacity">
            trace.ai
          </a>
          <p className="text-gray-400 text-sm mt-2">Sign in to your account</p>
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
