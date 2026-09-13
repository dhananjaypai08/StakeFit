"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageSkeleton } from "../../components/PageSkeleton";
import { SignIn } from "../../components/SignIn";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user?.connected) router.replace("/app");
  }, [loading, user, router]);

  if (loading || user?.connected) {
    return <PageSkeleton label={user?.connected ? "Opening races" : "Signing you in"} />;
  }
  return <SignIn />;
}
