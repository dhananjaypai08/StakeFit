"use client";

import { Buffer } from "buffer";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export interface InvoiceRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { feePayer: string };
}

export function walletConnectConfigured(): boolean {
  return PROJECT_ID.length > 8;
}

type HederaAccountId = { toString: () => string };
type HederaSigner = {
  getAccountId: () => HederaAccountId;
  signTransaction: (tx: unknown) => Promise<{ toBytes: () => Uint8Array }>;
};
type WalletConnector = {
  signers: HederaSigner[];
  extensions: Array<{ id: string; name?: string; available: boolean }>;
  connectExtension: (id: string) => Promise<unknown>;
  openModal: () => Promise<unknown>;
  disconnectAll: () => Promise<void>;
  getSigner: (accountId: unknown) => HederaSigner;
};

let connectorPromise: Promise<WalletConnector> | null = null;

function asConnector(value: unknown): WalletConnector {
  return value as WalletConnector;
}

function accountIdFromSigners(signers: HederaSigner[]): string | undefined {
  const signer = signers.at(0);
  if (!signer) return undefined;
  return signer.getAccountId().toString();
}

async function getConnector(): Promise<WalletConnector> {
  if (typeof window === "undefined") throw new Error("Hedera wallet only works in the browser");
  if (!walletConnectConfigured()) {
    throw new Error("Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env (free at https://cloud.reown.com)");
  }
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  if (!connectorPromise) {
    connectorPromise = (async () => {
      const { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent } =
        await import("@hashgraph/hedera-wallet-connect");
      const { LedgerId } = await import("@hashgraph/sdk");
      const connector = new DAppConnector(
        {
          name: "StakeFit",
          description: "Pay-per-race distance markets",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.ico`],
        },
        LedgerId.TESTNET,
        PROJECT_ID,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.AccountsChanged, HederaSessionEvent.ChainChanged],
        [HederaChainId.Testnet],
      );
      await connector.init({ logger: "error" });
      return asConnector(connector);
    })();
  }
  return connectorPromise;
}

export async function restoreWalletAccount(): Promise<string | null> {
  try {
    const connector = await getConnector();
    return accountIdFromSigners(connector.signers) ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(opts?: { prompt?: boolean }): Promise<string> {
  const connector = await getConnector();
  const existing = accountIdFromSigners(connector.signers);
  if (existing && !opts?.prompt) return existing;

  const hashpack = connector.extensions.find((ext) => ext.available && /hashpack/i.test(`${ext.name ?? ""} ${ext.id}`));
  try {
    if (hashpack) await connector.connectExtension(hashpack.id);
  } catch (err) {
    console.warn("HashPack extension connect failed:", err instanceof Error ? err.message : err);
  }
  if (opts?.prompt || !accountIdFromSigners(connector.signers)) {
    await connector.openModal();
  }

  const connected = accountIdFromSigners(connector.signers);
  if (!connected) throw new Error("HashPack did not return an account. Approve the StakeFit session in the wallet.");
  return connected;
}

export async function disconnectWallet(): Promise<void> {
  const connector = await getConnector();
  if (connector.signers.length > 0) await connector.disconnectAll();
}

export async function signScanPayment(invoice: InvoiceRequirements, payerAccountId: string): Promise<string> {
  let account = (await connectWallet()) || payerAccountId;
  const connector = await getConnector();
  const { AccountId, Client, Hbar, TransactionId, TransferTransaction } = await import("@hashgraph/sdk");
  let signer: HederaSigner;
  try {
    signer = connector.getSigner(AccountId.fromString(account));
  } catch {
    await connector.disconnectAll().catch(() => undefined);
    account = await connectWallet();
    signer = connector.getSigner(AccountId.fromString(account));
  }
  const amount = BigInt(invoice.amount);
  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(account), Hbar.fromTinybars((-amount).toString()))
    .addHbarTransfer(AccountId.fromString(invoice.payTo), Hbar.fromTinybars(amount.toString()))
    .setTransactionId(TransactionId.generate(AccountId.fromString(invoice.extra.feePayer)));

  const client = invoice.network.includes("mainnet") ? Client.forMainnet() : Client.forTestnet();
  try {
    tx.freezeWith(client);
  } finally {
    client.close();
  }

  const signed = await signer.signTransaction(tx);
  return Buffer.from(signed.toBytes()).toString("base64");
}

export function encodeXPaymentHeader(invoice: InvoiceRequirements, signedTxBase64: string): string {
  const payload = {
    x402Version: 2,
    scheme: "exact" as const,
    network: invoice.network,
    accepted: invoice,
    payload: { transaction: signedTxBase64 },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}
