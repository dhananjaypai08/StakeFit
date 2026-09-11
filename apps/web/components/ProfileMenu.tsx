"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useViewMode } from "../lib/viewMode";

function initials(name?: string, email?: string) {
  const fromName = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (fromName.length >= 2) return `${fromName[0]![0]!}${fromName[1]![0]!}`.toUpperCase();
  if (fromName[0]) return fromName[0].slice(0, 2).toUpperCase();
  const local = email?.split("@")[0] ?? "S";
  return local.slice(0, 2).toUpperCase();
}

export function ProfileMenu() {
  const { user, refresh } = useAuth();
  const { view, setView } = useViewMode();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!user) return null;

  async function sync() {
    setSyncing(true);
    try {
      await api("/me/sync", { method: "POST" });
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  const label = user.name || user.email;

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((value) => !value)}
        className="grid h-9 w-9 place-items-center rounded-full bg-white text-[13px] font-medium text-ink-950"
      >
        {initials(user.name, user.email)}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-72 rounded-2xl border border-white/10 bg-[#1b1c1b] p-2 shadow-xl"
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-sm font-medium text-ink-950">
              {initials(user.name, user.email)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{label}</p>
              {user.name ? <p className="truncate text-xs text-white/55">{user.email}</p> : null}
            </div>
          </div>
          {user.admin ? (
            <div className="mx-2 mb-2 flex rounded-full border border-white/12 p-0.5">
              <button
                className={`flex-1 rounded-full py-1.5 text-xs font-medium ${
                  view === "user" ? "bg-white text-ink-950" : "text-white/70 hover:text-white"
                }`}
                type="button"
                onClick={() => setView("user")}
              >
                Runner
              </button>
              <button
                className={`flex-1 rounded-full py-1.5 text-xs font-medium ${
                  view === "admin" ? "bg-white text-ink-950" : "text-white/70 hover:text-white"
                }`}
                type="button"
                onClick={() => setView("admin")}
              >
                Admin
              </button>
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={syncing}
            onClick={() => void sync()}
            className="flex w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/85 hover:bg-white/[0.06] disabled:opacity-50"
          >
            {syncing ? "Syncing Fitbit…" : "Sync Fitbit"}
          </button>
          <a
            role="menuitem"
            href="/auth/logout"
            className="flex w-full rounded-xl px-3 py-2.5 text-sm text-white/85 hover:bg-white/[0.06]"
          >
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
