"use client";

import { useState } from "react";
import { SAMPLE_FEED, type VerifyResult } from "@/lib/types";
import { verifyFeed } from "@/lib/verify-client";
import { CheckIcon, CrossIcon, ExternalLinkIcon, Pill, Spinner } from "./ui";

interface Payload {
  asset: string;
  fairValueUsd: number;
  confidence: number;
}

const GENUINE = SAMPLE_FEED.payload as Payload;
const POISONED: Payload = { ...GENUINE, fairValueUsd: 9_400_000 };

type PanelState = {
  result: VerifyResult | null;
  loading: boolean;
};

const fresh: PanelState = { result: null, loading: false };

export default function PoisonDemo() {
  const [genuine, setGenuine] = useState<PanelState>(fresh);
  const [poisoned, setPoisoned] = useState<PanelState>(fresh);
  const [poisonApplied, setPoisonApplied] = useState(false);
  const [ran, setRan] = useState(false);

  const verifyBoth = async (withPoison: boolean) => {
    setRan(true);
    setPoisonApplied(withPoison);
    setGenuine({ result: null, loading: true });
    setPoisoned({ result: null, loading: true });

    const genuineReq = verifyFeed({ feed: { ...SAMPLE_FEED, payload: GENUINE } })
      .then((r) => setGenuine({ result: r, loading: false }))
      .catch(() => setGenuine({ result: { hash: "", attested: false, error: "read failed" }, loading: false }));

    const poisonReq = verifyFeed({
      feed: { ...SAMPLE_FEED, payload: withPoison ? POISONED : GENUINE }
    })
      .then((r) => setPoisoned({ result: r, loading: false }))
      .catch(() => setPoisoned({ result: { hash: "", attested: false, error: "read failed" }, loading: false }));

    await Promise.all([genuineReq, poisonReq]);
  };

  const reset = () => {
    setGenuine(fresh);
    setPoisoned(fresh);
    setPoisonApplied(false);
    setRan(false);
  };

  const genuineLive = genuine.result?.attested ?? false;
  const anyAttested = genuineLive || (poisoned.result?.attested ?? false);
  const showHint = ran && !genuine.loading && !poisoned.loading && !anyAttested;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/40 p-6 sm:p-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent" />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Pill tone="neutral">live demo</Pill>
            <Pill tone="muted">verify-before-act</Pill>
          </div>
          <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
            Poison the feed. Watch the firewall block it.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-slate-400">
            The consumer contract releases funds only when the output hash clears the on-chain gate, in the same
            atomic Casper VM call. Tamper one number and its hash no longer clears the check — so the release
            reverts and the funds stay put.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => verifyBoth(true)}
            disabled={genuine.loading || poisoned.loading}
            className="group inline-flex items-center gap-2 rounded-xl bg-signal-red/90 px-4 py-2.5 text-sm font-semibold text-white shadow-redGlow transition hover:bg-signal-red disabled:opacity-70"
          >
            <PoisonGlyph />
            Poison the feed
          </button>
          {ran && (
            <button
              onClick={reset}
              className="rounded-xl border border-white/10 px-3.5 py-2.5 text-sm text-slate-400 transition hover:border-white/20 hover:text-slate-200"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FeedPanel
          title="Genuine feed"
          subtitle="Producer-attested output"
          payload={GENUINE}
          highlightField={false}
          state={genuine}
          ran={ran}
        />
        <FeedPanel
          title="Poisoned feed"
          subtitle="One value silently tampered"
          payload={poisonApplied ? POISONED : GENUINE}
          highlightField={poisonApplied}
          state={poisoned}
          ran={ran}
          poisoned
        />
      </div>

      {!ran && (
        <p className="mt-5 text-center text-xs text-slate-500">
          Hit <span className="text-slate-300">Poison the feed</span> to run both through the on-chain check
          side by side.
        </p>
      )}

      {showHint && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-signal-amber/25 bg-signal-amber/[0.06] px-4 py-3 text-sm text-signal-amber/90 animate-[float-up_0.4s_ease]">
          <InfoGlyph />
          <span>
            Both feeds read <strong>unattested</strong> because nothing is attested on this registry yet. Run{" "}
            <code className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[12px] text-slate-200">
              npm run producer
            </code>{" "}
            in <span className="text-slate-300">/agents</span> (with REGISTRY_CONTRACT_HASH set) to attest the
            genuine feed — then the left panel lights green and only the poisoned one blocks.
          </span>
        </div>
      )}
    </div>
  );
}

function FeedPanel({
  title,
  subtitle,
  payload,
  highlightField,
  state,
  ran,
  poisoned = false
}: {
  title: string;
  subtitle: string;
  payload: Payload;
  highlightField: boolean;
  state: PanelState;
  ran: boolean;
  poisoned?: boolean;
}) {
  const attested = state.result?.attested ?? false;
  const settled = ran && !state.loading && state.result;

  const frame = !settled
    ? "border-white/10"
    : attested
      ? "border-mint/40 shadow-glow"
      : "border-signal-red/40 shadow-redGlow";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-ink-950/50 transition-all duration-500 ${frame}`}
    >
      {state.loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-mint/10 to-transparent" />
      )}

      <div className="flex items-center justify-between border-b border-white/6 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${
              poisoned ? "bg-signal-red/70" : "bg-mint/70"
            } ${state.loading ? "animate-pulse" : ""}`}
          />
          <div>
            <div className="text-sm font-semibold text-slate-200">{title}</div>
            <div className="text-[11px] text-slate-500">{subtitle}</div>
          </div>
        </div>
        <StatusTag loading={state.loading} settled={Boolean(settled)} attested={attested} />
      </div>

      <div className="space-y-2.5 px-5 py-4 font-mono text-[12.5px]">
        <Row label="asset" value={payload.asset} />
        <Row label="fairValueUsd" value={usd(payload.fairValueUsd)} highlight={highlightField} />
        <Row label="confidence" value={payload.confidence.toFixed(2)} />
      </div>

      <div className="border-t border-white/6 px-5 py-3.5">
        <Outcome state={state} settled={Boolean(settled)} attested={attested} ran={ran} />
      </div>
    </div>
  );
}

function StatusTag({ loading, settled, attested }: { loading: boolean; settled: boolean; attested: boolean }) {
  if (loading) return <Pill tone="muted"><Spinner className="h-3 w-3" /> reading</Pill>;
  if (!settled) return <Pill tone="muted">idle</Pill>;
  return attested ? <Pill tone="good">attested</Pill> : <Pill tone="bad">no match</Pill>;
}

function Outcome({
  state,
  settled,
  attested,
  ran
}: {
  state: PanelState;
  settled: boolean;
  attested: boolean;
  ran: boolean;
}) {
  if (!ran) {
    return <div className="text-[12px] text-slate-600">awaiting verification…</div>;
  }
  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-slate-400">
        <Spinner className="h-3.5 w-3.5" /> querying Casper registry…
      </div>
    );
  }
  if (!settled) return null;

  return (
    <div className="flex items-center justify-between gap-3 animate-[flip-in_0.4s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-7 w-7 place-items-center rounded-lg ${
            attested ? "bg-mint/15 text-mint" : "bg-signal-red/15 text-signal-red"
          }`}
        >
          {attested ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
        </span>
        <span className={`text-sm font-bold tracking-tight ${attested ? "text-mint-soft" : "text-signal-red"}`}>
          {attested ? "PAY released" : "BLOCKED"}
        </span>
      </div>
      {attested && state.result?.explorer ? (
        <a
          href={state.result.explorer}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-mint-soft/80 transition hover:text-mint-soft"
        >
          proof <ExternalLinkIcon className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-[11px] text-slate-500">{attested ? "" : "hash not attested"}</span>
      )}
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span
        className={`tabular-nums transition-colors ${
          highlight
            ? "rounded bg-signal-red/15 px-1.5 py-0.5 font-semibold text-signal-red"
            : "text-slate-300"
        }`}
      >
        {value}
        {highlight && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-signal-red/70">tampered</span>}
      </span>
    </div>
  );
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function PoisonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M12 3c1.5 3 4 4 4 7a4 4 0 1 1-8 0c0-3 2.5-4 4-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10.3" cy="11" r="0.9" fill="currentColor" />
      <circle cx="13.7" cy="11" r="0.9" fill="currentColor" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
