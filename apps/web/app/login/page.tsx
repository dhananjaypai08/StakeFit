"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignIn } from "../../components/SignIn";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [loading, user, router]);

  if (loading || user) {
    return <div className="grid min-h-screen place-items-center text-zinc-500">Loading…</div>;
  }
  return <SignIn />;
}
