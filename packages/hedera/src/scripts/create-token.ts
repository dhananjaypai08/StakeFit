import "dotenv/config";
import { createSoulboundToken, loadHederaConfig, makeClient } from "../index";

async function main(): Promise<void> {
  const config = loadHederaConfig();
  const client = makeClient(config);
  const tokenId = await createSoulboundToken(client, config);
  console.log("Soulbound certificate token created.");
  console.log(`HTS_CERTIFICATE_TOKEN_ID=${tokenId}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
