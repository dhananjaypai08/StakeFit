import {
  AccountId,
  Client,
  Hbar,
  TransactionId,
  TransferTransaction,
} from "@hashgraph/sdk";
import type { HederaConfig } from "./config";
import { parsePrivateKey } from "./config";

/**
 * x402 v2 payment types as accepted by the Blocky402 facilitator on Hedera.
 * The wire format mirrors what the @x402/hedera ExactHederaScheme produces; we
 * build it natively with the Hedera SDK so the orchestrator has no hard runtime
 * dependency on the client scheme package.
 */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { feePayer: string };
}

export interface PaymentPayload {
  x402Version: 2;
  scheme: "exact";
  network: string;
  accepted: PaymentRequirements;
  payload: { transaction: string };
}

export interface FacilitatorBody {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface SupportedKind {
  network: string;
  extra?: { feePayer?: string };
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  signers?: Record<string, string[]>;
}

export interface VerifyResponse {
  isValid: boolean;
  payer?: string;
  invalidMessage?: string;
  invalidReason?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction?: string;
  errorReason?: string;
  errorMessage?: string;
  message?: string;
}

const HEDERA_NETWORK_ID: Record<string, string> = {
  testnet: "hedera:testnet",
  mainnet: "hedera:mainnet",
  previewnet: "hedera:previewnet",
};

export class X402Facilitator {
  constructor(private readonly baseUrl: string) {}

  async supported(): Promise<SupportedResponse> {
    const res = await fetch(`${this.baseUrl}/supported`);
    if (!res.ok) throw new Error(`facilitator /supported failed: ${res.status}`);
    return (await res.json()) as SupportedResponse;
  }

  /** Discover the fee payer the facilitator advertises for a given network id. */
  async feePayerFor(networkId: string): Promise<string> {
    const supported = await this.supported();
    const kind = supported.kinds.find((k) => k.network === networkId);
    const feePayer = kind?.extra?.feePayer ?? supported.signers?.["hedera:*"]?.[0];
    if (!feePayer) throw new Error(`facilitator does not advertise ${networkId}`);
    return feePayer;
  }

  async verify(body: FacilitatorBody): Promise<VerifyResponse> {
    const res = await fetch(`${this.baseUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`facilitator /verify failed: ${res.status}`);
    return (await res.json()) as VerifyResponse;
  }

  async settle(body: FacilitatorBody): Promise<SettleResponse> {
    const res = await fetch(`${this.baseUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`facilitator /settle failed: ${res.status}`);
    return (await res.json()) as SettleResponse;
  }
}

export function networkIdFor(config: HederaConfig): string {
  return HEDERA_NETWORK_ID[config.network] ?? "hedera:testnet";
}

/**
 * Build the payment requirements a service advertises in its 402 challenge.
 * amountTinybars is metered by the caller (pay per probe).
 */
export function buildRequirements(params: {
  networkId: string;
  amountTinybars: number;
  payTo: string;
  feePayer: string;
  asset?: string;
  maxTimeoutSeconds?: number;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: params.networkId,
    amount: String(params.amountTinybars),
    payTo: params.payTo,
    maxTimeoutSeconds: params.maxTimeoutSeconds ?? 300,
    asset: params.asset ?? "0.0.0",
    extra: { feePayer: params.feePayer },
  };
}

/**
 * Client side: build a partially signed HBAR TransferTransaction and return the
 * full x402 v2 PaymentPayload. The facilitator fee payer co-signs and submits at
 * settlement time. This is what an autonomous paying agent runs.
 */
export async function createPaymentPayload(params: {
  client?: Client;
  requirements: PaymentRequirements;
  payerAccountId: string;
  payerKey: string;
}): Promise<PaymentPayload> {
  const { requirements, payerAccountId, payerKey } = params;
  const amount = BigInt(requirements.amount);
  const feePayer = AccountId.fromString(requirements.extra.feePayer);

  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(payerAccountId), Hbar.fromTinybars((-amount).toString()))
    .addHbarTransfer(AccountId.fromString(requirements.payTo), Hbar.fromTinybars(amount.toString()))
    .setTransactionId(TransactionId.generate(feePayer));

  // Freeze on a client with no operator. An operator-bound client can attach
  // extra signatures or a 300s valid duration that Hedera then rejects.
  const freezeClient = requirements.network.includes("mainnet") ? Client.forMainnet() : Client.forTestnet();
  try {
    tx.freezeWith(freezeClient);
    const signed = await tx.sign(parsePrivateKey(payerKey));
    const base64 = Buffer.from(signed.toBytes()).toString("base64");
    return {
      x402Version: 2,
      scheme: "exact",
      network: requirements.network,
      accepted: requirements,
      payload: { transaction: base64 },
    };
  } finally {
    freezeClient.close();
  }
}

export function toFacilitatorBody(payload: PaymentPayload, requirements: PaymentRequirements): FacilitatorBody {
  return { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements };
}
