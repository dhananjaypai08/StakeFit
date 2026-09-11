import {
  X402Facilitator,
  buildRequirements,
  createPaymentPayload,
  loadHederaConfig,
  makeClient,
  networkIdFor,
  toFacilitatorBody,
  type PaymentPayload,
  type PaymentRequirements,
} from "@stakefit/hedera";
import type { OrchestratorConfig } from "./config";

export interface PaymentOutcome {
  ok: boolean;
  open?: boolean;
  payer?: string;
  txHash?: string;
  message?: string;
}

/**
 * Build the x402 payment requirements the scan endpoint advertises in its 402
 * challenge. Price is metered by scan depth (pay per probe). Returns undefined
 * when Hedera is not configured, in which case the gate stays open for local
 * development.
 */
export async function buildAccepts(
  config: OrchestratorConfig,
  amountTinybars: number,
): Promise<PaymentRequirements | undefined> {
  if (!config.payToAccount) return undefined;
  const hedera = loadHederaConfig();
  const facilitator = new X402Facilitator(hedera.facilitatorUrl);
  const networkId = networkIdFor(hedera);
  const feePayer = await facilitator.feePayerFor(networkId);
  return buildRequirements({
    networkId,
    amountTinybars,
    payTo: config.payToAccount,
    feePayer,
  });
}

/**
 * Pay the 402 from the orchestrator's Hedera operator and settle through the
 * facilitator. This is the in-app checkout path so a human never leaves the UI.
 */
export async function settleOperatorPayment(
  requirements: PaymentRequirements,
): Promise<PaymentOutcome> {
  const hedera = loadHederaConfig();
  if (hedera.accountId === requirements.payTo) {
    return {
      ok: false,
      message:
        "SCAN_PAYTO_ACCOUNT must be a different Hedera account than HEDERA_ACCOUNT_ID. Run pnpm --filter @stakefit/hedera create-merchant and paste the printed id into .env.",
    };
  }
  const client = makeClient(hedera);
  try {
    const payload = await createPaymentPayload({
      client,
      requirements,
      payerAccountId: hedera.accountId,
      payerKey: hedera.privateKey,
    });
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    return await settlePayment(header, requirements);
  } finally {
    client.close();
  }
}

/** Verify then settle a submitted X-PAYMENT header through the facilitator. */
export async function settlePayment(
  header: string,
  requirements: PaymentRequirements,
): Promise<PaymentOutcome> {
  let payload: PaymentPayload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
  } catch {
    return { ok: false, message: "malformed X-PAYMENT header" };
  }

  const hedera = loadHederaConfig();
  const facilitator = new X402Facilitator(hedera.facilitatorUrl);
  const body = toFacilitatorBody(payload, requirements);

  const verification = await facilitator.verify(body);
  if (!verification.isValid) {
    return { ok: false, message: verification.invalidMessage ?? verification.invalidReason ?? "payment invalid" };
  }
  const settlement = await facilitator.settle(body);
  if (!settlement.success) {
    return {
      ok: false,
      message:
        settlement.message ?? settlement.errorMessage ?? settlement.errorReason ?? "settlement failed",
      payer: verification.payer,
    };
  }
  return { ok: true, payer: verification.payer, txHash: settlement.transaction };
}

/** Meter the scan price by requested depth. */
export function priceForDepth(config: OrchestratorConfig, depth: number): number {
  const steps = Math.max(1, Math.min(30, depth));
  return config.scanPriceTinybars * steps;
}
