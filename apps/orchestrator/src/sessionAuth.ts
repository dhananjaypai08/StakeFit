import { createHmac, timingSafeEqual } from "node:crypto";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function signSession(userId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

export function verifySession(value: string | undefined, secret: string): string | undefined {
  if (!value || !secret) return undefined;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const userId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(userId).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return userId;
}

export function sessionCookie(value: string): string {
  return `stakefit_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}
