"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface Me {
  id: string;
  email: string;
  name?: string;
  admin: boolean;
  connected: boolean;
  lastSyncTime?: string;
  deviceVersion?: string;
  hederaAccount?: string;
  worldVerified?: boolean;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({ user: null, loading: true, refresh: async () => undefined });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const body = await api<{ user: Me }>("/me");
      setUser(body.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api("/me/sync", { method: "POST" })
      .then(() => {
        if (!cancelled) return refresh();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id, refresh]);

  return <AuthCtx.Provider value={{ user, loading, refresh }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthCtx);
}
