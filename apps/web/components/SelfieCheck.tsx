"use client";

import { useState } from "react";
import { api } from "../lib/api";

interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export function SelfieCheck({
  marketId,
  disabled,
  verified,
  onDone,
}: {
  marketId: string;
  disabled?: boolean;
  verified?: boolean;
  onDone: () => Promise<void>;
}) {
  const appId = process.env.NEXT_PUBLIC_WORLD_APP_ID || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openKit() {
    if (verified) return;
    setBusy(true);
    setError("");
    try {
      if (!appId) throw new Error("Set NEXT_PUBLIC_WORLD_APP_ID and WORLD_APP_ID.");
      const rp_context = await api<RpContext>("/world/rp-context");
      const { IDKitRequestWidget, selfieCheckLegacy } = await import("@worldcoin/idkit");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(host);
      const close = () => {
        root.unmount();
        host.remove();
        setBusy(false);
      };
      root.render(
        <IDKitRequestWidget
          open
          onOpenChange={(next) => {
            if (!next) close();
          }}
          app_id={appId as `app_${string}`}
          action="stakefit-run"
          rp_context={rp_context}
          allow_legacy_proofs
          preset={selfieCheckLegacy({ signal: marketId })}
          handleVerify={async (result) => {
            await api(`/markets/${marketId}/world`, {
              method: "POST",
              body: JSON.stringify({ idkitResponse: result, action: "stakefit-run" }),
            });
          }}
          onSuccess={async () => {
            await onDone();
            close();
          }}
          onError={(code) => {
            setError(String(code));
            close();
          }}
        />,
      );
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <button className="mt-1.5 text-left" type="button" disabled={disabled || busy || verified} onClick={() => void openKit()}>
        <h2 className="text-base font-medium text-white">
          {verified ? "Selfie verified" : busy ? "Checking…" : "Selfie Check"}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-white/85">
          World confirms a live person before the run ID mints. Used for fairness, not identity.
        </p>
      </button>
      {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
