import Header from "@/components/Header";
import HeroVerify from "@/components/HeroVerify";
import PoisonDemo from "@/components/PoisonDemo";
import HowItWorks from "@/components/HowItWorks";

const REPO_URL = "https://github.com/SyaugiAlkaf/casproof";

export default function Page() {
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Header />

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
        <section className="mb-12 max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
            Casper testnet · agent-to-agent trust layer
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-slate-50 sm:text-5xl">
            Don&apos;t trust an AI output.{" "}
            <span className="bg-gradient-to-r from-mint-soft to-mint bg-clip-text text-transparent">
              Verify it on-chain.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-base leading-relaxed text-slate-400 sm:text-lg">
            Casproof lets a producer agent attest an AI-generated RWA valuation on Casper, and a consumer DeFi
            agent verify that proof before releasing a payout. Tamper the feed and the payout blocks — provably,
            in public.
          </p>
        </section>

        <div className="space-y-6">
          <HeroVerify />
          <PoisonDemo />
        </div>

        <div className="mt-16">
          <HowItWorks />
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="font-semibold text-slate-300">Casproof</span>
          <span className="text-slate-600">·</span>
          <span>Casper Agentic Buildathon 2026</span>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-slate-400 transition hover:text-mint-soft"
          >
            <GithubGlyph />
            GitHub repo
          </a>
          <a
            href="https://testnet.cspr.live"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 transition hover:text-mint-soft"
          >
            cspr.live ↗
          </a>
        </div>
      </div>
    </footer>
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
