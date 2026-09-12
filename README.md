# StakeFit

Daily distance heats. A Fitbit Air syncs through the phone into Google Health. You pay to enter with x402 on Hedera. Sepolia records the market so The Graph, Substreams, CRE, and VRF can read it. After the workout you can run a World Selfie Check and mint a soulbound run ID. The pot (minus house) pays **50 / 30 / 20** in HBAR to the top three Hedera accounts.

This guide is the **live** path only. Leave `HEALTH_MOCK=false` and `SCAN_SKIP_PAYMENT=false`. Dev login is disabled when mock is off.

## What you will run

1. Google OAuth with Health API access (real Fitbit Air after a phone sync).
2. HashPack paying a distinct Hedera merchant account (x402 / Blocky402).
3. `StakeFitMarket` on Sepolia (`MARKET_REGISTRY_ADDRESS`).
4. HTS soulbound run-ID token and an HCS trail on Hedera.
5. Web at `http://localhost:3000` talking to the orchestrator at `http://localhost:8787`.

A session qualifies when it **starts inside the heat window** and `distanceMillimeters` is at least the catalog distance. Score is the **lowest** `activeDuration` (paused time excluded), not the latest session. Catalog: **50m (demo)**, 200m, 5k, 10k. Default grace after `end` is 15 minutes.

## Prerequisites

- Node.js 20+ and pnpm 9+ (`corepack enable` is enough).
- Foundry (`forge`, `cast`) for Sepolia.
- A **Fitbit Air** paired to your phone, with the Fitbit or Google Health app able to sync.
- A Google account you can add as a GCP **test user**.
- A Hedera **testnet** account with HBAR ([portal.hedera.com](https://portal.hedera.com)).
- A Sepolia deployer wallet with test ETH.
- A free [Pinata](https://pinata.cloud) JWT (IPFS pin for the run-ID card).
- A free [WalletConnect / Reown](https://cloud.reown.com) project id (HashPack modal).
- Optional: The Graph Studio deploy key, a Chainlink VRF v2.5 Sepolia subscription, a World App id for Selfie Check, CRE CLI.

Do not pay for Google CASA. An unverified GCP app in Testing with up to 100 test users is enough.

## 1. Install

```bash
git clone <this-repo>
cd ethglobal2026
pnpm install
cp .env.example .env
```

Never commit `.env`.

## 2. Fill `.env` before the first boot

Set these now. Addresses printed by later commands get pasted back into the same file.

```bash
# Live flags (required)
HEALTH_MOCK=false
SCAN_SKIP_PAYMENT=false
SESSION_SECRET=<long random string>
ADMIN_EMAILS=you@gmail.com
PUBLIC_WEB_URL=http://localhost:3000
GOOGLE_REDIRECT_URI=http://localhost:8787/auth/google/callback

# Frontend
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8787
NEXT_PUBLIC_ORCHESTRATOR_WS_URL=ws://localhost:8787
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown project id>

# Hedera operator (pays gas for mint / HCS / merchant create, not user entries)
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.xxxx
HEDERA_PRIVATE_KEY=<hex or DER>
BLOCKY402_FACILITATOR_URL=https://api.testnet.blocky402.com

# Sepolia
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<key>
DEPLOYER_PRIVATE_KEY=0x<64 hex>

# IPFS
PINATA_JWT=<jwt>
```

`ADMIN_EMAILS` must include the Google account you will use to create and resolve heats. `SCAN_PAYTO_ACCOUNT` must stay empty until step 5: it **must not** equal `HEDERA_ACCOUNT_ID` or x402 rejects the payment.

## 3. Google Health OAuth (Fitbit Air)

StakeFit reads `GET https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints` and `pairedDevices` after the phone syncs. There is no live-from-wrist stream.

1. Create a GCP project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable the **Google Health API** (`health.googleapis.com`).
3. APIs & Services → OAuth consent screen:
   - User type **External**.
   - Publishing status **Testing**.
   - Add your Gmail (and any demo judges) under **Test users**.
   - Scopes: `openid`, `email`, `profile`, and  
     `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
4. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000`, `http://localhost:8787`.
   - Authorized redirect URI: `http://localhost:8787/auth/google/callback`.
5. Paste the client id and secret:

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

6. On the phone: pair the Fitbit Air, complete a walk, then open the Fitbit or Google Health app so the session appears before you hit **Sync now** in StakeFit.

Optional CLI check after you have a refresh token (the first browser login requests `access_type=offline` and `prompt=consent`):

```bash
# After one successful Google login you can copy the refresh token into .env
GOOGLE_REFRESH_TOKEN=
pnpm probe:health
```

`probe:health` prints paired devices and recent exercises. It exits 2 if `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing. It never prints tokens.

## 4. WalletConnect

Create a project at [cloud.reown.com](https://cloud.reown.com). Put the project id in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Restart the web app after changing it. HashPack on Hedera testnet is the wallet used in the demo.

## 5. Hedera artifacts

Operator key creates the soulbound token, the HCS topic, and (if needed) a **merchant** account that receives entry HBAR.

```bash
pnpm setup:hedera
```

Paste the printed lines into `.env`:

```bash
HTS_CERTIFICATE_TOKEN_ID=0.0.xxxx
HCS_AUDIT_TOPIC_ID=0.0.xxxx
SCAN_PAYTO_ACCOUNT=0.0.xxxx
```

`SCAN_PAYTO_ACCOUNT` is a different account than `HEDERA_ACCOUNT_ID`, keyed by the same operator key. That is required: Hedera nets two legs to the same account to zero and Blocky402 rejects the payload.

Fund the merchant with a little testnet HBAR if you will pay winners from that pot. Entry payments from HashPack land on `SCAN_PAYTO_ACCOUNT`.

## 6. Sepolia: `StakeFitMarket`

```bash
pnpm deploy:contracts
```

The script sources the root `.env`, broadcasts one transaction at a time, and reuses any address already set. Paste **all** printed addresses back into `.env`, especially:

```bash
MARKET_REGISTRY_ADDRESS=0x...
OBSERVATION_LOG_ADDRESS=0x...
AUDIT_REGISTRY_ADDRESS=0x...
ENS_AUDIT_RESOLVER_ADDRESS=0x...
ENS_REGISTRAR_ADDRESS=0x...
```

`MARKET_REGISTRY_ADDRESS` is the StakeFit source of truth. The Graph, Substreams, CRE, and VRF consume it. Restart the orchestrator after editing `.env`.

Optional VRF v2.5 on Sepolia (admin can still **Resolve now** without it):

```bash
VRF_COORDINATOR=0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B
VRF_SUBSCRIPTION_ID=
VRF_KEY_HASH=
```

Optional Etherscan verify after `ETHERSCAN_API_KEY` is set:

```bash
cd contracts
forge verify-contract $MARKET_REGISTRY_ADDRESS src/StakeFitMarket.sol:StakeFitMarket --chain sepolia --via-ir
```

## 7. The Graph (optional but needed for `/graph/markets`)

1. Put the deployed `MARKET_REGISTRY_ADDRESS` and a real `startBlock` into `subgraph/subgraph.yaml`.
2. From the repo root, with `SUBGRAPH_STUDIO_DEPLOY_KEY` in `.env`:

```bash
pnpm deploy:subgraph
```

3. Publish in Subgraph Studio, then set:

```bash
STAKEFIT_SUBGRAPH_QUERY_URL=https://...
GRAPH_GATEWAY_API_KEY=
```

Until that URL is set, the orchestrator falls back to its local market list.

## 8. World Selfie Check (optional)

Leave both empty to skip verification and mint with `world:skipped`. To enforce a real selfie after the workout:

```bash
WORLD_APP_ID=
WORLD_RP_ID=
```

The orchestrator POSTs the proof to `https://developer.world.org/api/v4/verify/{WORLD_RP_ID}` when `WORLD_APP_ID` is set.

## 9. Start the live apps

Two terminals from the repo root. Do **not** export `HEALTH_MOCK` or `SCAN_SKIP_PAYMENT`.

```bash
pnpm dev:orchestrator
```

```bash
pnpm dev:web
```

Confirm `GET http://localhost:8787/health` returns `stakefit-orchestrator`. Open [http://localhost:3000](http://localhost:3000).

## 10. First live heat

1. **Sign in** → **Continue with Google** (the GCP test user, same address as `ADMIN_EMAILS`).
2. You land on **Connect**. Device and last sync stay empty until a workout has synced.
3. **Admin** → create a heat (50m for a short outdoor demo). Window starts now and lasts one hour, grace 15 minutes, default house 10% (`1000` bps), default entry `10000` tinybars.
4. Open the market → **Enter**. Connect HashPack when asked. Approve the x402 HBAR transfer to `SCAN_PAYTO_ACCOUNT`.
5. Walk at least the catalog distance. The session **start** must fall inside `[start, end]`.
6. Open the Fitbit or Google Health app on the phone and wait until the session is uploaded.
7. **Connect** → **Sync now**. The orchestrator pulls Health v4 exercise points, keeps the best qualifying time, and writes `ResultSubmitted` on Sepolia (hidden heats emit `timeMs=0` publicly; you still see your own time on **History**).
8. After the workout, on the market page, run Selfie Check (or the skip path) and mint the HTS run ID. Pinata stores the card; token metadata is `ipfs://<cid>` (100 bytes on HTS).
9. **Admin** → **Resolve now**. Top three Hedera accounts are paid 50 / 30 / 20 of `(pot - house)`. Leftover ranks go to the house. The same path writes HCS.

Agent-style enter (operator key settles the 402, same as a Cursor / MCP payer) with the orchestrator already running and a session cookie:

```bash
STAKEFIT_COOKIE='stakefit_session=...' pnpm pay-and-enter <marketId>
```

## Qualifying rules (so the sync is not empty)

- Heat status must be `open`, `grace`, or `resolving`.
- You must already have paid to enter.
- `exercise` session `startMs` is inside `[market.startMs, market.endMs]`.
- `distanceMillimeters >=` catalog (50_000 for 50m, 200_000, 5_000_000, 10_000_000).
- Score = lowest `activeDuration`. Ties use the VRF seed when one is set.
- Hidden leaderboard: other people see no times until resolve. You always see your own on History.

## Tests

```bash
pnpm test:stakefit
cd contracts && forge test --match-contract StakeFitMarketTest
```

## Hosted deploy

Orchestrator on Railway (`railway.toml` + `apps/orchestrator/Dockerfile`). Web on Vercel (`vercel.json`). CRE and VRF stay on Chainlink; they are not hosted on Vercel.

1. `railway login` and `vercel login`.
2. Deploy the orchestrator (`railway up --ci` from the repo root). Add a volume at `/data` so `STAKEFIT_STATE_PATH=/data/stakefit.json` survives restarts.
3. Copy backend keys from `.env` into Railway. Set `PUBLIC_WEB_URL` to the Vercel URL and `GOOGLE_REDIRECT_URI` to `https://<railway>/auth/google/callback`.
4. Deploy the web app (`vercel --yes`). Set `NEXT_PUBLIC_ORCHESTRATOR_URL`, `NEXT_PUBLIC_ORCHESTRATOR_WS_URL`, and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
5. On the GCP OAuth client add the Railway origin and redirect URI, plus the Vercel origin.
6. CRE: `cre login`, put the Railway URL into `packages/cre/workout-ingest/config.production.json`, then `cre workflow deploy workout-ingest --target production-settings`. Vault secrets stay in the TEE (`GOOGLE_*`, `CRE_INGEST_SECRET`).
7. VRF: `pnpm exec bash scripts/setup-vrf.sh`, fund the subscription at [vrf.chain.link](https://vrf.chain.link), paste `VRF_SUBSCRIPTION_ID` into Railway.
8. World Selfie Check needs `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, and `NEXT_PUBLIC_WORLD_APP_ID`. Leave them empty only for a first bring-up; the mint path will skip.

## Monorepo

```
apps/web              Next.js (login, connect, heats, admin, history)
apps/orchestrator     Google session, x402 enter, Health sync, resolve, SBT
packages/health       Google Health v4 client and qualify / rank
packages/shared       Distance catalog, pot split, market status
packages/hedera       x402, HTS run ID, HCS, merchant account
packages/cre          Confidential workout ingest (simulate allowed)
packages/ipfs         Pinata JSON / HTML pin
contracts             StakeFitMarket.sol plus ENS / observation stack
subgraph              StakeFitMarket subgraph
substreams            StakeFit Substreams stub
```

## License

MIT.
