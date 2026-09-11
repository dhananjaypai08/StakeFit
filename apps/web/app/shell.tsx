"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useState } from "react";

function SignIn() {
  const params = useSearchParams();
  const auth = params.get("auth");
  const blocked = auth === "access_denied" || auth === "denied";
  const failed = Boolean(auth) && !blocked;

  return (
    <main className="gate">
      <div className="gate-card">
        <p className="eyebrow">StakeFit</p>
        <h2>Sign in to enter a heat</h2>
        <p className="muted">
          Google Health is how your Fitbit Air gets here after the phone syncs. There is nothing else to click first.
        </p>
        {blocked ? (
          <div className="callout">
            <strong>Google blocked this app because it is still in Testing.</strong>
            <ol>
              <li>Open Google Cloud → APIs & Services → OAuth consent screen for project <code>dj-ethglobal</code>.</li>
              <li>Publishing status must stay <code>Testing</code>. Do not start verification.</li>
              <li>
                Under <strong>Test users</strong>, add <code>dhananjay2002pai@gmail.com</code> (and any other Gmail you
                will demo with). The project owner still has to be on this list.
              </li>
              <li>Wait about a minute, then use the button below with that exact account.</li>
            </ol>
          </div>
        ) : null}
        {failed ? <p className="callout">Google login did not finish. Try again with a listed test user.</p> : null}
        <a className="btn primary wide" href="/orch/auth/google">
          Continue with Google
        </a>
      </div>
    </main>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, refresh } = useAuth();
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      await api("/me/sync", { method: "POST" });
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return <main className="gate muted">Loading…</main>;
  }
  if (!user) {
    return <SignIn />;
  }

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <h1>STAKEFIT</h1>
          <span>{user.deviceVersion ?? "Fitbit after phone sync"}</span>
        </Link>
        <div className="wallet">
          <span className="acct">{user.email}</span>
          <button className="btn" type="button" disabled={syncing} onClick={() => void sync()}>
            {syncing ? "Syncing…" : "Sync Fitbit"}
          </button>
          <a className="btn ghost" href="/auth/logout">
            Sign out
          </a>
        </div>
      </header>
      {children}
    </>
  );
}
