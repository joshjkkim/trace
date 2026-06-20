'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Call {
  id: string;
  run_id?: string;
  step_name?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  latency_ms?: number;
  cost_usd?: number;
  status?: string;
  error?: string;
  created_at?: string;
  [key: string]: unknown;
}

type ConnectionStatus = 'connecting' | 'connected' | 'error';

export default function CallsFeed() {
  const [calls, setCalls]       = useState<Call[]>([]);
  const [status, setStatus]     = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const channel = supabase
      .channel('calls-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'CALLS' },
        (payload) => {
          setCalls((prev) => [payload.new as Call, ...prev]);
        },
      )
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error');
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div>
      {/* Status bar */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className={[
          'w-2 h-2 rounded-full',
          status === 'connected'  ? 'bg-green-400' : '',
          status === 'connecting' ? 'bg-yellow-400 animate-pulse' : '',
          status === 'error'      ? 'bg-red-500' : '',
        ].join(' ')} />
        <span className="text-gray-400">
          {status === 'connected'  && 'Listening for new rows in CALLS'}
          {status === 'connecting' && 'Connecting to Supabase…'}
          {status === 'error'      && 'Realtime connection failed — check Supabase config'}
        </span>
        {calls.length > 0 && (
          <span className="ml-auto text-gray-500">{calls.length} received</span>
        )}
      </div>

      {/* Empty state */}
      {calls.length === 0 && status === 'connected' && (
        <div className="text-center py-24 text-gray-600 text-sm">
          Waiting for rows — run the seed script or make an SDK call to see data here.
        </div>
      )}

      {/* Feed */}
      <div className="space-y-2">
        {calls.map((call) => (
          <CallRow key={call.id ?? call.created_at} call={call} />
        ))}
      </div>
    </div>
  );
}

function CallRow({ call }: { call: Call }) {
  const isError = call.status === 'error';

  return (
    <div className={[
      'rounded-lg border px-4 py-3 font-mono text-xs grid grid-cols-[1fr_auto] gap-x-4 gap-y-1',
      isError
        ? 'border-red-800 bg-red-950/40'
        : 'border-gray-800 bg-gray-900',
    ].join(' ')}>

      {/* Left column */}
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={[
            'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider',
            isError ? 'bg-red-800 text-red-200' : 'bg-green-900 text-green-300',
          ].join(' ')}>
            {call.status ?? 'unknown'}
          </span>
          <span className="text-gray-200 font-semibold">{call.step_name ?? '—'}</span>
          <span className="text-gray-500">{call.model ?? ''}</span>
        </div>

        {isError && call.error && (
          <div className="text-red-400 truncate">{call.error}</div>
        )}

        {!isError && (
          <div className="flex gap-4 text-gray-400">
            <span>
              <span className="text-gray-600">tokens </span>
              {call.input_tokens ?? 0} in / {call.output_tokens ?? 0} out
            </span>
            <span>
              <span className="text-gray-600">total </span>
              {call.total_tokens ?? 0}
            </span>
            {call.cost_usd != null && (
              <span>
                <span className="text-gray-600">cost </span>
                ${Number(call.cost_usd).toFixed(6)}
              </span>
            )}
          </div>
        )}

        <div className="text-gray-600 truncate">
          <span className="text-gray-700">run </span>{call.run_id ?? '—'}
        </div>
      </div>

      {/* Right column */}
      <div className="text-right text-gray-500 whitespace-nowrap">
        {call.latency_ms != null && (
          <div className="text-gray-300">{call.latency_ms}ms</div>
        )}
        {call.created_at && (
          <div className="text-gray-600 text-[10px]">
            {new Date(call.created_at).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}