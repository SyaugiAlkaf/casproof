// Live Casper testnet defaults (all public on-chain values). Used when env is unset, so the
// deployed dashboard reads live chain without any env configuration; env still overrides.
const LIVE = {
  explorer: "https://testnet.cspr.live",
  registry: "ecb2b8cc188254edc12d9f7f955fd000629fcfeef69c2912432d53053c57ca29",
  vault: "c5e070238a6e818272fb9c27fa25929a79187b7f48136ff4355c956671ce36ae",
  requestId: "823d1427b2bdfbae-mqsyp55n",
  attestTx: "ee9ae7b50754cfac19bda6f3b21608a75deaaf8cf051c3e52781395a5be3e301",
  payTx: "c1849015bf503dcca17f3d659514f7674fa394254087d6fb8ab982696f7de077",
  blockedTx: "8fc53e670612a9148e52f8d5c9adf32c9744200ed2b6227dfaa5bcafdd6a3645"
};

const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_BASE ?? LIVE.explorer;
const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_HASH ?? LIVE.registry;
const VAULT = process.env.NEXT_PUBLIC_VAULT_CONTRACT_HASH ?? LIVE.vault;

function clean(hash: string | undefined): string {
  return (hash ?? "").replace(/^(hash-|entity-contract-|contract-|deploy-)/, "").trim();
}

function deployUrl(txHash: string | undefined): string | undefined {
  const h = clean(txHash);
  return h ? `${EXPLORER_BASE}/deploy/${h}` : undefined;
}

export const publicConfig = {
  explorerBase: EXPLORER_BASE,
  requestId: (process.env.NEXT_PUBLIC_REQUEST_ID ?? LIVE.requestId).trim(),
  registryConfigured: Boolean(clean(REGISTRY)),
  vaultConfigured: Boolean(clean(VAULT)),
  registryUrl: clean(REGISTRY) ? `${EXPLORER_BASE}/contract/${clean(REGISTRY)}` : undefined,
  vaultUrl: clean(VAULT) ? `${EXPLORER_BASE}/contract/${clean(VAULT)}` : undefined,
  attestTxUrl: deployUrl(process.env.NEXT_PUBLIC_ATTEST_TX_HASH ?? LIVE.attestTx),
  payTxUrl: deployUrl(process.env.NEXT_PUBLIC_PAYOUT_TX_HASH ?? LIVE.payTx),
  blockedTxUrl: deployUrl(process.env.NEXT_PUBLIC_BLOCKED_TX_HASH ?? LIVE.blockedTx)
};

// True when the dashboard can read genuine quorum state for a known request from chain.
export const liveQuorumConfigured = Boolean(publicConfig.registryConfigured && publicConfig.requestId);
