interface Partners {
  hedera?: { x402?: boolean; hcsTopic?: string; htsToken?: string; payTo?: string };
  chainlink?: { confidentialScore?: boolean; vrf?: boolean };
  graph?: { live?: boolean };
  world?: { selfieRequired?: boolean; verified?: boolean };
}

export function PartnerStrip({
  partners,
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
      detail: hedera?.x402 || hedera?.payTo ? "Entry and payout in HBAR" : "Pay from HashPack",
    },
    {
      name: "Chainlink",
      detail: "Time scored privately",
    },
    {
      name: "The Graph",
      detail: partners?.graph?.live ? "Race ledger index" : "Board from the live ledger",
    },
    {
      name: "World",
      detail: partners?.world?.verified ? "Selfie verified" : "Selfie before you claim",
    },
  ];

  return (
    <section className="page-x w-full pb-8">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Partners</p>
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
