import Header from "@/components/Header";
import HeroVerify from "@/components/HeroVerify";
import QuorumContrast from "@/components/QuorumContrast";
import WhatIsCasproof from "@/components/WhatIsCasproof";
import IntegrationShowcase from "@/components/IntegrationShowcase";
import HowItWorks from "@/components/HowItWorks";
import CasperStack from "@/components/CasperStack";
import AsciiHero from "@/components/AsciiHero";
import AsciiField from "@/components/AsciiField";
import Reveal from "@/components/Reveal";

const REPO_URL = "https://github.com/SyaugiAlkaf/casproof";

export default function Page() {
  return (
    <div className="relative min-h-screen">
      <a
        href="#verify"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-mint focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
      >
        Skip to the verify gate
      </a>
      <AsciiField />
      <Backdrop />
      <Header />

      <main id="main" className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-14 sm:px-8 sm:pt-20">
        <AsciiHero />

        <div className="scroll-mt-24" id="verify">
          <HeroVerify />
        </div>

        <Reveal className="block scroll-mt-24" id="what">
          <WhatIsCasproof />
        </Reveal>

        <Reveal className="mt-20 block scroll-mt-24" id="demo">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(34,211,238,0.7)]" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
              See it block a poisoned feed — live on testnet
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-accent/30 via-white/10 to-transparent" />
          </div>
          <QuorumContrast />
        </Reveal>

        <Reveal className="block">
          <IntegrationShowcase />
        </Reveal>

        <Reveal className="mt-20 block">
          <HowItWorks />
        </Reveal>

        <Reveal delay={60}>
          <CasperStack />
        </Reveal>
      </main>

      <Reveal>
        <Footer />
      </Reveal>
    </div>
  );
}

const TOOLKIT_CHIPS = ["Odra", "casper-js-sdk", "x402", "MCP", "CSPR.click"];

function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.06] bg-ink-950/60 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-100">Casproof</span>
              <span className="text-slate-600" aria-hidden>·</span>
              <span className="text-slate-400">verify-before-act for AI agents</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              Built for the Casper Agentic Buildathon 2026 — the unskippable on-chain action firewall, enforced in
              the Casper VM and paid for via x402.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Casper toolkit">
              {TOOLKIT_CHIPS.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-slate-300"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label="Footer links" className="flex flex-col gap-3 text-sm sm:flex-row sm:gap-6">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg text-slate-300 transition hover:text-mint-soft"
            >
              <GithubGlyph />
              GitHub repo
            </a>
            <a
              href="https://testnet.cspr.live"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg text-slate-300 transition hover:text-mint-soft"
            >
              cspr.live
              <ArrowUpRight />
            </a>
          </nav>
        </div>

        <p className="mt-8 border-t border-white/[0.05] pt-6 text-[12px] text-slate-500">
          Testnet demonstration. No tx hashes are shown until a contract is deployed.
        </p>
      </div>
    </footer>
  );
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 bg-radial-fade" />
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(100% 60% at 50% 0%, #000 0%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(100% 60% at 50% 0%, #000 0%, transparent 75%)"
        }}
      />
      <div className="absolute left-1/2 top-[-10%] h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-mint/[0.07] blur-[120px]" />
      <div
        className="hex-backdrop absolute inset-0 opacity-[0.5]"
        style={{
          maskImage: "radial-gradient(120% 80% at 50% 30%, #000 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(120% 80% at 50% 30%, #000 0%, transparent 70%)"
        }}
      />
    </div>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
