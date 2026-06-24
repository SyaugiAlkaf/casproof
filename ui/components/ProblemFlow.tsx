const STEPS = [
  {
    n: "01",
    title: "Attest",
    body: "A producer agent runs the valuation, hashes the output (blake2b), and writes the attestation to the Casper registry contract — signed and timestamped on-chain."
  },
  {
    n: "02",
    title: "Quorum",
    body: "k independent signers must attest the same deterministic hash for a request. Change one byte and that output has no quorum — there is no winning hash to act on."
  },
  {
    n: "03",
    title: "Gate",
    body: "PayoutVault.release composes the registry's require_quorum guard. No quorum → the call reverts, and the value-bearing action reverts with it. The check is unskippable."
  }
] as const;

export default function ProblemFlow() {
  return (
    <section className="cp-wrap" style={{ paddingBlock: "clamp(48px, 7vw, 88px)" }}>
      <span className="cp-eyebrow">How it works</span>
      <h2 className="cp-h2 mt-4 max-w-3xl text-balance">
        Verify before act — in three on-chain steps
      </h2>
      <p className="cp-sub mt-4 max-w-2xl text-pretty">
        An agent reads a model output and acts on it — releasing funds, settling a trade. If the feed was poisoned, the
        money is already gone. Casproof moves the check on-chain and makes it part of the action itself.
      </p>

      <div className="cp-flow-grid mt-10 grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {STEPS.map((s) => (
          <div key={s.n} className="cp-card p-6">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[13px]" style={{ color: "var(--cp-teal)" }}>
                {s.n}
              </span>
              <span className="h-px flex-1" style={{ background: "var(--cp-border-2)" }} aria-hidden />
            </div>
            <h3 className="mt-4 text-[17px] font-semibold" style={{ color: "var(--cp-text)" }}>
              {s.title}
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
