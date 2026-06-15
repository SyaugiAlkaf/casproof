"use client";

import dynamic from "next/dynamic";

const WalletConnect = dynamic(() => import("./WalletConnect"), {
  ssr: false,
  loading: () => (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-500">
      <span className="h-3.5 w-3.5 animate-pulse rounded-sm bg-slate-600" />
      Connect wallet
    </span>
  )
});

export default function WalletConnectClient() {
  return <WalletConnect />;
}
