"use client";

import { useEffect, useRef, useState } from "react";
import AsciiShield from "./AsciiShield";

const WORDMARK_RAW = [
  " ██████╗ █████╗ ███████╗██████╗ ██████╗  ██████╗  ██████╗ ███████╗",
  "██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔═══██╗██╔════╝",
  "██║     ███████║███████╗██████╔╝██████╔╝██║   ██║██║   ██║█████╗  ",
  "██║     ██╔══██║╚════██║██╔═══╝ ██╔══██╗██║   ██║██║   ██║██╔══╝  ",
  "╚██████╗██║  ██║███████║██║     ██║  ██║╚██████╔╝╚██████╔╝██║     ",
  " ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     "
];

const COLS = Math.max(...WORDMARK_RAW.map((l) => [...l].length));
const WORDMARK = WORDMARK_RAW.map((l) => {
  const cells = [...l];
  while (cells.length < COLS) cells.push(" ");
  return cells;
});

const GLYPH_POOL = "█▓▒░╔╗╚╝║═╠╣╦╩╬01x#$%&";
const SETTLE_MS = 1000;

function randGlyph() {
  return GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
}

export default function AsciiHero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative -mx-5 -mt-14 mb-16 flex min-h-[calc(100svh-4rem)] items-center justify-center overflow-hidden sm:-mx-8 sm:-mt-20"
    >
      <ShieldBackground />
      <LegibilityScrim />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 py-24 text-center sm:px-8">
        <Wordmark />
        <Tagline />
        <TrustChips />
        <CtaRow />
      </div>
      <ScrollCue />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />
    </section>
  );
}

function ScrollCue() {
  return (
    <a
      href="#what"
      aria-label="Scroll to learn what Casproof is"
      className="absolute inset-x-0 bottom-5 z-20 mx-auto flex w-fit flex-col items-center gap-1.5 text-slate-400 transition hover:text-mint-soft focus-visible:text-mint-soft"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">scroll</span>
      <span className="scroll-hint" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
}

function ShieldBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div className="absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint/[0.10] blur-[140px] sm:h-[820px] sm:w-[820px]" />
      <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint-soft/[0.10] blur-[80px]" />
      <AsciiShield />
      <CrtOverlay />
    </div>
  );
}

function LegibilityScrim() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 42%, rgba(5,6,10,0.74) 0%, rgba(5,6,10,0.32) 38%, rgba(5,6,10,0.62) 100%)"
      }}
    />
  );
}

function CrtOverlay() {
  return (
    <div
      className="absolute inset-0 z-[1] opacity-[0.4] mix-blend-soft-light"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(94,234,212,0.05) 0px, rgba(94,234,212,0.05) 1px, transparent 1px, transparent 3px)"
      }}
    />
  );
}

function Wordmark() {
  const [reduce, setReduce] = useState(false);
  const [cells, setCells] = useState<string[][]>(() => WORDMARK.map((row) => [...row]));
  const [sweeping, setSweeping] = useState(false);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setReduce(true);
      setCells(WORDMARK.map((row) => [...row]));
      return;
    }

    const start = performance.now();
    const settleAt = new Float64Array(WORDMARK.length * COLS);
    for (let r = 0; r < WORDMARK.length; r++) {
      for (let c = 0; c < COLS; c++) {
        settleAt[r * COLS + c] = WORDMARK[r][c] === " " ? 0 : 0.18 + Math.random() * 0.82;
      }
    }

    setSweeping(true);
    const sweepTimer = window.setTimeout(() => setSweeping(false), SETTLE_MS + 220);

    const tick = (now: number) => {
      const progress = (now - start) / SETTLE_MS;
      let done = true;
      const next = WORDMARK.map((row, r) =>
        row.map((finalCh, c) => {
          if (finalCh === " ") return " ";
          if (progress >= settleAt[r * COLS + c]) return finalCh;
          done = false;
          return randGlyph();
        })
      );
      setCells(next);
      if (!done) frameRef.current = requestAnimationFrame(tick);
      else setCells(WORDMARK.map((row) => [...row]));
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(sweepTimer);
    };
  }, []);

  return (
    <div className="relative z-10 inline-block overflow-hidden">
      <h1 id="hero-title" className="sr-only">
        Casproof — the unskippable on-chain action firewall for AI agents
      </h1>
      <pre
        aria-hidden="true"
        className="ascii-wordmark m-0 inline-block whitespace-pre bg-gradient-to-br from-mint-soft via-mint to-mint-deep bg-clip-text text-center font-mono font-bold leading-[1.04] text-transparent"
        style={{ fontSize: "clamp(4px, 2.1vw, 14px)" }}
      >
        {cells.map((row, r) => (
          <span key={r} className="block">
            {row.join("")}
          </span>
        ))}
      </pre>
      {sweeping && !reduce && <span aria-hidden className="ascii-sweep" />}
    </div>
  );
}

function Tagline() {
  return (
    <p className="mt-6 max-w-2xl font-mono text-[13px] leading-relaxed text-slate-200 [text-shadow:0_2px_18px_rgba(5,6,10,0.9)] sm:text-sm">
      <span className="text-mint-soft">$</span> the unskippable on-chain action firewall{" "}
      <span className="text-slate-500">·</span> verify-before-act, enforced in the{" "}
      <span className="font-medium text-slate-50">Casper VM</span>
      <span
        aria-hidden
        className="ascii-cursor ml-1.5 inline-block h-[1.05em] w-[0.6ch] translate-y-[0.18em] bg-mint align-baseline"
      />
    </p>
  );
}

function TrustChips() {
  return (
    <ul className="mt-7 flex flex-wrap items-center justify-center gap-2.5" aria-label="What makes Casproof different">
      <TrustChip>One atomic VM call</TrustChip>
      <TrustChip>x402-metered verify</TrustChip>
      <TrustChip>Pluggable attestation policy</TrustChip>
      <TrustChip>RWA / DeFi payouts</TrustChip>
    </ul>
  );
}

function TrustChip({ children }: { children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-950/55 px-3 py-1.5 text-[12.5px] text-slate-200 backdrop-blur-sm">
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-mint-soft" aria-hidden>
        <path d="m5 12.5 4.2 4.3L19 7.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </li>
  );
}

function CtaRow() {
  return (
    <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
      <a
        href="#verify"
        className="inline-flex items-center gap-2 rounded-xl bg-mint px-5 py-3 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-mint-soft"
      >
        Verify an agent output
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
        </span>
        genuine → PAY · poisoned → REVERT
      </span>
    </div>
  );
}
