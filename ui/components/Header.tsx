import WalletConnectClient from "./WalletConnectClient";

const REPO_URL = "https://github.com/SyaugiAlkaf/casproof";

export default function Header() {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl"
      style={{ borderBottom: "1px solid var(--cp-border)", background: "rgba(10,10,10,0.72)" }}
    >
      <div className="cp-wrap flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="#main" aria-label="Casproof home" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[18px] font-semibold" style={{ color: "var(--cp-text)", letterSpacing: "-0.02em" }}>
              Cas<span style={{ color: "var(--cp-teal)" }}>proof</span>
            </span>
          </a>
          <span className="cp-header-tag hidden h-7 w-px sm:block" style={{ background: "var(--cp-border-2)" }} aria-hidden />
          <p className="cp-header-tag hidden text-[13px] sm:block" style={{ color: "var(--cp-text-2)" }}>
            Verify-before-act firewall · Casper
          </p>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 text-[13px] sm:inline-flex"
            style={{ color: "var(--cp-text-2)" }}
          >
            <GithubGlyph />
            GitHub
          </a>
          <WalletConnectClient />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      className="grid h-8 w-8 place-items-center rounded-lg"
      style={{ border: "1px solid var(--cp-border-2)", background: "rgba(62,207,178,0.07)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M12 3l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6l7-3Z" stroke="var(--cp-teal)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="m9 12 2 2 4-4.2" stroke="var(--cp-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
