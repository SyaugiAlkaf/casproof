"use client";

import dynamic from "next/dynamic";

const WalletConnect = dynamic(() => import("./WalletConnect"), {
  ssr: false,
  loading: () => (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 py-2 text-sm text-[var(--cp-text-3)]">
      <span className="h-3.5 w-3.5 animate-pulse rounded-sm bg-[var(--cp-text-3)]" />
      Connect wallet
    </span>
  )
});

export default function WalletConnectClient() {
  return <WalletConnect />;
}
