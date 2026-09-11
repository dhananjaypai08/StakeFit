import "dotenv/config";
import { createAuditTopic, loadHederaConfig, makeClient } from "../index";

async function main(): Promise<void> {
  const config = loadHederaConfig();
  const client = makeClient(config);
  const topicId = await createAuditTopic(client);
  console.log("Audit trail topic created.");
  console.log(`HCS_AUDIT_TOPIC_ID=${topicId}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
