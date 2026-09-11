/**
 * Agent payer for Hedera x402. Discovers the 402 on POST /markets/:id/enter
 * and settles it with the operator key — the same dance a Cursor/MCP agent
 * would run in the demo.
 */
import { loadConfig } from "../config";
import { buildAccepts, settleOperatorPayment } from "../x402gate";

async function main(): Promise<void> {
  const marketId = process.argv[2];
  if (!marketId) throw new Error("usage: pnpm --filter @stakefit/orchestrator pay-and-enter <marketId>");
  const config = loadConfig();
  const base = `http://127.0.0.1:${config.port}`;
  const first = await fetch(`${base}/markets/${marketId}/enter`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: process.env.STAKEFIT_COOKIE ?? "" },
    body: JSON.stringify({ hederaAccount: process.env.HEDERA_ACCOUNT_ID }),
  });
  if (first.status !== 402) {
    console.log(await first.text());
    return;
  }
  const challenge = (await first.json()) as { accepts: Parameters<typeof settleOperatorPayment>[0][] };
  const accepts = challenge.accepts[0] ?? (await buildAccepts(config, config.scanPriceTinybars));
  if (!accepts) throw new Error("no payment requirements");
  const paid = await settleOperatorPayment(accepts);
  if (!paid.ok || !paid.txHash) throw new Error(paid.message ?? "operator pay failed");
  const header = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: "exact",
      network: accepts.network,
      accepted: accepts,
      payload: { transaction: paid.txHash },
    }),
  ).toString("base64");
  const retry = await fetch(`${base}/markets/${marketId}/enter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": header,
      cookie: process.env.STAKEFIT_COOKIE ?? "",
    },
    body: JSON.stringify({ hederaAccount: process.env.HEDERA_ACCOUNT_ID }),
  });
  console.log(retry.status, await retry.text());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
