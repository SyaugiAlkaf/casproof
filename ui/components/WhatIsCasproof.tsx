const BEATS = [
  {
    n: "01",
    key: "attest",
    title: "Attest",
    line: "k trusted agents hash the same output and attest that hash on Casper.",
    box: ["agent₁ → hash", "agent₂ → hash", "agent₃ → hash"]
  },
  {
    n: "02",
    key: "quorum",
    title: "Quorum",
    line: "An output is genuine only when k-of-n attest the byte-identical hash.",
    box: ["k of n agree", "→ quorum_output", "set once, on-chain"]
  },
  {
    n: "03",
    key: "gate",
    title: "Gate",
    line: "require_quorum: PAY if the hash matches, REVERT if it was poisoned.",
    box: ["require_quorum()", "match → PAY", "poison → REVERT"]
  }
];

export default function WhatIsCasproof() {
  return (
    <section aria-labelledby="what-title" className="mt-20">
      <div className="mb-6 flex items-center gap-3">
        <h2 id="what-title" className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          What is Casproof
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        <div className="rounded-2xl border border-white/8 bg-ink-900/40 p-6 sm:p-7">
          <p className="text-pretty text-[15px] leading-relaxed text-slate-300 sm:text-base">
            Autonomous AI agents now pay each other for outputs — a price feed, a risk score, an RWA valuation. Act
            on a <span className="font-medium text-signal-red/90">tampered or forged</span> output and you lose real
            money, and today there is no on-chain way to know the output is genuine.
          </p>
          <p className="mt-4 text-pretty text-[15px] leading-relaxed text-slate-300 sm:text-base">
            Casproof makes the consuming smart contract <span className="font-medium text-mint-soft">refuse to act</span>{" "}
            unless the output is verified. The verify decision and the payout run in{" "}
            <span className="font-medium text-slate-100">one atomic Casper VM call</span> — so no off-chain step can
            skip the check.
          </p>
          <p className="mt-4 text-pretty text-[13px] leading-relaxed text-slate-400">
            The trusted signer set is owner-curated today and slashable; proof-of-compute receipts (TEE / zkML) are
            on the roadmap.
          </p>
        </div>

        <ol className="grid gap-3" aria-label="Casproof flow: attest, quorum, gate">
          {BEATS.map((b, i) => (
            <li
              key={b.key}
              className={`relative overflow-hidden rounded-2xl border bg-ink-950/50 p-4 sm:p-5 ${
                i === 2 ? "border-signal-red/20" : "border-mint/15"
              }`}
            >
              <div className="flex items-start gap-4">
                <span
                  className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border font-mono text-[13px] ${
                    i === 2
                      ? "border-signal-red/25 bg-signal-red/[0.07] text-signal-red"
                      : "border-mint/25 bg-mint/[0.06] text-mint-soft"
                  }`}
                >
                  {b.n}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100">{b.title}</h3>
                  <p className="mt-1 text-pretty text-[13px] leading-relaxed text-slate-400">{b.line}</p>
                </div>
              </div>
              <pre
                aria-hidden
                className={`mt-3 ml-[3.25rem] overflow-x-auto rounded-lg border bg-ink-950/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed ${
                  i === 2 ? "border-signal-red/15 text-signal-red/80" : "border-white/8 text-mint-soft/75"
                }`}
              >
                {b.box.map((row) => (
                  <span key={row} className="block whitespace-pre">
                    {row}
                  </span>
                ))}
              </pre>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
