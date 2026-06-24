"use client";

import { useEffect, useRef, useState } from "react";

const PY_VERIFY = `from casproof import Casproof

cp = Casproof(endpoint="http://localhost:3000/api/verify")
d = cp.verify_output(
    "claude-opus-4-8", prompt, payload, request_id="rwa-001"
)

if d.proceed:            # d.decision == "PROCEED", d.agreement == k
    release_payout()
else:
    hold(d.error or d.decision)   # tampered / under-quorum / unattested`;

const CONTRACT_GUARD = `// first line of your action entrypoint —
// reverts the whole tx if the output is not quorum-attested:
let signer = self.registry.require_quorum(request_id, output_hash);

// ... your value-bearing action runs only if require_quorum returned.
self.transfer_to(beneficiary);`;

const MCP_CONFIG = `{
  "mcpServers": {
    "casproof": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/absolute/path/to/casproof/agents"
    }
  }
}`;

const TABS = [
  { key: "python", label: "Python", caption: "clients/python — works today", code: PY_VERIFY },
  { key: "contract", label: "Contract", caption: "Odra / another Casper contract — in-VM", code: CONTRACT_GUARD },
  { key: "mcp", label: "MCP", caption: "any MCP-aware agent (Claude, etc.)", code: MCP_CONFIG }
] as const;

export default function Integration() {
  const [active, setActive] = useState<(typeof TABS)[number]["key"]>("python");
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <section id="integrate" className="cp-wrap" style={{ paddingBlock: "clamp(48px, 7vw, 88px)" }}>
      <span className="cp-eyebrow">Integration</span>
      <h2 className="cp-h2 mt-4 max-w-3xl text-balance">Drop it into your stack — verify-before-act in two lines.</h2>
      <p className="cp-sub mt-4 max-w-2xl text-pretty">
        Reads on-chain quorum + attestation and returns <span style={{ color: "var(--cp-teal)" }}>PROCEED</span> /{" "}
        <span style={{ color: "var(--cp-red)" }}>BLOCK</span>. The same registry is reachable from Python, another
        Casper contract, or any MCP-aware agent.
      </p>

      <div className="cp-card mt-8 overflow-hidden">
        <div
          role="tablist"
          aria-label="Integration target"
          className="flex flex-wrap gap-1.5 p-2"
          style={{ borderBottom: "1px solid var(--cp-border)" }}
        >
          {TABS.map((t) => {
            const selected = t.key === active;
            return (
              <button
                key={t.key}
                role="tab"
                id={`itab-${t.key}`}
                aria-selected={selected}
                aria-controls={`ipanel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(t.key)}
                className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition"
                style={
                  selected
                    ? { background: "rgba(62,207,178,0.12)", color: "var(--cp-teal)", boxShadow: "inset 0 0 0 1px rgba(62,207,178,0.25)" }
                    : { color: "var(--cp-text-2)" }
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`ipanel-${tab.key}`} aria-labelledby={`itab-${tab.key}`}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--cp-border)" }}>
            <span className="font-mono text-[11px]" style={{ color: "var(--cp-text-3)" }}>
              {tab.caption}
            </span>
            <CopyButton text={tab.code} label={`${tab.label} snippet`} />
          </div>
          <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed" style={{ color: "var(--cp-text)" }}>
            <code>{tab.code}</code>
          </pre>
        </div>
      </div>

      {active === "mcp" && (
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--cp-text-2)" }}>
          The agent then calls the tool{" "}
          <code className="rounded px-1.5 py-0.5 font-mono text-[12px]" style={{ background: "var(--cp-surface)", color: "var(--cp-teal)" }}>
            casproof_verify_output({"{ modelId, prompt, payload, requestId }"})
          </code>{" "}
          and receives a PROCEED / BLOCK decision before it acts.
        </p>
      )}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition"
      style={{ border: "1px solid var(--cp-border-2)", color: "var(--cp-text-2)" }}
    >
      <span aria-live="polite">{copied ? "copied!" : "copy"}</span>
    </button>
  );
}
