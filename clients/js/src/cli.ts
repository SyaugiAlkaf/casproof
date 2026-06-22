import { outputHash, promptHash } from "./hashing.js";
import { Casproof, DEFAULT_ENDPOINT } from "./client.js";

function fail(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`--payload must be valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;

  if (cmd === "hash") {
    const prompt = flag(args, "--prompt");
    const payload = flag(args, "--payload");
    if (prompt === undefined || payload === undefined) fail("hash needs --model, --prompt and --payload");
    process.stdout.write(
      JSON.stringify({ outputHash: outputHash(parsePayload(payload)), promptHash: promptHash(prompt) }, null, 2) + "\n"
    );
    return 0;
  }

  if (cmd === "verify") {
    const endpoint = flag(args, "--endpoint") ?? DEFAULT_ENDPOINT;
    const requestId = flag(args, "--request-id");
    const hash = flag(args, "--hash");
    const model = flag(args, "--model");
    const prompt = flag(args, "--prompt");
    const payload = flag(args, "--payload");

    const client = new Casproof(endpoint);
    let d;
    if (hash) {
      d = await client.verifyHash(hash, requestId);
    } else if (model && prompt && payload !== undefined) {
      d = await client.verifyOutput(model, prompt, parsePayload(payload), requestId);
    } else {
      fail("verify needs either --hash or all of --model/--prompt/--payload");
    }
    process.stdout.write(
      JSON.stringify(
        {
          hash: d.hash,
          attested: d.attested,
          decision: d.decision,
          quorumReached: d.quorumReached ?? null,
          agreement: d.agreement ?? null,
          signer: d.signer ?? null,
          error: d.error ?? null,
        },
        null,
        2
      ) + "\n"
    );
    return d.proceed ? 0 : 1;
  }

  fail("usage: casproof <hash|verify> ...");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => fail(e instanceof Error ? e.message : String(e))
);
