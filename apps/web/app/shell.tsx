"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageSkeleton } from "../components/PageSkeleton";
import { ProfileMenu } from "../components/ProfileMenu";
import { useAuth } from "../lib/auth";

const PUBLIC = new Set(["/", "/login"]);

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user?.connected && !isPublic) router.replace("/login");
  }, [loading, user, isPublic, router]);

  const showApp = Boolean(user?.connected) || isPublic;
  const body = loading || !showApp ? <PageSkeleton label={loading ? "Signing you in" : "Opening StakeFit"} /> : children;

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="absolute left-0 right-0 top-0 z-20">
        <div className="page-x flex h-16 w-full items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-[13px] font-semibold tracking-tight text-white">
              StakeFit
            </Link>
            {user?.connected ? (
              <Link className="text-sm text-white/70 hover:text-white" href="/app">
                Races
              </Link>
            ) : null}
          </div>
          <div className="flex items-center">
            {user?.connected ? (
              <ProfileMenu />
            ) : pathname === "/login" ? (
              <Link className="text-sm text-white/70 hover:text-white" href="/">
                Home
              </Link>
            ) : (
              <Link className="action action-primary" href="/login">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      {body}
    </div>
  );
}
