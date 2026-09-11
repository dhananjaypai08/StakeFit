/**
 * ABIs for the StakeFit subname registrar and its Permissioned Resolver.
 *
 * These target our own ENSv2 style subname registry deployed on Sepolia. The
 * registrar mints per-agent subnames; each subname points at a Permissioned
 * Resolver that stores records with per-key Enhanced Access Control roles.
 */

export const REGISTRAR_ABI = [
  "function register(string label, address owner, address resolver, uint64 duration) returns (uint256 tokenId)",
  "function revoke(string label)",
  "function resolverOf(string label) view returns (address)",
  "function ownerOfLabel(string label) view returns (address)",
  "function expiryOf(string label) view returns (uint64)",
  "event SubnameRegistered(string label, address indexed owner, address resolver, uint64 expiry)",
  "event SubnameRevoked(string label)",
];

export const RESOLVER_ABI = [
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
  "function setContenthash(bytes32 node, bytes hash)",
  "function contenthash(bytes32 node) view returns (bytes)",
  "function setAddr(bytes32 node, address a)",
  "function addr(bytes32 node) view returns (address)",
  // Enhanced Access Control style delegation for a single text key.
  "function authorizeTextRoles(bytes32 node, string key, address account, uint256 roleBitmap)",
  "function hasTextRole(bytes32 node, string key, address account) view returns (bool)",
];

/** Role bitmap that grants edit rights to a single text key. */
export const ROLE_CAN_SET_TEXT = 1n << 4n;
