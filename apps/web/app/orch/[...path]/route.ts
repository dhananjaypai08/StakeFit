import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function orchestratorOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
  return raw.replace(/\/$/, "");
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const origin = orchestratorOrigin();
  if (!origin || /localhost|127\.0\.0\.1/.test(origin)) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_ORCHESTRATOR_URL to the Railway URL, then redeploy." },
      { status: 503 },
    );
  }
  const dest = `${origin}/${path.join("/")}${new URL(req.url).search}`;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (key === "host" || key === "connection" || key === "content-length") return;
    headers.set(key, value);
  });
  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  const upstream = await fetch(dest, init);
  const location = upstream.headers.get("location");
  if (location && upstream.status >= 300 && upstream.status < 400) {
    return NextResponse.redirect(location, upstream.status as 301 | 302 | 303 | 307 | 308);
  }
  const body = await upstream.arrayBuffer();
  const res = new NextResponse(body, { status: upstream.status });
  upstream.headers.forEach((value, key) => {
    if (["transfer-encoding", "content-encoding"].includes(key)) return;
    res.headers.set(key, value);
  });
  return res;
}

type Ctx = { params: { path: string[] } };

export function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path);
}

export function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path);
}

export function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path);
}

export function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path);
}

export function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path);
}
