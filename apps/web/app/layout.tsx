import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "../lib/auth";
import { Shell } from "./shell";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StakeFit",
  description: "Daily distance heats settled on Hedera",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <div className="wrap">
            <Suspense fallback={<main className="gate muted">Loading…</main>}>
              <Shell>{children}</Shell>
            </Suspense>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
