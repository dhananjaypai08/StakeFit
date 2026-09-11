import { Contract, namehash, toUtf8Bytes, hexlify } from "ethers";
import { REGISTRAR_ABI, RESOLVER_ABI, ROLE_CAN_SET_TEXT } from "./abis";
import { type EnsConfig, makeProvider, makeWallet } from "./config";

export * from "./config";
export * from "./abis";

export interface AgentIdentity {
  label: string;
  name: string;
  owner: string;
  resolver: string;
  tokenId: string;
  expiry: number;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/** Derive the audit subname label for a target, for example acme-com. */
export function targetLabel(target: string): string {
  try {
    const url = new URL(target.includes("://") ? target : `https://${target}`);
    return slug(url.hostname);
  } catch {
    return slug(target);
  }
}

/**
 * Register a per-agent subname under the parent (for example probe-3f.stakefit.eth)
 * pointing at a freshly assigned Permissioned Resolver, with an expiry so the
 * identity is revocable and time bound.
 */
export async function registerAgentIdentity(
  config: EnsConfig,
  params: { label: string; owner: string; resolver: string; durationSeconds: number },
): Promise<AgentIdentity> {
  const wallet = makeWallet(config);
  const registrar = new Contract(config.registrarAddress, REGISTRAR_ABI, wallet);
  const label = slug(params.label);
  const tx = await registrar.register(label, params.owner, params.resolver, params.durationSeconds);
  const receipt = await tx.wait();
  const name = `${label}.${config.parentName}`;
  const expiry = Math.floor(Date.now() / 1000) + params.durationSeconds;
  return {
    label,
    name,
    owner: params.owner,
    resolver: params.resolver,
    tokenId: receipt?.hash ?? "0x",
    expiry,
  };
}

/** Revoke a misbehaving or expired agent identity. */
export async function revokeAgentIdentity(config: EnsConfig, label: string): Promise<string> {
  const wallet = makeWallet(config);
  const registrar = new Contract(config.registrarAddress, REGISTRAR_ABI, wallet);
  const tx = await registrar.revoke(slug(label));
  const receipt = await tx.wait();
  return receipt?.hash ?? "0x";
}

/**
 * Delegate edit rights on a single reputation text key to the orchestrator via
 * Enhanced Access Control. The orchestrator can update only that key, nothing
 * else on the resolver.
 */
export async function delegateReputationRole(
  config: EnsConfig,
  params: { name: string; key: string; resolver: string; orchestrator: string },
): Promise<string> {
  const wallet = makeWallet(config);
  const resolver = new Contract(params.resolver, RESOLVER_ABI, wallet);
  const node = namehash(params.name);
  const tx = await resolver.authorizeTextRoles(node, params.key, params.orchestrator, ROLE_CAN_SET_TEXT);
  const receipt = await tx.wait();
  return receipt?.hash ?? "0x";
}

/** Write reputation text records onto an agent resolver. */
export async function setReputation(
  config: EnsConfig,
  params: { name: string; resolver: string; records: Record<string, string> },
): Promise<string> {
  const wallet = makeWallet(config);
  const resolver = new Contract(params.resolver, RESOLVER_ABI, wallet);
  const node = namehash(params.name);
  let lastHash = "0x";
  for (const [key, value] of Object.entries(params.records)) {
    const tx = await resolver.setText(node, key, value);
    const receipt = await tx.wait();
    lastHash = receipt?.hash ?? lastHash;
  }
  return lastHash;
}

/** Encode an IPFS CID into an ENSIP-7 contenthash byte string. */
export async function encodeContenthash(cid: string): Promise<string> {
  try {
    const mod = await import("@ensdomains/content-hash");
    const contentHash = (mod as unknown as { default?: { encode: (c: string, v: string) => string }; encode?: (c: string, v: string) => string });
    const encode = contentHash.default?.encode ?? contentHash.encode;
    if (encode) return `0x${encode("ipfs", cid)}`;
  } catch {
    // fall through to explicit marker below
  }
  // Fallback keeps the CID recoverable when the encoder is unavailable.
  return hexlify(toUtf8Bytes(`ipfs://${cid}`));
}

/**
 * Publish the audit report to the target subname: write the IPFS CID to the
 * contenthash record so resolving the ENS name serves the report, plus a
 * report.latest text record pointer.
 */
export async function publishReportToEns(
  config: EnsConfig,
  params: { targetName: string; resolver: string; cid: string },
): Promise<{ txHash: string; contenthash: string }> {
  const wallet = makeWallet(config);
  const label = params.targetName.replace(new RegExp(`\\.${config.parentName}$`), "");
  if (label && !label.includes(".")) {
    const registrar = new Contract(config.registrarAddress, REGISTRAR_ABI, wallet);
    try {
      const expiry = Number(await registrar.expiryOf(label));
      if (!expiry || expiry * 1000 < Date.now()) {
        const tx = await registrar.register(label, wallet.address, params.resolver, 60 * 60 * 24 * 30);
        await tx.wait();
      }
    } catch {
      try {
        const tx = await registrar.register(label, wallet.address, params.resolver, 60 * 60 * 24 * 30);
        await tx.wait();
      } catch {
        // Already registered or registrar rejected; still write resolver records.
      }
    }
  }

  const resolver = new Contract(params.resolver, RESOLVER_ABI, wallet);
  const node = namehash(params.targetName);
  const encoded = await encodeContenthash(params.cid);

  const chTx = await resolver.setContenthash(node, encoded);
  await chTx.wait();
  const textTx = await resolver.setText(node, "report.latest", `ipfs://${params.cid}`);
  const receipt = await textTx.wait();

  return { txHash: receipt?.hash ?? "0x", contenthash: encoded };
}

/** Register the target subname and write audit text records even when IPFS is down. */
export async function publishAuditIdentity(
  config: EnsConfig,
  params: {
    targetName: string;
    resolver: string;
    scanId: string;
    target: string;
    verdict: string;
    cid?: string;
  },
): Promise<{ name: string; contenthash: string }> {
  if (params.cid) {
    const res = await publishReportToEns(config, {
      targetName: params.targetName,
      resolver: params.resolver,
      cid: params.cid,
    });
    return { name: params.targetName, contenthash: res.contenthash };
  }

  const wallet = makeWallet(config);
  const label = params.targetName.replace(new RegExp(`\\.${config.parentName}$`), "");
  if (label && !label.includes(".")) {
    const registrar = new Contract(config.registrarAddress, REGISTRAR_ABI, wallet);
    try {
      const expiry = Number(await registrar.expiryOf(label));
      if (!expiry || expiry * 1000 < Date.now()) {
        const tx = await registrar.register(label, wallet.address, params.resolver, 60 * 60 * 24 * 30);
        await tx.wait();
      }
    } catch {
      try {
        const tx = await registrar.register(label, wallet.address, params.resolver, 60 * 60 * 24 * 30);
        await tx.wait();
      } catch {
        // already registered
      }
    }
  }

  const resolver = new Contract(params.resolver, RESOLVER_ABI, wallet);
  const node = namehash(params.targetName);
  await (await resolver.setText(node, "audit.scan", params.scanId)).wait();
  await (await resolver.setText(node, "audit.target", params.target)).wait();
  const receipt = await (await resolver.setText(node, "audit.verdict", params.verdict)).wait();
  return { name: params.targetName, contenthash: receipt?.hash ?? "records" };
}

/** Read a text record via the resolver (used to recall prior audits). */
export async function readText(config: EnsConfig, name: string, key: string, resolverAddr: string): Promise<string> {
  const provider = makeProvider(config);
  const resolver = new Contract(resolverAddr, RESOLVER_ABI, provider);
  const node = namehash(name);
  return (await resolver.text(node, key)) as string;
}
