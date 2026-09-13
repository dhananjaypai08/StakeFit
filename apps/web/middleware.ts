import { NextResponse, type NextRequest } from "next/server";

const CANONICAL_HOST = "stakefit-ethglobal.vercel.app";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!host || host === CANONICAL_HOST || host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return NextResponse.next();
  }
  if (host.endsWith(".vercel.app")) {
    const url = req.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = "https";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
