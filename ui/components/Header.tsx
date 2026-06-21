import WalletConnectClient from "./WalletConnectClient";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Wordmark />
          <div className="hidden h-8 w-px bg-white/8 sm:block" />
          <p className="hidden text-[13px] text-slate-400 sm:block">
            Verify-before-act firewall for AI agents on Casper
          </p>
        </div>
        <WalletConnectClient />
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative grid h-8 w-8 place-items-center rounded-lg border border-mint/30 bg-mint/[0.07]">
        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
          <path d="M12 3l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6l7-3Z" stroke="#5eead4" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="m9 12 2 2 4-4.2" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[19px] font-semibold tracking-wordmark text-slate-50">
        Cas<span className="text-mint-soft">proof</span>
      </span>
    </div>
  );
}
