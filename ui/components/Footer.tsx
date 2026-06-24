import { publicConfig } from "@/lib/config";

const REPO_URL = "https://github.com/SyaugiAlkaf/casproof";

export default function Footer() {
  const links: { label: string; href: string }[] = [{ label: "github.com/casproof", href: REPO_URL }];
  if (publicConfig.registryUrl) links.push({ label: "registry contract", href: publicConfig.registryUrl });
  if (publicConfig.payTxUrl) links.push({ label: "payout tx", href: publicConfig.payTxUrl });

  return (
    <footer style={{ borderTop: "1px solid var(--cp-border)" }}>
      <div className="cp-wrap flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[14px]">
            <span className="font-semibold" style={{ color: "var(--cp-text)" }}>
              Casproof
            </span>
            <span style={{ color: "var(--cp-text-3)" }} aria-hidden>
              ·
            </span>
            <span style={{ color: "var(--cp-text-2)" }}>Apache-2.0</span>
          </div>
          <p className="mt-2 text-[13px]" style={{ color: "var(--cp-text-3)" }}>
            Built for the Casper Agentic Buildathon 2026 — on-chain verification before any agent payout.
          </p>
        </div>

        <nav aria-label="Footer links" className="flex flex-wrap gap-x-6 gap-y-2">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="cp-mono-link">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
