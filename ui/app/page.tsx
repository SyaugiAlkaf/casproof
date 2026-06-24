import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ProblemFlow from "@/components/ProblemFlow";
import QuorumContrast from "@/components/QuorumContrast";
import Integration from "@/components/Integration";
import Roadmap from "@/components/Roadmap";
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <div className="relative min-h-screen" style={{ background: "var(--cp-base)" }}>
      <a
        href="#verify"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--cp-teal)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#04120e]"
      >
        Skip to the verify gate
      </a>

      <Header />

      <main id="main" className="relative">
        <Hero />
        <ProblemFlow />

        <section id="verify" className="cp-wrap scroll-mt-20" style={{ paddingBlock: "clamp(48px, 7vw, 88px)" }}>
          <span className="cp-eyebrow">Live on testnet</span>
          <h2 className="cp-h2 mt-4 max-w-3xl text-balance">See it block a poisoned feed — live on testnet.</h2>
          <p className="cp-sub mt-4 max-w-2xl text-pretty">
            Two RWA valuations go through the real on-chain quorum gate. The genuine output has quorum and the payout
            releases; one tampered byte loses quorum and the release reverts. Both verdicts are read from Casper.
          </p>
          <div className="mt-8">
            <QuorumContrast />
          </div>
        </section>

        <Integration />
        <Roadmap />
      </main>

      <Footer />
    </div>
  );
}
