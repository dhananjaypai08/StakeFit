# @stakefit/cre

The StakeFit confidential audit firewall, built as a Chainlink CRE Confidential Workflow.

## What runs inside the TEE

`src/workflow.ts` registers a confidential handler with `cre.handlerInTee`. Inside the hardware isolated enclave it:

1. fetches the OpenRouter API key with `runtime.getSecret`,
2. fetches the confidential severity rubric as a secret,
3. runs two independent LLM audits over the scan findings,
4. merges them into an ALLOW, DENY, or MANUAL_REVIEW verdict,
5. crosses back to the DON with `runtime.usingTheDons`,
6. delivers the verdict to `AuditRegistry.sol` on Sepolia.

## Simulate

From the repo root (you must already be logged in with `cre login`):

```bash
pnpm simulate:cre
```

That is the only simulate command. It loads the root `.env`, maps `DEPLOYER_PRIVATE_KEY` to `CRE_ETH_PRIVATE_KEY`, and runs the `audit-firewall` workflow against the `staging-settings` target.

`ethereum-testnet-sepolia` is already on `cre workflow supported-chains`. You do not need to pick another chain.
