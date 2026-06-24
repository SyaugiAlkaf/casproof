"use client";

import { useEffect, useRef, useState } from "react";
import FirewallHero from "./FirewallHero";

const WORDMARK_RAW = [
  " ██████╗ █████╗ ███████╗██████╗ ██████╗  ██████╗  ██████╗ ███████╗",
  "██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔═══██╗██╔════╝",
  "██║     ███████║███████╗██████╔╝██████╔╝██║   ██║██║   ██║█████╗",
  "██║     ██╔══██║╚════██║██╔═══╝ ██╔══██╗██║   ██║██║   ██║██╔══╝",
  "╚██████╗██║  ██║███████║██║     ██║  ██║╚██████╔╝╚██████╔╝███████╗",
  " ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚══════╝"
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
    <section aria-labelledby="hero-title" className="mb-14">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-ink-850/85 to-ink-900/90 shadow-card backdrop-blur sm:rounded-3xl">
        <TitleBar />
        <div className="relative px-4 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
          <CrtOverlay />
          <Wordmark />
          <Tagline />
          <FirewallFrame />
        </div>
      </div>
    </section>
  );
}

function TitleBar() {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.015] px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-1.5" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-signal-red/80 ring-1 ring-inset ring-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-signal-amber/80 ring-1 ring-inset ring-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-mint/80 ring-1 ring-inset ring-white/10" />
      </div>
      <span className="select-none truncate font-mono text-[11px] tracking-tight text-slate-500 sm:text-xs">
        ~/casproof — verify-before-act
      </span>
    </div>
  );
}

function CrtOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-[0.5] mix-blend-soft-light"
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
    <div className="relative z-10 overflow-hidden">
      <h1 id="hero-title" className="sr-only">
        Casproof — the unskippable on-chain action firewall for AI agents
      </h1>
      <pre
        aria-hidden="true"
        className="ascii-wordmark m-0 inline-block whitespace-pre bg-gradient-to-br from-mint-soft via-mint to-mint-deep bg-clip-text font-mono font-bold leading-[1.04] text-transparent"
        style={{ fontSize: "clamp(4.2px, 1.78vw, 13.5px)" }}
      >
        {cells.map((row, r) => (
          <span key={r} className="block">
            {row.join("")}
          </span>
        ))}
      </pre>
      {sweeping && !reduce && (
        <span aria-hidden className="ascii-sweep" />
      )}
    </div>
  );
}

function Tagline() {
  return (
    <p className="mt-5 max-w-2xl font-mono text-[13px] leading-relaxed text-slate-300 sm:text-sm">
      <span className="text-mint-soft">$</span> the unskippable on-chain action firewall{" "}
      <span className="text-slate-500">·</span> verify-before-act, enforced in the{" "}
      <span className="font-medium text-slate-100">Casper VM</span>
      <span aria-hidden className="ascii-cursor ml-1.5 inline-block h-[1.05em] w-[0.6ch] translate-y-[0.18em] bg-mint align-baseline" />
    </p>
  );
}

function FirewallFrame() {
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/50">
      <div className="relative h-[180px] w-full sm:h-[220px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_60%_50%,rgba(45,212,191,0.08)_0%,transparent_60%)]" />
        <FirewallHero />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ink-950/80 to-transparent" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-2 sm:px-5">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
          </span>
          verify-before-act, live
        </span>
        <span className="font-mono text-[10px] text-slate-600">genuine → PAY · poisoned → REVERT</span>
      </div>
    </div>
  );
}
