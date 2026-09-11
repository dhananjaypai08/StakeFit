import { AccountCreateTransaction, AccountId, Hbar, TransferTransaction } from "@hashgraph/sdk";
import type { HederaConfig } from "./config";
import { makeClient, parsePrivateKey } from "./config";

/**
 * x402 exact scheme requires a real transfer to payTo. If payTo is the same
 * account as the payer, Hedera nets the two legs to zero and the facilitator
 * rejects the payload. This creates a dedicated merchant account keyed by the
 * same operator key so checkout can pay a different account id.
 */
export async function createMerchantAccount(config: HederaConfig): Promise<string> {
  const client = makeClient(config);
  try {
    const key = parsePrivateKey(config.privateKey);
    const tx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const accountId = receipt.accountId;
    if (!accountId) throw new Error("Hedera did not return a merchant account id");
    return accountId.toString();
  } finally {
    client.close();
  }
}

export async function transferTinybars(
  config: HederaConfig,
  fromAccount: string,
  toAccount: string,
  tinybars: number,
): Promise<void> {
  if (tinybars <= 0) return;
  const client = makeClient(config);
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(fromAccount), Hbar.fromTinybars(-tinybars))
      .addHbarTransfer(AccountId.fromString(toAccount), Hbar.fromTinybars(tinybars))
      .execute(client);
    await tx.getReceipt(client);
  } finally {
    client.close();
  }
}
