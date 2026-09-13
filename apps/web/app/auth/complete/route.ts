import { NextResponse } from "next/server";

export function GET(request: Request) {
  const url = new URL(request.url);
  const canonical = (process.env.NEXT_PUBLIC_SITE_URL || "https://stakefit-ethglobal.vercel.app").replace(/\/$/, "");
  if (url.origin !== canonical) {
    return NextResponse.redirect(`${canonical}${url.pathname}${url.search}`);
  }
  const session = url.searchParams.get("session") ?? "";
  const next = NextResponse.redirect(new URL("/app", canonical));
  if (session) {
    next.cookies.set("stakefit_session", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return next;
}
