const ORCH_ORIGIN = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:8787";
const BASE = typeof window === "undefined" ? ORCH_ORIGIN : "/orch";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { error: text.slice(0, 180) };
    }
  }
  if (!res.ok) {
    const message = typeof json.error === "string" ? json.error : text || res.statusText;
    const error = new Error(message) as Error & { status: number; body: unknown };
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json as T;
}

export { ORCH_ORIGIN as ORCH };
