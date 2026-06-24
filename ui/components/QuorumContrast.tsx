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
    <div
      className="relative overflow-hidden rounded-3xl p-6 backdrop-blur-sm sm:p-8"
      style={{ background: "var(--cp-surface)", border: "1px solid var(--cp-border)" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--cp-teal)] to-transparent opacity-40" />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone="neutral">action firewall · Casper VM</Pill>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide"
              style={{
                border: "1px solid var(--cp-border-2)",
                color: liveQuorumConfigured ? "var(--cp-teal)" : "var(--cp-text-2)",
                background: liveQuorumConfigured ? "rgba(62,207,178,0.08)" : "rgba(255,255,255,0.02)"
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: liveQuorumConfigured ? "var(--cp-teal)" : "var(--cp-text-3)" }}
                aria-hidden
              />
              {liveQuorumConfigured ? "live chain state" : "illustrative mode"}
            </span>
          </div>
          <h2 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: "var(--cp-text)" }}>
            The firewall blocking a poisoned output in the Casper VM.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm" style={{ color: "var(--cp-text-2)" }}>
            PayoutVault.release composes the registry&apos;s require_quorum guard, so the verify decision and the
            payout settle in one atomic Casper VM call — an off-chain agent cannot skip the check. The attestation
            policy here is quorum: k independent signers attest the same deterministic valuation. Change one byte
            and that output has no quorum, so require_quorum reverts and the release with it.
          </p>
          <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
            Other systems verify then act in two separate calls — the gap is the attack surface. Casproof collapses
            verify and act into one VM execution.
          </p>
          <p className="mt-2 max-w-xl text-pretty text-[12px] leading-relaxed" style={{ color: "var(--cp-text-3)" }}>
            Quorum is one pluggable policy behind the gate — TEE remote-attestation receipts and zkML proofs are on
            the roadmap. Today the trusted signer set is owner-curated and slashing gives it skin in the game;
            proof-of-computation receipts come next.
          </p>
          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
            style={{ border: "1px solid var(--cp-border-2)", background: "rgba(62,207,178,0.06)", color: "var(--cp-text-2)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--cp-teal)" }} aria-hidden />
            Signer reputation and slashing are enforced on-chain — every payout emits the attesting signer.
          </div>
          <p className="mt-3 max-w-xl text-pretty text-[13px] leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
            Honest disclaimer: the signer set here is <strong style={{ color: "var(--cp-text)" }}>owner-curated</strong>,
            not trustless. The gate enforces quorum and slashing over that set — it does not yet remove the need to
            trust who is in it.
          </p>
          {publicConfig.requestId && (
            <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--cp-text-3)" }}>
              request <span style={{ color: "var(--cp-text-2)" }}>{publicConfig.requestId}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={run}
            disabled={genuine.loading || poisoned.loading}
            aria-busy={genuine.loading || poisoned.loading}
            aria-label="Run both outputs through the on-chain quorum gate"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold shadow-[0_8px_24px_-12px_rgba(62,207,178,0.6)] transition-all focus-visible:outline-offset-4 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
            style={{ background: "var(--cp-teal)", color: "#0A0A0A" }}
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
              className="rounded-xl px-3.5 py-2.5 text-sm transition active:scale-[0.98]"
              style={{ border: "1px solid var(--cp-border-2)", color: "var(--cp-text-2)" }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2" role="group" aria-live="polite" aria-label="Quorum gate outcomes">
        <QuorumLane
          title="Genuine valuation"
          subtitle="RWA valuation · quorum-attested"
          payload={GENUINE_PAYLOAD}
          lane={genuine}
          ran={ran}
          verdict="pay"
          txUrl={publicConfig.payTxUrl}
          txLabel="payout tx"
        />
        <QuorumLane
          title="Poisoned valuation"
          subtitle="RWA valuation · one byte tampered by a compromised agent"
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
        <p className="mt-5 text-center text-xs" style={{ color: "var(--cp-text-3)" }}>
          Hit <span style={{ color: "var(--cp-text-2)" }}>Run the gate</span> to push both outputs through
          require_quorum side by side.
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
  const neutral = settled && Boolean(q.neutral);
  const pays = settled && !neutral && q.pays;

  const frameStyle: React.CSSProperties = !settled || neutral
    ? { border: "1px solid var(--cp-border)" }
    : pays
      ? { border: "1px solid rgba(62,207,178,0.4)", boxShadow: "0 0 0 1px rgba(62,207,178,0.12), 0 24px 80px -32px rgba(62,207,178,0.35)" }
      : { border: "1px solid rgba(238,68,68,0.4)", boxShadow: "0 0 0 1px rgba(238,68,68,0.18), 0 24px 80px -32px rgba(238,68,68,0.4)" };

  const flourish = settled && !neutral ? (pays ? "verdict-glow" : "verdict-shake") : "";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl backdrop-blur-sm transition-all duration-500 ${flourish}`}
      style={{ background: "#0B0B0B", ...frameStyle }}
    >
      {lane.loading && (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-12"
            style={{ background: `linear-gradient(to bottom, ${poisoned ? "rgba(238,68,68,0.10)" : "rgba(62,207,178,0.10)"}, transparent)` }}
          />
          <div className={`scanline ${poisoned ? "scanline-red" : ""}`} aria-hidden />
        </>
      )}

      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--cp-border)" }}>
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${lane.loading ? "animate-pulse" : ""}`}
            style={{ background: poisoned ? "rgba(238,68,68,0.7)" : "rgba(62,207,178,0.7)" }}
          />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--cp-text)" }}>{title}</div>
            <div className="font-mono text-[11px]" style={{ color: "var(--cp-text-3)" }}>{subtitle}</div>
          </div>
        </div>
        {settled ? (
          neutral ? (
            <Pill tone="muted">chain unread</Pill>
          ) : (
            <Pill tone={pays ? "good" : "bad"}>{q.threshold > 0 ? `${q.agreement} / ${q.threshold} agree` : `${q.agreement} agree`}</Pill>
          )
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

      <div className="px-5 py-3.5" style={{ borderTop: "1px solid var(--cp-border)" }}>
        <LaneOutcome lane={lane} ran={ran} q={q} settled={settled} neutral={neutral} txUrl={txUrl} txLabel={txLabel} />
      </div>
    </div>
  );
}

function LaneOutcome({
  lane,
  ran,
  q,
  settled,
  neutral,
  txUrl,
  txLabel
}: {
  lane: Lane;
  ran: boolean;
  q: QuorumView;
  settled: boolean;
  neutral: boolean;
  txUrl?: string;
  txLabel: string;
}) {
  if (!ran) return <div className="text-[12px]" style={{ color: "var(--cp-text-3)" }}>awaiting quorum read…</div>;
  if (lane.loading) {
    return (
      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cp-text-2)" }}>
        <Spinner className="h-3.5 w-3.5" /> tallying signers on Casper…
      </div>
    );
  }
  if (!settled) return null;

  if (neutral) {
    return (
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-7 w-7 place-items-center rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", color: "var(--cp-text-3)" }}
        >
          <WarnGlyph />
        </span>
        <div className="leading-tight">
          <div className="font-mono text-sm font-bold tracking-tight" style={{ color: "var(--cp-text-2)" }}>
            CHAIN READ FAILED
          </div>
          <div className="text-[11px]" style={{ color: "var(--cp-text-3)" }}>{q.reason}</div>
        </div>
      </div>
    );
  }

  const accent = q.pays ? "var(--cp-teal)" : "#EE4444";
  const accentSoft = q.pays ? "var(--cp-teal)" : "#EE6A6A";

  return (
    <div className="flex items-center justify-between gap-3 animate-[flip-in_0.4s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex items-center gap-2.5">
        <span
          className="verdict-pop grid h-7 w-7 place-items-center rounded-lg"
          style={{ background: q.pays ? "rgba(62,207,178,0.15)" : "rgba(238,68,68,0.15)", color: accent }}
        >
          {q.pays ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
        </span>
        <div className="leading-tight">
          <div className="font-mono text-sm font-bold tracking-tight" style={{ color: accentSoft }}>
            {q.pays ? "QUORUM → PAY" : "NO QUORUM → REVERT"}
          </div>
          <div className="text-[11px]" style={{ color: "var(--cp-text-2)" }}>{q.reason}</div>
        </div>
      </div>
      {txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] font-medium transition hover:opacity-80"
          style={{ color: accentSoft }}
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
        className="mt-5 rounded-xl px-4 py-3.5 text-sm"
        style={{ border: "1px solid var(--cp-border-2)", background: "rgba(62,207,178,0.06)" }}
      >
        <div className="flex items-center gap-2.5 font-semibold" style={{ color: "var(--cp-teal)" }}>
          <InfoGlyph />
          Illustrative mode — this is how the gate behaves once a contract is live
        </div>
        <p className="mt-2 pl-[26px] text-[13px] leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
          The two outcomes below are the real decision logic running against sample data. No transaction hashes are
          shown until a registry is deployed.
        </p>
        <p className="mt-2 pl-[26px] text-[12px] leading-relaxed" style={{ color: "var(--cp-text-3)" }}>
          Demo running against the pre-deployed testnet contract. Configure the registry address to read live chain
          state.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 font-mono text-[12px]"
      style={{ borderTop: "1px solid var(--cp-border)", color: "var(--cp-text-3)" }}
    >
      {settled && winner && (
        <span>
          quorum hash <span style={{ color: "var(--cp-teal)" }}>{winner.slice(0, 16)}…{winner.slice(-6)}</span>
        </span>
      )}
      {publicConfig.registryUrl && (
        <a href={publicConfig.registryUrl} target="_blank" rel="noreferrer" className="cp-mono-link inline-flex items-center gap-1">
          registry contract <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
      {publicConfig.vaultConfigured && publicConfig.vaultUrl && (
        <a href={publicConfig.vaultUrl} target="_blank" rel="noreferrer" className="cp-mono-link inline-flex items-center gap-1">
          payout vault <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
      {publicConfig.attestTxUrl && (
        <a href={publicConfig.attestTxUrl} target="_blank" rel="noreferrer" className="cp-mono-link inline-flex items-center gap-1">
          attestation tx <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

interface QuorumView {
  pays: boolean;
  neutral?: boolean;
  agreement: number;
  threshold: number;
  reason: string;
}

function quorumView(result: VerifyResult | null, verdict: "pay" | "block"): QuorumView {
  if (!liveQuorumConfigured) {
    return illustrative(verdict, result);
  }
  // Live mode: never fall back to a predetermined verdict. A failed/empty chain read is NEUTRAL.
  if (!result || result.chainError || result.error || !result.quorum) {
    return {
      pays: false,
      neutral: true,
      agreement: 0,
      threshold: 0,
      reason: "chain read failed — could not verify on-chain"
    };
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
      <span className="shrink-0" style={{ color: "var(--cp-text-3)" }}>{label}</span>
      <span
        className={`min-w-0 truncate text-right tabular-nums transition-colors ${highlight ? "rounded px-1.5 py-0.5 font-semibold" : ""}`}
        style={highlight ? { background: "rgba(238,68,68,0.15)", color: "#EE6A6A" } : { color: "var(--cp-text-2)" }}
      >
        {value}
        {highlight && <span className="ml-1.5 text-[10px] uppercase tracking-wide" style={{ color: "rgba(238,68,68,0.8)" }}>tampered</span>}
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

function WarnGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
