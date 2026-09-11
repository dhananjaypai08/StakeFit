import "dotenv/config";
import { createMerchantAccount, loadHederaConfig } from "../index";

async function main(): Promise<void> {
  const config = loadHederaConfig();
  const accountId = await createMerchantAccount(config);
  console.log("Merchant pay-to account created. Payer and payTo must differ for x402.");
  console.log(`SCAN_PAYTO_ACCOUNT=${accountId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
