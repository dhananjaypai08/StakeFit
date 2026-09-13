import {
  Client,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
} from "@hashgraph/sdk";
import type { HederaConfig } from "./config";
import { parsePrivateKey } from "./config";

/**
 * Create the soulbound audit certificate collection. Soulbound is enforced with
 * a freeze key and freezeDefault true: minted certificates stay frozen and
 * cannot be transferred, so a certificate is permanently bound to its holder.
 */
export async function createSoulboundToken(
  client: Client,
  config: HederaConfig,
  opts?: { name?: string; symbol?: string },
): Promise<string> {
  const operatorKey = parsePrivateKey(config.privateKey);
  const tx = await new TokenCreateTransaction()
    .setTokenName(opts?.name ?? "StakeFit Run ID")
    .setTokenSymbol(opts?.symbol ?? "SFIT")
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(config.accountId)
    .setSupplyKey(operatorKey.publicKey)
    .setFreezeKey(operatorKey.publicKey)
    .setFreezeDefault(true)
    .setTokenMemo("StakeFit soulbound run ID")
    .freezeWith(client)
    .sign(operatorKey);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.tokenId) throw new Error("token creation returned no tokenId");
  return receipt.tokenId.toString();
}

export interface CertificateMetadata {
  scanId?: string;
  target?: string;
  verdict?: string;
  score?: number;
  reportCid?: string;
  /** Human-readable run summary used when IPFS is unavailable. Max 100 bytes on HTS. */
  memo?: string;
}

/**
 * Mint one run NFT. On-chain metadata is HIP-412 `ipfs://CID` when pinned,
 * otherwise a short StakeFit run memo.
 */
export async function mintCertificate(
  client: Client,
  config: HederaConfig,
  tokenId: string,
  metadata: CertificateMetadata,
): Promise<{ serial: string; txId: string }> {
  const operatorKey = parsePrivateKey(config.privateKey);
  const pointer = (
    metadata.reportCid
      ? `ipfs://${metadata.reportCid}`
      : metadata.memo || `StakeFit ${metadata.target ?? "run"} ${metadata.score ?? ""}`.trim()
  ).slice(0, 100);
  const tx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .addMetadata(Buffer.from(pointer))
    .freezeWith(client)
    .sign(operatorKey);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const serial = receipt.serials?.[0];
  if (serial === undefined) throw new Error("mint returned no serial");
  return { serial: serial.toString(), txId: response.transactionId.toString() };
}
