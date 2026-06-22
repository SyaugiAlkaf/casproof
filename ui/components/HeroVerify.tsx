"use client";

import { useState } from "react";
import { SAMPLE_FEED, type FeedInput, type VerifyResult } from "@/lib/types";
import { verifyFeed } from "@/lib/verify-client";
import { CheckIcon, CrossIcon, ExternalLinkIcon, HashChip, Pill, Spinner } from "./ui";

const SAMPLE_TEXT = JSON.stringify(SAMPLE_FEED);

type Phase = "idle" | "loading" | "done" | "error";

export default function HeroVerify() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [message, setMessage] = useState<string>("");

  const run = async () => {
    setPhase("loading");
    setResult(null);
    setMessage("");
    let feed: FeedInput;
    try {
      const parsed = JSON.parse(text) as Partial<FeedInput>;
      if (!parsed.payload) throw new Error("feed needs a `payload` field");
      feed = {
        modelId: String(parsed.modelId ?? ""),
        prompt: String(parsed.prompt ?? ""),
        payload: parsed.payload
      };
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "invalid JSON");
      return;
    }
    try {
      const res = await verifyFeed({ feed });
      setResult(res);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "verification failed");
    }
  };

  const reset = () => {
    setText(SAMPLE_TEXT);
    setPhase("idle");
    setResult(null);
    setMessage("");
  };

  const attested = phase === "done" && result?.attested;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-ink-850/90 to-ink-900/90 p-1 shadow-card backdrop-blur">
      <div className="rounded-[1.4rem] bg-ink-900/40 p-6 sm:p-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-mint-soft">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path d="M4 7h16M4 12h10M4 17h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Verify an agent output</h2>
              <p className="text-xs text-slate-400">Paste a feed — we hash it and check the on-chain registry.</p>
            </div>
          </div>
          <Pill tone="muted">casper-test</Pill>
        </div>

        <div className="relative">
          <textarea
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-950/70 p-4 font-mono text-[13px] leading-relaxed text-slate-200 outline-none transition focus:border-mint/40 focus:ring-2 focus:ring-mint/10"
            aria-label="RWA feed JSON"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={phase === "loading"}
            aria-busy={phase === "loading"}
            aria-label="Verify this feed against the on-chain registry"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-mint px-5 py-3 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-12px_rgba(52,211,153,0.6)] transition-all hover:bg-mint-soft hover:shadow-[0_10px_30px_-10px_rgba(52,211,153,0.7)] focus-visible:outline-offset-4 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
            {phase === "loading" ? <Spinner className="h-4 w-4" /> : <ShieldGlyph />}
            {phase === "loading" ? "Verifying on-chain…" : "Verify on-chain"}
          </button>
          <button
            onClick={reset}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition hover:border-white/20 hover:text-slate-100 active:scale-[0.98]"
          >
            Reset sample
          </button>
        </div>

        {result?.hash && (
          <div className="mt-5 animate-[float-up_0.4s_ease]">
            <HashChip hash={result.hash} />
          </div>
        )}

        {phase === "error" && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-3 rounded-xl border border-signal-red/25 bg-signal-red/[0.06] px-4 py-3 text-sm text-signal-red"
          >
            <CrossIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {phase === "done" && result && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-5 animate-[flip-in_0.45s_cubic-bezier(0.16,1,0.3,1)] overflow-hidden rounded-2xl border ${
              attested ? "border-mint/30 bg-mint/[0.05]" : "border-signal-red/30 bg-signal-red/[0.05]"
            }`}
          >
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                    attested ? "bg-mint/15 text-mint" : "bg-signal-red/15 text-signal-red"
                  }`}
                  style={{ animation: `${attested ? "pulse-ring" : "pulse-ring-red"} 1.8s ease-out 1` }}
                >
                  {attested ? <CheckIcon className="h-6 w-6" /> : <CrossIcon className="h-6 w-6" />}
                </span>
                <div>
                  <div className={`text-lg font-bold tracking-tight ${attested ? "text-mint-soft" : "text-signal-red"}`}>
                    {attested ? "✓ ATTESTED" : "✗ UNATTESTED — payout blocked"}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {attested
                      ? "This output is signed into the on-chain registry. A consumer agent would release the payout."
                      : result.note
                        ? registryNote(result.note)
                        : result.error
                          ? `Chain read note: ${result.error}`
                          : "No attestation found for this hash. A consumer agent would refuse to act."}
                  </div>
                </div>
              </div>

              {attested && (
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  {result.quorum && result.quorum.threshold > 0 && (
                    <Pill tone={result.quorum.reached && result.quorum.matchesWinner ? "good" : "neutral"}>
                      {result.quorum.agreement} / {result.quorum.threshold} models agree
                    </Pill>
                  )}
                  {result.signer && (
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">signer</div>
                      <code className="font-mono text-[12px] text-slate-300">{truncate(result.signer)}</code>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {typeof result.trusted === "boolean" && (
                      <Pill tone={result.trusted ? "good" : "neutral"}>
                        {result.trusted ? "trusted signer" : "untrusted"}
                      </Pill>
                    )}
                    {result.explorer && (
                      <a
                        href={result.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-mint/30 bg-mint/10 px-3 py-1.5 text-xs font-medium text-mint-soft transition hover:bg-mint/20"
                      >
                        View attestation
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function registryNote(note: string): string {
  if (note.includes("not configured")) {
    return "Registry contract not configured yet — set REGISTRY_CONTRACT_HASH after deploying to light this up.";
  }
  return note;
}

function truncate(s: string): string {
  return s.length > 22 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s;
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M12 3l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6l7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
