interface Partners {
  hedera?: { x402?: boolean; hcsTopic?: string; htsToken?: string; payTo?: string };
  chainlink?: { confidentialScore?: boolean; vrf?: boolean };
  graph?: { live?: boolean };
  world?: { selfieRequired?: boolean; verified?: boolean };
}

export function PartnerStrip({
  partners,
  graphIntel,
  graphSource,
}: {
  partners?: Partners;
  graphIntel?: string;
  graphSource?: string;
}) {
  const hedera = partners?.hedera;
  const items = [
    {
      name: "Hedera",
      detail: hedera?.payTo
        ? `x402 HBAR to ${hedera.payTo}${hedera.hcsTopic ? " · HCS" : ""}${hedera.htsToken ? " · HTS run ID" : ""}`
        : hedera?.x402
          ? "x402 HBAR from HashPack"
          : "Connect HashPack to pay",
    },
    {
      name: "Chainlink",
      detail: partners?.chainlink?.confidentialScore
        ? `CRE holds Health tokens in the TEE. Only the time leaves${partners.chainlink.vrf ? " · VRF ties" : ""}`
        : "CRE holds credentials in the TEE",
    },
    {
      name: "The Graph",
      detail: graphIntel || (partners?.graph?.live ? "Live subgraph" : "Local board until Studio answers"),
    },
    {
      name: "World",
      detail: partners?.world?.verified
        ? "Selfie Check verified"
        : "Selfie Check before the run card",
    },
  ];

  return (
    <section className="page-x w-full pb-8">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Partners on this race</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.name} className="rounded-xl border border-white/[0.08] bg-ink-900 px-4 py-3">
            <p className="text-sm font-medium text-white">{item.name}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">{item.detail}</p>
          </div>
        ))}
      </div>
      {graphSource ? <p className="mt-3 text-xs text-zinc-600">Board source: {graphSource}</p> : null}
    </section>
  );
}
