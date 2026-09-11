import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";

/** Create the HCS topic that holds the tamper evident audit trail. */
export async function createAuditTopic(client: Client, memo = "StakeFit audit trail"): Promise<string> {
  const tx = new TopicCreateTransaction().setTopicMemo(memo);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.topicId) throw new Error("topic creation returned no topicId");
  return receipt.topicId.toString();
}

/**
 * Append one action to the audit trail. Every meaningful agent step is logged
 * here, giving each scan an immutable, timestamped, verifiable record.
 */
export async function logAction(
  client: Client,
  topicId: string,
  entry: Record<string, unknown>,
): Promise<{ sequenceNumber: string }> {
  const message = JSON.stringify({ ...entry, at: entry.at ?? Date.now() });
  const tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const seq = receipt.topicSequenceNumber;
  if (seq === undefined || seq === null) throw new Error("submit returned no sequence number");
  return { sequenceNumber: seq.toString() };
}
