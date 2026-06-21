const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_BASE ?? "https://testnet.cspr.live";

function clean(hash: string | undefined): string {
  return (hash ?? "").replace(/^(hash-|entity-contract-|contract-|deploy-)/, "").trim();
}

function deployUrl(txHash: string | undefined): string | undefined {
  const h = clean(txHash);
  return h ? `${EXPLORER_BASE}/deploy/${h}` : undefined;
}

export const publicConfig = {
  explorerBase: EXPLORER_BASE,
  requestId: (process.env.NEXT_PUBLIC_REQUEST_ID ?? "").trim(),
  registryConfigured: Boolean(clean(process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_HASH)),
  vaultConfigured: Boolean(clean(process.env.NEXT_PUBLIC_VAULT_CONTRACT_HASH)),
  registryUrl: clean(process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_HASH)
    ? `${EXPLORER_BASE}/contract/${clean(process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_HASH)}`
    : undefined,
  vaultUrl: clean(process.env.NEXT_PUBLIC_VAULT_CONTRACT_HASH)
    ? `${EXPLORER_BASE}/contract/${clean(process.env.NEXT_PUBLIC_VAULT_CONTRACT_HASH)}`
    : undefined,
  attestTxUrl: deployUrl(process.env.NEXT_PUBLIC_ATTEST_TX_HASH),
  payTxUrl: deployUrl(process.env.NEXT_PUBLIC_PAYOUT_TX_HASH),
  blockedTxUrl: deployUrl(process.env.NEXT_PUBLIC_BLOCKED_TX_HASH)
};

// True when the dashboard can read genuine quorum state for a known request from chain.
export const liveQuorumConfigured = Boolean(publicConfig.registryConfigured && publicConfig.requestId);
