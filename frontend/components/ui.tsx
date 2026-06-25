'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// trace.ai shared design system
//
// Tokens:
//   background  — bg-black (#000)
//   surface     — bg-[#0a0a0a]  ← just enough lift to differentiate from bg
//   border      — border-white/8 (hover: border-white/15)
//   text body   — font-mono text-xs text-gray-500
//   text label  — font-mono text-[10px] text-gray-700 uppercase tracking-widest
//   text value  — font-sans font-black text-white
//   accent      — violet-500 / violet-600
//
// Rules:
//   NO rounded corners on any container, card, button, or input
//   NO gradients, NO glow, NO shadow
//   Solid violet fills only (not violet gradients)
//   Left border bars (border-l-2) for state accents on rows
// ─────────────────────────────────────────────────────────────────────────────

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant = 'ok' | 'error' | 'critical' | 'warning' | 'info' | 'neutral'

const BADGE_STYLES: Record<BadgeVariant, string> = {
  ok:       'bg-green-900/60 text-green-400',
  error:    'bg-red-900 text-red-200',
  critical: 'bg-red-900 text-red-300',
  warning:  'bg-yellow-900/60 text-yellow-400',
  info:     'bg-violet-900/50 text-violet-300',
  neutral:  'bg-white/8 text-gray-400',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  return (
    <span className={`inline-block text-[10px] font-bold font-mono px-1.5 py-0.5 uppercase tracking-wider shrink-0 ${BADGE_STYLES[variant]}`}>
      {children}
    </span>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

export function StatCard({ label, value, mono, alert }: {
  label: string
  value: string
  mono?: boolean
  alert?: boolean
}) {
  return (
    <div className="bg-[#0a0a0a] border border-white/8 px-4 py-4">
      <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-2">{label}</p>
      <p className={[
        'text-xl tabular-nums',
        mono ? 'font-mono' : 'font-sans font-black',
        alert ? 'text-red-400' : 'text-white',
      ].join(' ')}>
        {value}
      </p>
    </div>
  )
}

// ── SearchInput ───────────────────────────────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative mb-4">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-700 text-xs pointer-events-none">⌕</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="w-full bg-black border border-white/8 pl-7 pr-9 py-2 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-white/20"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-sm leading-none"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export function EmptyState({ text }: { text: string }) {
  return <div className="text-center py-24 font-mono text-xs text-gray-700">{text}</div>
}

// ── SegmentedControl ──────────────────────────────────────────────────────────

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex border border-white/8">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'px-3 py-1.5 font-mono text-xs transition-colors',
            i < options.length - 1 ? 'border-r border-white/8' : '',
            value === opt.value ? 'bg-white/8 text-white' : 'text-gray-600 hover:text-gray-400',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={['relative w-9 h-5 transition-colors shrink-0', checked ? 'bg-violet-600' : 'bg-white/10'].join(' ')}
    >
      <span className={[
        'absolute top-0.5 left-0.5 w-4 h-4 bg-white transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0',
      ].join(' ')} />
    </button>
  )
}

// ── CopyButton ────────────────────────────────────────────────────────────────

export function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => { e.preventDefault(); navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className={`font-mono text-[10px] text-gray-700 hover:text-gray-400 transition-colors ${className}`}
    >
      {copied ? 'copied ✓' : 'copy'}
    </button>
  )
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] text-gray-700 uppercase tracking-widest mb-1">{children}</p>
  )
}
