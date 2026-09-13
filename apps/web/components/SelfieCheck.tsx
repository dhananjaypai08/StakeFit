"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { Action } from "./Action";

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
      if (!appId) throw new Error("Selfie Check is not live on this deploy yet.");
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

  if (verified) return null;

  return (
    <div className="mt-4">
      <Action className="h-11 min-w-[10rem] px-5" disabled={disabled || busy} onClick={() => void openKit()}>
        {busy ? "Opening World…" : "Open Selfie Check"}
      </Action>
      {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
