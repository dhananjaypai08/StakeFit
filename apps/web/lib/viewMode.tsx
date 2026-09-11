"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./auth";

export type AppView = "user" | "admin";

const STORAGE_KEY = "stakefit-view";

interface ViewModeState {
  view: AppView;
  setView: (view: AppView) => void;
}

const ViewModeCtx = createContext<ViewModeState>({
  view: "user",
  setView: () => undefined,
});

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [view, setViewState] = useState<AppView>("user");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "admin" || stored === "user") setViewState(stored);
  }, []);

  function setView(next: AppView) {
    if (!user?.admin) return;
    setViewState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <ViewModeCtx.Provider value={{ view: user?.admin ? view : "user", setView }}>{children}</ViewModeCtx.Provider>
  );
}

export function useViewMode(): ViewModeState {
  return useContext(ViewModeCtx);
}
