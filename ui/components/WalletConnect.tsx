"use client";

import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "styled-components";
import {
  ClickProvider,
  DefaultThemes,
  buildTheme,
  useClickRef
} from "@make-software/csprclick-ui";
import type { AccountType, CsprClickInitOptions } from "@make-software/csprclick-core-types";

const CLICK_OPTIONS: CsprClickInitOptions = {
  appName: "Casproof",
  appId: "csprclick-template",
  contentMode: "iframe",
  providers: ["casper-wallet", "metamask-snap", "ledger"],
  chainName: "casper-test"
};

const CSPR_CLICK_SDK = "https://sdk.cspr.click/sdk-v1/csprclick-sdk.js";

const theme = buildTheme({
  csprclickDarkTheme: DefaultThemes.csprclick.csprclickDarkTheme,
  csprclickLightTheme: DefaultThemes.csprclick.csprclickLightTheme
}).dark;

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
}

function ConnectInner() {
  const clickRef = useClickRef();
  const [account, setAccount] = useState<AccountType | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clickRef) return;
    const onConnected = (evt: { account?: AccountType }) => {
      if (evt?.account) setAccount(evt.account);
      setBusy(false);
    };
    const onDisconnected = () => setAccount(null);
    clickRef.on("csprclick:signed_in", onConnected);
    clickRef.on("csprclick:switched_account", onConnected);
    clickRef.on("csprclick:signed_out", onDisconnected);
    clickRef.on("csprclick:disconnected", onDisconnected);

    const current = clickRef.getActiveAccount?.();
    if (current) setAccount(current);

    return () => {
      clickRef.off("csprclick:signed_in", onConnected);
      clickRef.off("csprclick:switched_account", onConnected);
      clickRef.off("csprclick:signed_out", onDisconnected);
      clickRef.off("csprclick:disconnected", onDisconnected);
    };
  }, [clickRef]);

  const connect = useCallback(() => {
    if (!clickRef) return;
    setBusy(true);
    clickRef.signIn();
  }, [clickRef]);

  const disconnect = useCallback(() => {
    clickRef?.signOut();
    setAccount(null);
  }, [clickRef]);

  if (account?.public_key) {
    return (
      <button
        onClick={disconnect}
        title="Disconnect wallet"
        className="group inline-flex items-center gap-2 rounded-full border border-[var(--cp-teal)]/25 bg-[var(--cp-teal)]/[0.06] px-3.5 py-2 text-sm font-medium text-[var(--cp-teal)] transition hover:border-[var(--cp-teal)]/50 hover:bg-[var(--cp-teal)]/10"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--cp-teal)] shadow-[0_0_8px] shadow-[var(--cp-teal)]" />
        <span className="font-mono text-[13px] tracking-tight">{shortKey(account.public_key)}</span>
        <span className="text-[11px] uppercase tracking-wider text-[var(--cp-teal)]/50 transition group-hover:text-[#EE6A6A]">
          ✕
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={!clickRef || busy}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--cp-border-2)] bg-[var(--cp-surface)] px-4 py-2 text-sm font-medium text-[var(--cp-text)] transition hover:border-[var(--cp-teal)]/50 hover:bg-[var(--cp-teal)]/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <WalletGlyph />
      {busy ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 py-2 text-sm text-[var(--cp-text-3)]">
          <WalletGlyph />
          Connect wallet
        </span>
      );
    }
    return this.props.children;
  }
}

function WalletGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h13a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16.5" cy="12.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

export default function WalletConnect() {
  return (
    <Boundary>
      <ClickProvider options={CLICK_OPTIONS} csprclickSdk={CSPR_CLICK_SDK}>
        <ThemeProvider theme={theme}>
          <ConnectInner />
        </ThemeProvider>
      </ClickProvider>
    </Boundary>
  );
}
