const ORCH_ORIGIN = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:8787";
const BASE = typeof window === "undefined" ? ORCH_ORIGIN : "/orch";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = new Error(json.error ?? text ?? res.statusText) as Error & { status: number; body: unknown };
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json as T;
}

export { ORCH_ORIGIN as ORCH };
