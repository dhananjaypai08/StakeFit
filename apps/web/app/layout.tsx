import type { Metadata } from "next";
import { Inter, Roboto } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "../lib/auth";
import { ViewModeProvider } from "../lib/viewMode";
import { Shell } from "./shell";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: "500",
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "StakeFit",
  description: "Daily Fitbit races. Pay in HBAR. Fastest pace wins.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/logo.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <ViewModeProvider>
            <Suspense fallback={<div className="min-h-screen bg-ink-950" />}>
              <Shell>{children}</Shell>
            </Suspense>
          </ViewModeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
