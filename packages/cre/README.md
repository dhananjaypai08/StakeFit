# @stakefit/cre

Chainlink CRE Confidential Workflows for StakeFit.

## What CRE is for

The enclave **holds credentials**. Google Health / Fitbit refresh and access tokens, plus any scoring secrets, are fetched with `runtime.getSecret` inside the TEE. They are never written to the public race board or to Sepolia.

The only value that leaves the enclave is the **scored time** (`timeMs` + `exerciseId`). That is what the orchestrator submits on-chain and what Hedera pays against.

## Workout ingest

`workout-ingest/workflow.ts` registers `handlerInTee`. Inside the enclave it:

1. loads `GOOGLE_REFRESH_TOKEN` and `GOOGLE_HEALTH_ACCESS_TOKEN` from the Vault DON,
2. loads any other scoring secret (`OPENROUTER_API_KEY` if a model is used),
3. reads the runner’s sessions,
4. keeps the fastest qualifying `activeDuration` for that day’s distance,
5. returns only `{ timeMs, exerciseId }` to the DON.

Live scoring in the orchestrator uses the same function (`ingestWorkout`) so a demo still works when CRE is not deployed. `pnpm simulate:cre` runs this workflow first.

## Audit firewall

`src/workflow.ts` is the older confidential audit path (OpenRouter rubric + `AuditRegistry` on Sepolia). Simulate still runs it after workout-ingest.

## Simulate

```bash
pnpm simulate:cre
```
