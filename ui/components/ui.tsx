"use client";

import { useState } from "react";

export function HashChip({ hash, label = "output hash" }: { hash: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — non-critical */
    }
  };
  return (
    <button
      onClick={copy}
      title="Copy hash"
      className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-ink-950/60 px-3.5 py-2.5 text-left transition hover:border-white/16"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-300">{hash}</code>
      <span className="shrink-0 text-[11px] font-medium text-slate-500 transition group-hover:text-mint-soft">
        {copied ? "copied ✓" : "copy"}
      </span>
    </button>
  );
}

type Tone = "neutral" | "good" | "bad" | "muted";

const toneRing: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.03] text-slate-300",
  good: "border-mint/35 bg-mint/[0.08] text-mint-soft",
  bad: "border-signal-red/35 bg-signal-red/[0.08] text-signal-red",
  muted: "border-white/8 bg-white/[0.02] text-slate-500"
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${toneRing[tone]}`}
    >
      {children}
    </span>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="m5 12.5 4.2 4.3L19 7.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ExternalLinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
