# World Selfie Check — hackathon feedback

StakeFit uses Selfie Check as a **fairness / abuse-prevention** gate before a Hedera HTS run ID can mint. The selfie is not used for identity display. It only proves a live person is claiming the Fitbit time.

## Docs and integration flow

- Selfie Check (Beta) is documented under credentials as `selfieCheckLegacy`, while the shipped `@worldcoin/idkit` widget still centers `app_id` + `action` + `verification_level`.
- The older `POST /api/v2/verify` shape and the v4 `developer.world.org/api/v4/verify/{rpId}` path both appear in docs. We send the IDKit proof to v4 when `WORLD_RP_ID` is set.
- `rp_context` for World ID 4.0 is a second backend signing step that is easy to miss when you already have an `app_id` and action.

## Developer Portal

- Creating an action named `stakefit-run` is clear once you are inside the app.
- Finding Selfie Check vs Proof of Human vs Device is not obvious from search. “Selfie Check” does not always surface the sandbox testing page first.
- Test-user and sandbox-app state (ready / proof issued / expired) is hard to see without the separate sandbox testing doc.

## Sandbox, proofs, test users

- Anyone with the World App can complete Selfie Check. That is the right bar for a race certificate.
- Empty proof bodies fail with “nullifier required”. The widget must forward `nullifier_hash`, `merkle_root`, and `proof`.
- When `WORLD_APP_ID` is unset we refuse to pretend the check passed (`world:skipped` is only a local fallback, not a verified human).

## What was confusing or missing

- Whether Device verification_level is accepted as Selfie Check–compatible for this bounty.
- How to enable Selfie Check (Beta) on an unverified app (`developers@toolsforhumanity.com`).
- AgentKit / AgentBook is a separate product. We did not need it for a human vs sock-puppet race mint, but the prize page mixes AgentKit Continuity with Selfie Check.
