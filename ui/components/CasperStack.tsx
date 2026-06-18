const PIECES = [
  { name: "Odra", note: "contract" },
  { name: "casper-js-sdk", note: "agents" },
  { name: "x402", note: "metered reads" },
  { name: "MCP", note: "agent discovery" },
  { name: "CSPR.click", note: "wallet" }
];

export default function CasperStack() {
  return (
    <section className="mt-16">
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-6 py-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
          Built on the Casper stack
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {PIECES.map((p) => (
            <span
              key={p.name}
              className="group inline-flex items-baseline gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 transition hover:border-mint/30 hover:bg-mint/[0.05]"
            >
              <span className="text-sm font-medium text-slate-200">{p.name}</span>
              <span className="text-[11px] text-slate-500 transition group-hover:text-mint-soft/70">{p.note}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
