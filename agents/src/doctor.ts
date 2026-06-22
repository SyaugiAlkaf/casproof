import "dotenv/config";
import { existsSync } from "node:fs";
import {
  pingNode,
  contractReachable,
  balanceMotes,
  accountHashOf,
  rpcUrl,
  registryHash,
  vaultHash,
  network,
} from "./casper.js";
import { modelAgents, quorumThreshold } from "./producer.js";
import { pingProvider } from "./providers.js";
import { X402_MODE } from "./x402.js";

type Level = "PASS" | "WARN" | "FAIL";
const MIN_NODE_MAJOR = 20;

const lines: Array<{ level: Level; label: string; detail: string }> = [];
function record(level: Level, label: string, detail: string) {
  lines.push({ level, label, detail });
}

async function safe(label: string, fn: () => Promise<{ level: Level; detail: string }>) {
  try {
    const { level, detail } = await fn();
    record(level, label, detail);
  } catch (e) {
    record("FAIL", label, e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  record(
    major >= MIN_NODE_MAJOR ? "PASS" : "FAIL",
    "node version",
    `${process.version} (need >= ${MIN_NODE_MAJOR} for global fetch)`
  );

  record(existsSync(".env") ? "PASS" : "WARN", ".env present", existsSync(".env") ? ".env found" : ".env missing — using process env / defaults");

  await safe("rpc reachable", async () => {
    if (!rpcUrl) return { level: "FAIL", detail: "CASPER_CHAIN_RPC / CASPER_NODE_URL not set" };
    const status = await pingNode();
    const level: Level = status.chainName === network ? "PASS" : "WARN";
    return { level, detail: `${rpcUrl} → ${status.chainName} (api ${status.apiVersion}), expected ${network}` };
  });

  await safe("registry contract", async () => {
    if (!registryHash) return { level: "FAIL", detail: "REGISTRY_CONTRACT_HASH not set — deploy + resolve first" };
    await contractReachable();
    return { level: "PASS", detail: `resolvable on-chain (${registryHash.slice(0, 16)}…)` };
  });

  record(
    vaultHash ? "PASS" : "WARN",
    "vault contract",
    vaultHash ? `VAULT_CONTRACT_HASH set (${vaultHash.slice(0, 16)}…)` : "VAULT_CONTRACT_HASH not set — on-chain payout gate disabled"
  );

  const agents = modelAgents();
  const threshold = quorumThreshold(agents);
  record(
    threshold >= 1 && threshold <= agents.length ? "PASS" : "FAIL",
    "quorum threshold",
    `threshold ${threshold} of ${agents.length} agents`
  );

  for (const agent of agents) {
    if (!existsSync(agent.keyPath)) {
      record("FAIL", `key ${agent.modelId}`, `missing at ${agent.keyPath} — run keygen:quorum`);
      continue;
    }
    await safe(`key ${agent.modelId}`, async () => {
      if (!rpcUrl) {
        return { level: "WARN", detail: `${agent.keyPath} present; balance unread (RPC unset)` };
      }
      let motes: bigint;
      try {
        motes = await balanceMotes(agent.keyPath);
      } catch (e) {
        const msg = (e as Error).message.toLowerCase();
        if (msg.includes("purse not found") || msg.includes("-32026")) motes = 0n;
        else throw e;
      }
      const cspr = Number(motes) / 1e9;
      const level: Level = motes > 0n ? "PASS" : "WARN";
      return { level, detail: `${accountHashOf(agent.keyPath)} — ${cspr} CSPR${motes > 0n ? "" : " (fund at the faucet)"}` };
    });
  }

  for (const agent of agents) {
    const ping = await pingProvider(agent);
    record(ping.ok ? "PASS" : "WARN", `provider ${agent.modelId} (${agent.provider})`, ping.detail);
  }

  record("PASS", "x402 mode", `${X402_MODE}${X402_MODE === "sim" ? " (local handshake, works out of the box)" : " (settles via hosted facilitator)"}`);

  const icon: Record<Level, string> = { PASS: "+", WARN: "!", FAIL: "x" };
  console.log("Casproof preflight\n");
  for (const l of lines) console.log(`  [${icon[l.level]}] ${l.level.padEnd(4)} ${l.label.padEnd(34)} ${l.detail}`);

  const fails = lines.filter((l) => l.level === "FAIL").length;
  const warns = lines.filter((l) => l.level === "WARN").length;
  console.log(`\n${fails} fail, ${warns} warn, ${lines.length - fails - warns} pass`);
  if (fails > 0) console.log("FAIL items block a live run; WARN items still let the offline demo work.");
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("doctor crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
