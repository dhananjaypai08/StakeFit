<p align="center">
  <img src="apps/web/public/logo.png" alt="StakeFit" width="44" />
</p>

<h1 align="center">StakeFit</h1>

<p align="center">Daily Fitbit distance races. Enter in HBAR. Fastest pace takes the pot.</p>

You pick a distance and pay to enter. We score a session you already logged and hide other times until the day closes. Top three split the pot 50 / 30 / 20.

Live at [stakefit-ethglobal.vercel.app](https://stakefit-ethglobal.vercel.app).

## How a race works

1. Sign in with Google so we can read Fitbit.
2. Pay the entry from HashPack.
3. Cover the race distance today.
4. After resolve: selfie, claim HBAR, mint a run card.

Score is pace over the catalog distance, not the full session.

## Architecture

```mermaid
flowchart LR
  subgraph you[You]
    Fitbit[Fitbit session]
    Wallet[HashPack]
    Selfie[Selfie Check]
  end

  subgraph stakefit[StakeFit]
    Health[Google Health]
    Orch[Orchestrator]
    CRE[Chainlink CRE]
  end

  subgraph chain[Onchain]
    Market[onchain Market]
    Pot[HBAR pot]
    Trail[HCS trail]
    Card[HTS run card]
  end

  Fitbit -->|"session"| Health
  Health -->|"pace over the distance"| Orch
  Wallet -->|"x402 entry"| Orch
  Orch -->|"time only"| CRE
  CRE -->|"score"| Market
  Orch -->|"enter and resolve"| Market
  Orch -->|"payout"| Pot
  Orch -->|"every step"| Trail
  Selfie -->|"live person"| Orch
  Orch -->|"mint"| Card
```

| Piece | Role |
| --- | --- |
| Hedera | x402 entry, HCS trail, HTS run card, HBAR payouts |
| Sepolia | Race ledger |
| Chainlink CRE | Score leaves as time only |
| World | Live person before claim or mint |

## Local

```bash
cp .env.example .env
pnpm install
pnpm dev:orchestrator
pnpm dev:web
```

MIT
