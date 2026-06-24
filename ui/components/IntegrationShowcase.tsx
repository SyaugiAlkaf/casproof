"use client";

import { useEffect, useRef, useState } from "react";
import { Pill } from "./ui";

type Lang = "bash" | "python" | "json" | "rust" | "ts";

interface Tab {
  key: string;
  label: string;
  lang: Lang;
  caption: string;
  code: string;
}

const PY_VERIFY = `from casproof import Casproof

cp = Casproof(endpoint="http://localhost:3000/api/verify")
d = cp.verify_output(
    "claude-opus-4-8", prompt, payload, request_id="rwa-001"
)

if d.proceed:            # d.decision == "PROCEED" | "BLOCK", d.agreement == k
    release_payout()
else:
    hold(d.error or d.decision)   # tampered / under-quorum / unattested`;

const CLI_VERIFY = `pip install -e clients/python        # gives a 'casproof' command

casproof verify --request-id rwa-001 --model claude-opus-4-8 \\
  --prompt "Value PARK-NOTE-001 as of 2026-Q2" \\
  --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'

# exit 0 = PROCEED, exit 1 = BLOCK`;

const HTTP_VERIFY = `curl -s -H "x-payment: sim" \\
  "$CASPROOF/verify?hash=$OUTPUT_HASH&requestId=rwa-001"

# -> { "hash": "a3f...1c", "attested": true, "trusted": true,
#      "quorum": { "quorumReached": true, "winningHash": "a3f...1c", "agreement": 2 } }
# attested:false or trusted:false -> block the action`;

const JS_VERIFY = `import { Casproof } from "casproof";

const cp = new Casproof("http://localhost:3000/api/verify");
const d = await cp.verifyOutput("claude-opus-4-8", prompt, payload, "rwa-001");

if (d.proceed) releasePayout();   // d.decision === "PROCEED", d.agreement === k`;

const MCP_CONFIG = `{
  "mcpServers": {
    "casproof": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/absolute/path/to/casproof/agents"
    }
  }
}

// the agent then calls the tool:
// casproof_verify_output({ modelId, prompt, payload, requestId }) -> PROCEED | BLOCK`;

const CONTRACT_GUARD = `// first line of your action entrypoint —
// reverts the whole tx if the output is not quorum-attested:
let signer = self.registry.require_quorum(request_id, output_hash);

// ... your value-bearing action runs only if require_quorum returned.
self.transfer_to(beneficiary);`;

const DOCKER_RUN = `docker compose up                 # verify server (:4021)
docker compose --profile ui up    # + the dashboard (:3000)`;

const TABS: Tab[] = [
  { key: "python", label: "Python", lang: "python", caption: "clients/python — works today", code: PY_VERIFY },
  { key: "cli", label: "CLI", lang: "bash", caption: "terminal — exit code is the decision", code: CLI_VERIFY },
  { key: "http", label: "HTTP", lang: "bash", caption: "curl / any language — works today", code: HTTP_VERIFY },
  { key: "js", label: "JS", lang: "ts", caption: "clients/js — Node 18+", code: JS_VERIFY },
  { key: "mcp", label: "MCP", lang: "json", caption: "any MCP-aware agent (Claude, etc.)", code: MCP_CONFIG },
  { key: "contract", label: "Contract", lang: "rust", caption: "Odra / another Casper contract — in-VM", code: CONTRACT_GUARD },
  { key: "docker", label: "Docker", lang: "bash", caption: "run the whole thing", code: DOCKER_RUN }
];

export default function IntegrationShowcase() {
  const [active, setActive] = useState(TABS[0].key);
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <section aria-labelledby="integration-title" className="mt-20">
      <div className="mb-6 flex items-center gap-3">
        <h2 id="integration-title" className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Integration
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/40 p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent" />

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill tone="neutral">drop-in</Pill>
              <Pill tone="good">verify-before-act</Pill>
            </div>
            <h3 className="text-balance text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
              Drop it into your stack — verify-before-act in 2 lines.
            </h3>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
              Reads on-chain quorum + attestation, returns <span className="text-mint-soft">PROCEED</span> /{" "}
              <span className="text-signal-red">BLOCK</span>. Python &amp; HTTP work today; the write side (attest)
              is in the TS CLI.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Integration language"
          className="flex flex-wrap gap-1.5 rounded-xl border border-white/8 bg-ink-950/50 p-1.5"
        >
          {TABS.map((t) => {
            const selected = t.key === active;
            return (
              <button
                key={t.key}
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`panel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(t.key)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition focus-visible:outline-offset-4 ${
                  selected
                    ? "bg-mint/15 text-mint-soft shadow-[inset_0_0_0_1px_rgba(94,234,212,0.25)]"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <CodeCard tab={tab} />

        <p className="mt-4 text-[12px] leading-relaxed text-slate-500">
          All paths converge on the same on-chain registry — a hash attested by a TypeScript producer is verifiable
          from Python, curl, an MCP agent, or another Casper contract.
        </p>
      </div>
    </section>
  );
}

function CodeCard({ tab }: { tab: Tab }) {
  return (
    <div
      role="tabpanel"
      id={`panel-${tab.key}`}
      aria-labelledby={`tab-${tab.key}`}
      className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-ink-950/70"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-signal-red/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-signal-amber/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint/50" />
          </span>
          <span className="font-mono text-[11px] text-slate-500">{tab.caption}</span>
        </div>
        <CopyButton text={tab.code} label={`${tab.label} snippet`} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-slate-200">
        <code>{tab.code}</code>
      </pre>
    </div>
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
      /* clipboard blocked — non-critical */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition hover:border-mint/30 hover:text-mint-soft focus-visible:border-mint/40"
    >
      {copied ? <CheckGlyph /> : <CopyGlyph />}
      <span aria-live="polite">{copied ? "copied!" : "copy"}</span>
    </button>
  );
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="m5 12.5 4.2 4.3L19 7.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
