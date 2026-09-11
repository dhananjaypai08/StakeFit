/**
 * Autonomous paying client. Demonstrates a real x402 paid request end to end:
 * it hits the gated scan endpoint, receives the 402 challenge, builds and signs
 * a Hedera payment payload, and resends with the X-PAYMENT header.
 *
 * Usage: tsx src/scripts/pay-and-scan.ts https://example.com
 */
import "dotenv/config";
import {
  createPaymentPayload,
  loadHederaConfig,
  makeClient,
  type PaymentRequirements,
} from "@stakefit/hedera";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) throw new Error("usage: pay-and-scan <target-url> [contract]");
  const contract = process.argv[3];
  const orchestrator = process.env.ORCHESTRATOR_URL ?? "http://localhost:8787";

  // 1. Ask for the scan; expect a 402 with payment requirements.
  const challenge = await fetch(`${orchestrator}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, contract, depth: 8 }),
  });

  if (challenge.status !== 402) {
    const body = await challenge.json();
    console.log("Gate open or scan started without payment:", body);
    return;
  }

  const { accepts } = (await challenge.json()) as { accepts: PaymentRequirements[] };
  const requirements = accepts[0];
  console.log("402 challenge. Paying", requirements.amount, "tinybars to", requirements.payTo);

  // 2. Build and sign the payment payload.
  const config = loadHederaConfig();
  const client = makeClient(config);
  const payload = await createPaymentPayload({
    client,
    requirements,
    payerAccountId: config.accountId,
    payerKey: config.privateKey,
  });
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  client.close();

  // 3. Resend with the X-PAYMENT header.
  const paid = await fetch(`${orchestrator}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": header },
    body: JSON.stringify({ target, contract, depth: 8 }),
  });
  const result = await paid.json();
  console.log("Paid scan response:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
