"use client";

import { useEffect, useRef } from "react";
import { publicConfig } from "@/lib/config";

const RAMP = " .:-=+*o#%";
const RL = RAMP.length - 1;

export default function Hero() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLPreElement>(null);
  const scanRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    const base = baseRef.current;
    const scan = scanRef.current;
    if (!field || !base || !scan) return;

    let cols = 140;
    let rows = 48;

    const sizeAscii = () => {
      const w = field.clientWidth || window.innerWidth;
      const h = field.clientHeight || 700;
      cols = Math.max(20, Math.min(260, Math.ceil(w / 9.6) + 2));
      rows = Math.max(12, Math.min(120, Math.ceil(h / 15) + 2));
    };

    const drawAscii = (t: number) => {
      const cx = cols / 2;
      const cy = rows / 2;
      const period = cols + 46;
      const waveX = ((t * 26) % period) - 23;
      let b = "";
      let s = "";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let v =
            0.5 +
            0.34 * Math.sin(x * 0.16 + t * 0.65) * Math.cos(y * 0.26 - t * 0.45) +
            0.26 * Math.sin((x + y) * 0.11 - t * 0.9) +
            0.16 * Math.sin((x - y) * 0.07 + t * 0.4);
          const dr = Math.hypot((x - cx) / cx, (y - cy) / cy);
          v -= dr * 0.16;
          if (v < 0) v = 0;
          else if (v > 1) v = 1;
          b += RAMP[Math.round(v * RL)];

          const d = Math.abs(x - waveX);
          if (d < 6) {
            let sv = v + (1 - d / 6) * 0.55;
            if (sv > 1) sv = 1;
            const idx = Math.round(sv * RL);
            s += idx > 2 ? RAMP[idx] : " ";
          } else {
            s += " ";
          }
        }
        b += "\n";
        s += "\n";
      }
      base.textContent = b;
      scan.textContent = s;
    };

    sizeAscii();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      drawAscii(0);
      return;
    }

    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 55) {
        drawAscii(now / 1000);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => sizeAscii();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <section className="relative overflow-hidden" style={{ paddingBlock: "clamp(56px, 9vw, 110px)" }}>
      <div ref={fieldRef} className="cp-ascii" aria-hidden>
        <pre ref={baseRef} className="cp-ascii-base" />
        <pre ref={scanRef} className="cp-ascii-scan" />
      </div>
      <div className="cp-hero-glow" aria-hidden />
      <div className="cp-hero-veil" aria-hidden />

      <div className="cp-wrap relative">
        <div className="cp-hero-grid">
          <div className="cp-hero-copy">
            <span className="cp-pill">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--cp-teal)", boxShadow: "0 0 8px rgba(62,207,178,0.8)" }} aria-hidden />
              Casper Network Testnet · Live
            </span>

            <h1 className="cp-h1 mt-6 text-balance">On-chain verification before any agent payout.</h1>

            <p className="cp-sub mt-5 text-pretty">
              Casproof enforces verify-before-act inside the Casper VM — the same atomic call that checks the quorum
              attests the output <span style={{ color: "var(--cp-text)" }}>and</span> releases (or reverts) the payout. No
              off-chain escape hatch.
            </p>

            <div className="cp-cta-row mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="#verify" className="cp-btn cp-btn-primary">
                Verify an agent output →
              </a>
              <a href="https://github.com/SyaugiAlkaf/casproof" target="_blank" rel="noopener noreferrer" className="cp-btn cp-btn-ghost">
                View on GitHub
              </a>
            </div>

            <ul className="mt-7 flex flex-wrap justify-center gap-2" aria-label="Capabilities">
              {["One atomic VM call", "x402-metered verify", "Pluggable attestation policy", "RWA / DeFi payouts"].map((c) => (
                <li key={c} className="cp-chip">
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <ProofCard />
        </div>
      </div>
    </section>
  );
}

function ProofCard() {
  const t3 = "var(--cp-text-3)";
  const t2 = "var(--cp-text-2)";
  const t = "var(--cp-text)";
  const teal = "var(--cp-teal)";
  const purple = "#a78bfa";
  return (
    <div className="cp-card cp-proof overflow-hidden" style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
      <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderBottom: "1px solid var(--cp-border)" }}>
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ee5c57" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f6be50" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3ecfb2" }} />
        </span>
        <span className="ml-2 font-mono text-[12px]" style={{ color: t3 }}>
          casproof verify
        </span>
      </div>
      <div className="font-mono text-[13px]" style={{ lineHeight: 1.85, padding: "20px 18px", color: t2 }}>
        <div style={{ whiteSpace: "pre" }}>
          <span style={{ color: teal }}>$</span>
          <span style={{ color: t }}> casproof verify </span>
          <span style={{ color: purple }}>--request-id</span>
          <span style={{ color: teal }}> rwa-001 </span>
          <span style={{ color: purple }}>--model</span>
          <span style={{ color: teal }}> claude-opus-4-8</span>
        </div>
        <div style={{ height: "0.9em" }}>{" "}</div>
        <div style={{ whiteSpace: "pre" }}>
          <span style={{ color: t3 }}>{"  request   "}</span>
          <span style={{ color: t }}>rwa-001</span>
        </div>
        <div style={{ whiteSpace: "pre" }}>
          <span style={{ color: t3 }}>{"  model     "}</span>
          <span style={{ color: t }}>claude-opus-4-8</span>
        </div>
        <div style={{ whiteSpace: "pre" }}>
          <span style={{ color: t3 }}>{"  quorum    "}</span>
          <span style={{ color: t }}>{"2-of-2  "}</span>
          <span style={{ color: teal }}>✓</span>
        </div>
        <div style={{ height: "0.9em" }}>{" "}</div>
        <div style={{ whiteSpace: "pre" }}>
          <span style={{ color: teal, fontWeight: 500 }}>{"  PROCEED"}</span>
          <span style={{ color: t2 }}> — payout authorized</span>
        </div>
        <div>
          <span style={{ color: t3 }}>{"  tx  "}</span>
          {publicConfig.payTxUrl ? (
            <a
              href={publicConfig.payTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: teal, wordBreak: "break-all" }}
            >
              c1849015bf503dcca17f3d659514f7674fa394254087d6fb8ab982696f7de077
            </a>
          ) : (
            <span style={{ color: t2, wordBreak: "break-all" }}>
              c1849015bf503dcca17f3d659514f7674fa394254087d6fb8ab982696f7de077
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
