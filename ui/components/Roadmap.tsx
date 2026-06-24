const PHASES = [
  {
    phase: "Phase 1 — Action firewall",
    timeline: "Live on testnet",
    live: true,
    unlocks:
      "require_quorum guard, slashable reputation, and PayoutVault deployed and tested (19 OdraVM unit tests). Any consuming contract composes the gate today; the API will not change as proof sources evolve."
  },
  {
    phase: "Phase 2 — Pluggable proof sources",
    timeline: "3–6 months",
    live: false,
    unlocks:
      "Supplement the curated signer with proof-of-computation evidence — TEE remote-attestation, zkML proofs, optimistic re-execution. The gate does not change; only the evidence attest() accepts. Consumers built on the current interface stay compatible."
  },
  {
    phase: "Phase 3 — Staking & economic security",
    timeline: "6–9 months",
    live: false,
    unlocks:
      "Replace owner-curated slashing with bonded stake: signers post collateral, a successful slash burns it, and reputation becomes the basis for stake-weighted quorum. The existing slash hook and SignerSlashed event already carry it."
  },
  {
    phase: "Phase 4 — Mainnet, Oracle SDK & compliance",
    timeline: "9–12 months",
    live: false,
    unlocks:
      "Mainnet after a passed audit; x402 verify run as a public metered oracle; an Oracle SDK plus MCP config so any AI provider becomes a trusted signer in under an hour; trusted-signer set mapped to ERC-3643-style permissioned issuers."
  }
] as const;

const IMPACT = [
  {
    head: "Addressable market",
    body: "Every regulated entity deploying AI agents that make or assist value-bearing decisions — asset managers, RWA platforms, trading desks, insurance underwriters — needs this audit trail."
  },
  {
    head: "Pluggable primitive",
    body: "require_quorum is the slot any future proof source (TEE, zkML) plugs into. Consumers built on today's interface stay compatible as the proof of computation behind the gate evolves."
  },
  {
    head: "Casper-native",
    body: "Exposed over MCP and metered with x402, the gate becomes infrastructure rather than a single application — native to every future agent that deploys on Casper."
  }
] as const;

const BUILT_ON = ["Odra", "casper-js-sdk", "x402", "MCP", "CSPR.click", "Casper testnet"];

export default function Roadmap() {
  return (
    <section className="cp-wrap" style={{ paddingBlock: "clamp(48px, 7vw, 88px)" }}>
      <span className="cp-eyebrow">Roadmap</span>
      <h2 className="cp-h2 mt-4 max-w-3xl text-balance">From action firewall to proof-of-computation.</h2>
      <p className="cp-sub mt-4 max-w-2xl text-pretty">
        The wedge is an AI compliance and liability audit-trail for regulated finance. The gate stays the same; the
        proof source behind it gets stronger.
      </p>

      <div className="cp-card mt-8 overflow-hidden">
        <table className="cp-roadmap-table">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">Timeline</th>
              <th scope="col">What it unlocks</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((p) => (
              <tr key={p.phase}>
                <th scope="row">{p.phase}</th>
                <td>
                  {p.live ? (
                    <span className="cp-roadmap-live">
                      <span className="cp-roadmap-dot" aria-hidden />
                      {p.timeline}
                    </span>
                  ) : (
                    <span className="cp-roadmap-when">{p.timeline}</span>
                  )}
                </td>
                <td className="cp-roadmap-unlocks">{p.unlocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <span className="cp-eyebrow">Long-term impact</span>
        <div className="cp-flow-grid mt-6 grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {IMPACT.map((i) => (
            <div key={i.head} className="cp-card p-6">
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--cp-teal)" }}>
                {i.head}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
                {i.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <span className="cp-eyebrow">Built on</span>
        <ul className="flex flex-wrap gap-2.5" aria-label="Casper stack">
          {BUILT_ON.map((b) => (
            <li key={b} className="cp-chip font-mono">
              {b}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
