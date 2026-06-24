"use client";

import { useState } from "react";
import { GENUINE_PAYLOAD, RWA_PROMPT, type QuorumInfo, type RwaPayload, type VerifyResult } from "@/lib/types";
import { verifyFeed } from "@/lib/verify-client";
import { liveQuorumConfigured, publicConfig } from "@/lib/config";
import { CheckIcon, CrossIcon, ExternalLinkIcon, HashChip, Pill, Spinner } from "./ui";

const POISONED_PAYLOAD: RwaPayload = { ...GENUINE_PAYLOAD, fairValueUsd: GENUINE_PAYLOAD.fairValueUsd + 1 };

const ILLUSTRATIVE_THRESHOLD = 2;
const ILLUSTRATIVE_AGREEMENT = 3;

type Lane = { result: VerifyResult | null; loading: boolean };
const idle: Lane = { result: null, loading: false };

export default function QuorumContrast() {
  const [genuine, setGenuine] = useState<Lane>(idle);
  const [poisoned, setPoisoned] = useState<Lane>(idle);
  const [ran, setRan] = useState(false);

  const run = async () => {
    setRan(true);
    setGenuine({ result: null, loading: true });
    setPoisoned({ result: null, loading: true });

    const reqId = publicConfig.requestId || undefined;
    const g = verifyFeed({ feed: { modelId: "claude-opus-4-8", prompt: RWA_PROMPT, payload: GENUINE_PAYLOAD }, requestId: reqId })
      .then((r) => setGenuine({ result: r, loading: false }))
      .catch((e) => setGenuine({ result: { hash: "", attested: false, error: msg(e) }, loading: false }));
    const p = verifyFeed({ feed: { modelId: "compromised-agent", prompt: RWA_PROMPT, payload: POISONED_PAYLOAD }, requestId: reqId })
      .then((r) => setPoisoned({ result: r, loading: false }))
      .catch((e) => setPoisoned({ result: { hash: "", attested: false, error: msg(e) }, loading: false }));

    await Promise.all([g, p]);
  };

  const reset = () => {
    setGenuine(idle);
    setPoisoned(idle);
    setRan(false);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/60 p-6 backdrop-blur-sm sm:p-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent" />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone="neutral">action firewall · Casper VM</Pill>
            <Pill tone={liveQuorumConfigured ? "good" : "muted"}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${liveQuorumConfigured ? "bg-mint" : "bg-signal-amber"}`}
                aria-hidden
              />
              {liveQuorumConfigured ? "live chain state" : "illustrative mode"}
            </Pill>
          </div>
          <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            The firewall blocking a poisoned output in the Casper VM.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-slate-300">
            PayoutVault.release composes the registry&apos;s require_quorum guard, so the verify decision and the
            payout settle in one atomic Casper VM call — an off-chain agent cannot skip the check. The attestation
            policy here is quorum: k independent signers attest the same deterministic valuation. Change one byte
            and that output has no quorum, so require_quorum reverts and the release with it.
          </p>
          <p className="mt-2 max-w-xl text-pretty text-[12px] leading-relaxed text-slate-400">
            Quorum is one pluggable policy behind the gate — TEE remote-attestation receipts and zkML proofs are on
            the roadmap. Today the trusted signer set is owner-curated and slashing gives it skin in the game;
            proof-of-computation receipts come next.
          </p>
          {publicConfig.requestId && (
            <p className="mt-2 font-mono text-[11px] text-slate-500">
              request <span className="text-slate-400">{publicConfig.requestId}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={run}
            disabled={genuine.loading || poisoned.loading}
            aria-busy={genuine.loading || poisoned.loading}
            aria-label="Run both outputs through the on-chain quorum gate"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-mint px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-12px_rgba(52,211,153,0.6)] transition-all hover:bg-mint-soft focus-visible:outline-offset-4 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
            {genuine.loading || poisoned.loading ? <Spinner className="h-4 w-4" /> : <ScaleGlyph />}
            {genuine.loading || poisoned.loading ? "Reading chain…" : "Run the gate"}
          </button>
          {ran && (
            <button
              onClick={reset}
              className="rounded-xl border border-white/10 px-3.5 py-2.5 text-sm text-slate-300 transition hover:border-white/20 hover:text-slate-100 active:scale-[0.98]"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2" role="group" aria-live="polite" aria-label="Quorum gate outcomes">
        <QuorumLane
          title="Genuine valuation"
          subtitle="Quorum-attested output"
          payload={GENUINE_PAYLOAD}
          lane={genuine}
          ran={ran}
          verdict="pay"
          txUrl={publicConfig.payTxUrl}
          txLabel="payout tx"
        />
        <QuorumLane
          title="Poisoned valuation"
          subtitle="One byte changed by a compromised agent"
          payload={POISONED_PAYLOAD}
          lane={poisoned}
          ran={ran}
          verdict="block"
          poisoned
          txUrl={publicConfig.blockedTxUrl}
          txLabel="reverted tx"
        />
      </div>

      {!ran && (
        <p className="mt-5 text-center text-xs text-slate-500">
          Hit <span className="text-slate-300">Run the gate</span> to push both outputs through require_quorum side
          by side.
        </p>
      )}

      <FooterLinks ran={ran} genuine={genuine} poisoned={poisoned} />
    </div>
  );
}

function QuorumLane({
  title,
  subtitle,
  payload,
  lane,
  ran,
  verdict,
  poisoned = false,
  txUrl,
  txLabel
}: {
  title: string;
  subtitle: string;
  payload: RwaPayload;
  lane: Lane;
  ran: boolean;
  verdict: "pay" | "block";
  poisoned?: boolean;
  txUrl?: string;
  txLabel: string;
}) {
  const q = quorumView(lane.result, verdict);
  const settled = ran && !lane.loading && Boolean(lane.result);
  const pays = settled && q.pays;

  const frame = !settled
    ? "border-white/10"
    : pays
      ? "border-mint/40 shadow-glow"
      : "border-signal-red/40 shadow-redGlow";

  const flourish = settled ? (pays ? "verdict-glow" : "verdict-shake") : "";

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-ink-950/70 backdrop-blur-sm transition-all duration-500 ${frame} ${flourish}`}>
      {lane.loading && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-mint/10 to-transparent" />
          <div className={`scanline ${poisoned ? "scanline-red" : ""}`} aria-hidden />
        </>
      )}

      <div className="flex items-center justify-between border-b border-white/6 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${poisoned ? "bg-signal-red/70" : "bg-mint/70"} ${lane.loading ? "animate-pulse" : ""}`} />
          <div>
            <div className="text-sm font-semibold text-slate-200">{title}</div>
            <div className="text-[11px] text-slate-400">{subtitle}</div>
          </div>
        </div>
        {settled ? (
          <Pill tone={pays ? "good" : "bad"}>{q.threshold > 0 ? `${q.agreement} / ${q.threshold} agree` : `${q.agreement} agree`}</Pill>
        ) : lane.loading ? (
          <Pill tone="muted"><Spinner className="h-3 w-3" /> reading</Pill>
        ) : (
          <Pill tone="muted">idle</Pill>
        )}
      </div>

      <div className="space-y-2.5 px-5 py-4 font-mono text-[12.5px]">
        <Row label="asset" value={payload.asset} />
        <Row label="fairValueUsd" value={usd(payload.fairValueUsd)} highlight={poisoned} />
        <Row label="confidence" value={payload.confidence.toFixed(2)} />
      </div>

      {settled && lane.result?.hash && (
        <div className="px-5 pb-3">
          <HashChip hash={lane.result.hash} label={poisoned ? "tampered hash" : "output hash"} />
        </div>
      )}

      <div className="border-t border-white/6 px-5 py-3.5">
        <LaneOutcome lane={lane} ran={ran} q={q} settled={settled} txUrl={txUrl} txLabel={txLabel} />
      </div>
    </div>
  );
}

function LaneOutcome({
  lane,
  ran,
  q,
  settled,
  txUrl,
  txLabel
}: {
  lane: Lane;
  ran: boolean;
  q: QuorumView;
  settled: boolean;
  txUrl?: string;
  txLabel: string;
}) {
  if (!ran) return <div className="text-[12px] text-slate-500">awaiting quorum read…</div>;
  if (lane.loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-slate-400">
        <Spinner className="h-3.5 w-3.5" /> tallying signers on Casper…
      </div>
    );
  }
  if (!settled) return null;

  return (
    <div className="flex items-center justify-between gap-3 animate-[flip-in_0.4s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex items-center gap-2.5">
        <span className={`verdict-pop grid h-7 w-7 place-items-center rounded-lg ${q.pays ? "bg-mint/15 text-mint" : "bg-signal-red/15 text-signal-red"}`}>
          {q.pays ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
        </span>
        <div className="leading-tight">
          <div className={`text-sm font-bold tracking-tight ${q.pays ? "text-mint-soft" : "text-signal-red"}`}>
            {q.pays ? "QUORUM → PAY" : "NO QUORUM → BLOCK"}
          </div>
          <div className="text-[11px] text-slate-400">{q.reason}</div>
        </div>
      </div>
      {q.pays && txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-mint-soft/80 transition hover:text-mint-soft"
        >
          {txLabel} <ExternalLinkIcon className="h-3 w-3" />
        </a>
      ) : !q.pays && txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-signal-red/80 transition hover:text-signal-red"
        >
          {txLabel} <ExternalLinkIcon className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function FooterLinks({ ran, genuine, poisoned }: { ran: boolean; genuine: Lane; poisoned: Lane }) {
  const settled = ran && !genuine.loading && !poisoned.loading;
  const winner = genuine.result?.quorum?.winningHash ?? poisoned.result?.quorum?.winningHash ?? null;

  if (!liveQuorumConfigured) {
    return (
      <div
        role="note"
        className="mt-5 rounded-xl border border-signal-amber/25 bg-signal-amber/[0.06] px-4 py-3.5 text-sm"
      >
        <div className="flex items-center gap-2.5 font-semibold text-signal-amber">
          <InfoGlyph />
          Illustrative mode — this is how the gate behaves once a contract is live
        </div>
        <p className="mt-2 pl-[26px] text-[13px] leading-relaxed text-slate-300">
          The two outcomes below are the real decision logic running against sample data. No transaction hashes are
          shown until a registry is deployed.
        </p>
        <p className="mt-2 pl-[26px] text-[12px] leading-relaxed text-slate-400">
          To read genuine quorum state, set{" "}
          <code className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-200">NEXT_PUBLIC_REGISTRY_CONTRACT_HASH</code>{" "}
          and{" "}
          <code className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-200">NEXT_PUBLIC_REQUEST_ID</code>{" "}
          (plus the server{" "}
          <code className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-200">REGISTRY_CONTRACT_HASH</code>{" "}
          /{" "}
          <code className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-200">REQUEST_ID</code>){" "}
          after deploying.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/6 pt-4 text-[12px] text-slate-500">
      {settled && winner && (
        <span className="font-mono">
          quorum hash <span className="text-mint-soft/80">{winner.slice(0, 16)}…{winner.slice(-6)}</span>
        </span>
      )}
      {publicConfig.registryUrl && (
        <a href={publicConfig.registryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-mint-soft">
          registry contract <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
      {publicConfig.vaultConfigured && publicConfig.vaultUrl && (
        <a href={publicConfig.vaultUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-mint-soft">
          payout vault <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
      {publicConfig.attestTxUrl && (
        <a href={publicConfig.attestTxUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-mint-soft">
          attestation tx <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

interface QuorumView {
  pays: boolean;
  agreement: number;
  threshold: number;
  reason: string;
}

function quorumView(result: VerifyResult | null, verdict: "pay" | "block"): QuorumView {
  if (!liveQuorumConfigured || !result || result.error || !result.quorum) {
    return illustrative(verdict, result);
  }
  const q = result.quorum;
  const pays = q.reached && q.matchesWinner;
  return {
    pays,
    agreement: q.agreement,
    threshold: q.threshold,
    reason: pays
      ? "matches the quorum output — vault authorizes the payout"
      : q.reached
        ? "hash differs from the quorum output — release reverts (NoQuorum)"
        : "no output has reached quorum for this request yet"
  };
}

function illustrative(verdict: "pay" | "block", result: VerifyResult | null): QuorumView {
  const note = result?.error
    ? `chain read note: ${result.error}`
    : result?.note?.includes("not configured")
      ? "registry not configured — illustrative outcome"
      : "illustrative outcome";
  if (verdict === "pay") {
    return { pays: true, agreement: ILLUSTRATIVE_AGREEMENT, threshold: ILLUSTRATIVE_THRESHOLD, reason: note };
  }
  return { pays: false, agreement: 1, threshold: ILLUSTRATIVE_THRESHOLD, reason: note };
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span
        className={`min-w-0 truncate text-right tabular-nums transition-colors ${
          highlight ? "rounded bg-signal-red/15 px-1.5 py-0.5 font-semibold text-signal-red" : "text-slate-300"
        }`}
      >
        {value}
        {highlight && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-signal-red/80">tampered</span>}
      </span>
    </div>
  );
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "read failed";
}

function ScaleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M12 3v18M5 7h14M5 7 3 13a3 3 0 0 0 6 0L7 7M19 7l-2 6a3 3 0 0 0 6 0l-2-6M7 21h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
