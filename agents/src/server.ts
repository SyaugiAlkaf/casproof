import "dotenv/config";
import { createServer } from "node:http";
import { findAttestation, isTrusted, readQuorum, readAgreement } from "./casper.js";
import {
  challenge,
  decodePayment,
  facilitatorVerify,
  facilitatorSettle,
  paymentRequirements,
  settlementHeader,
  X402_MODE,
} from "./x402.js";

const PORT = Number(process.env.X402_PORT ?? 4021);
const JSON_HEADERS = { "content-type": "application/json" };

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/verify") {
    res.writeHead(404, JSON_HEADERS).end(JSON.stringify({ error: "not found" }));
    return;
  }

  const hash = (url.searchParams.get("hash") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    res.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: "hash query param must be a 64-hex output hash" }));
    return;
  }

  const reqId = url.searchParams.get("requestId");
  const resource = `${url.origin}${url.pathname}?hash=${hash}`;
  const reqs = paymentRequirements(resource);
  const paymentHeader = req.headers["x-payment"];

  // Verify-before-pay: the consumer must present a payment authorization before the gate
  // releases the on-chain attestation read. No payment header → 402 challenge.
  if (!paymentHeader) {
    res.writeHead(402, JSON_HEADERS).end(JSON.stringify(challenge(resource)));
    return;
  }

  let settlement: { success: boolean; transaction?: string; network?: string };
  try {
    const payload = decodePayment(String(paymentHeader));
    if (X402_MODE === "sim") {
      settlement = { success: true, transaction: `sim:${payload.payload?.nonce ?? "0"}`, network: payload.network };
    } else {
      if (!process.env.CSPR_CLOUD_API_KEY || !reqs.payTo) {
        res.writeHead(402, JSON_HEADERS).end(
          JSON.stringify({
            error: "live x402 unconfigured",
            reason: "set CSPR_CLOUD_API_KEY and X402_PAY_TO, fund the payer, and use the hosted facilitator (sponsored/early). Default X402_MODE=sim needs none of this.",
            accepts: [reqs],
          })
        );
        return;
      }
      const verified = await facilitatorVerify(payload, reqs);
      if (!verified.isValid) {
        res.writeHead(402, JSON_HEADERS).end(JSON.stringify({ error: "payment invalid", reason: verified.invalidReason, accepts: [reqs] }));
        return;
      }
      const settled = await facilitatorSettle(payload, reqs);
      if (!settled.success) {
        res.writeHead(402, JSON_HEADERS).end(JSON.stringify({ error: "settlement failed", reason: settled.errorReason, accepts: [reqs] }));
        return;
      }
      settlement = { success: true, transaction: settled.transaction, network: settled.network };
    }
  } catch (e) {
    res.writeHead(502, JSON_HEADERS).end(JSON.stringify({ error: `x402 settlement error: ${(e as Error).message}` }));
    return;
  }

  try {
    const record = await findAttestation(hash);
    const body: Record<string, unknown> = record
      ? { hash, attested: true, signer: record.signer, trusted: isTrusted(record.signer), source: record.source }
      : { hash, attested: false };
    if (reqId) {
      const winningHash = await readQuorum(reqId);
      const agreement = await readAgreement(reqId, hash);
      body.quorum = { quorumReached: winningHash !== null, winningHash, agreement };
    }
    res.writeHead(200, { ...JSON_HEADERS, "x-payment-response": settlementHeader(settlement) }).end(JSON.stringify(body));
  } catch (e) {
    res.writeHead(500, JSON_HEADERS).end(JSON.stringify({ error: `verification read failed: ${(e as Error).message}` }));
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => {
    console.log(`x402 verify endpoint: http://localhost:${PORT}/verify?hash=<outputHash>  (mode=${X402_MODE})`);
  });
}
