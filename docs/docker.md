# Run with Docker

Run Casproof on any machine with Docker — no local Node toolchain required.

## One command

```bash
cp .env.example .env     # set REGISTRY_CONTRACT_HASH + CASPER_CHAIN_RPC after you deploy
docker compose up        # builds + starts the x402 verify server on :4021
```

Add the dashboard with the `ui` profile:

```bash
docker compose --profile ui up   # verify server (:4021) + Next.js dashboard (:3000)
```

## Services

| Service | Image | Port | Profile | What it runs |
|---|---|---|---|---|
| `verify` | `casproof-verify` | 4021 | default | `npm run x402:server` — the action-firewall verify gate (`GET /verify?hash=<outputHash>`) |
| `dashboard` | `casproof-dashboard` | 3000 | `ui` | `next start` — the verify dashboard (CSPR.click wallet) |

The dashboard is gated behind the `ui` profile so the default `docker compose up` stays minimal (just the verify server). It will not start unless you pass `--profile ui`.

## Configuration

All runtime config comes from a **root `.env`** (copy `.env.example`). Both services load it via Compose `env_file`, so it is mounted at run time and **never baked into an image**. After deploying the contract, set at least:

```dotenv
REGISTRY_CONTRACT_HASH=<bare hex contract hash>   # from `npm run resolve`
CASPER_CHAIN_RPC=https://node.testnet.casper.network/rpc
```

`X402_MODE` defaults to `sim`, so the verify server works out of the box. Switch to `live` (and set `CSPR_CLOUD_API_KEY` + `X402_PAY_TO`) once you wire up the hosted facilitator.

The root `.env` is optional at parse time (`required: false`), so `docker compose config` and `docker compose up` work before you create it — the verify server still starts in `sim` mode.

## Secrets never enter an image

- `.dockerignore` in the repo root, `agents/`, and `ui/` excludes `.env`, `.env.*` (except `.env.example`), `keys/`, and any `*.pem`/`*.key` from every build context.
- Testnet keys under `agents/keys/` stay on the host. The verify server reads chain state (no signing key needed); attesting/deploying still happens with the host `npm run` scripts.

## Healthcheck

The `verify` service is considered healthy when `GET /verify?hash=<64 hex>` returns `402` (payment required — the gate is alive and routing) or `200`. The check uses the in-image `node` binary, so it needs no extra packages.

```bash
docker compose ps        # STATUS shows (healthy) once the verify server is up
```

## Rebuild after code changes

```bash
docker compose build              # rebuild both images
docker compose up --build         # rebuild + run
```

## Notes

- `docker compose config` validates the file without building images — useful in CI.
- Images are based on `node:20-slim` and run as the non-root `node` user.
- The UI image is multi-stage (`deps` → `build` → `runtime`) and installs with `--legacy-peer-deps` because CSPR.click pins React 18 peers.
