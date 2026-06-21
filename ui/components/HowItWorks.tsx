const STEPS = [
  {
    n: "01",
    title: "Signers attest",
    body: "Independent agents hash the same deterministic RWA valuation and attest it to the AttestationRegistry on Casper. Quorum is the policy; the signer set is owner-curated and slashable.",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    n: "02",
    title: "Gate enforces in-VM",
    body: "The consumer contract composes require_quorum and the payout in one atomic Casper VM call. Hash clears the gate → the release goes through. No off-chain step can skip the check.",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M12 3l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6l7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="m9 12 2 2 4-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    n: "03",
    title: "Poison reverts",
    body: "Tamper any value and the hash has no quorum. require_quorum reverts and the whole call reverts with it — the funds never move. A bad signer can be slashed.",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 8.5l7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
];

export default function HowItWorks() {
  return (
    <section aria-label="How Casproof works">
      <div className="mb-6 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">How it works</h2>
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            className="group relative overflow-hidden rounded-2xl border border-white/8 bg-ink-900/40 p-5 transition hover:border-white/16"
          >
            <div className="mb-4 flex items-center justify-between">
              <span
                className={`grid h-10 w-10 place-items-center rounded-xl border ${
                  i === 2
                    ? "border-signal-red/25 bg-signal-red/[0.07] text-signal-red"
                    : "border-mint/25 bg-mint/[0.06] text-mint-soft"
                }`}
              >
                {s.glyph}
              </span>
              <span className="font-mono text-xs text-slate-600">{s.n}</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-100">{s.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{s.body}</p>
            {i < STEPS.length - 1 && (
              <span className="pointer-events-none absolute -right-3 top-1/2 hidden -translate-y-1/2 text-slate-700 md:block">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
                  <path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
