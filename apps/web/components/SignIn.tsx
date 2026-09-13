"use client";

import { useSearchParams } from "next/navigation";
import { PHOTOS } from "../lib/photos";
import { GoogleSignIn } from "./GoogleSignIn";

export function SignIn() {
  const params = useSearchParams();
  const auth = params.get("auth");
  const blocked = auth === "access_denied" || auth === "denied";

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-950">
      <img
        src={PHOTOS.hero}
        alt="Athlete in starting position on a running track"
        className="absolute inset-0 h-full w-full object-cover object-[center_58%]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-black/25" />
      <div className="page-x relative flex min-h-[calc(100vh-3.5rem)] flex-col justify-end pb-12 pt-8">
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-white md:text-5xl">
          Connect Fitbit to race
        </h1>
        <p className="mt-3 text-base text-white/90">
          Google Health reads the sessions already on your phone.
        </p>
        {blocked ? (
          <div className="mt-6 max-w-md rounded-lg border border-amber-200/30 bg-amber-950/40 p-3 text-sm text-amber-50">
            Google blocked this sign-in. Ask the host to add your account, then try again.
          </div>
        ) : null}
        <div className="mt-8 max-w-sm">
          <GoogleSignIn href="/orch/auth/google" />
        </div>
      </div>
    </main>
  );
}
