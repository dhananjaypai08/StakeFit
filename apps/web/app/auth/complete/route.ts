import { NextResponse } from "next/server";

export function GET(request: Request) {
  const url = new URL(request.url);
  const session = url.searchParams.get("session") ?? "";
  const next = NextResponse.redirect(new URL("/", url.origin));
  if (session) {
    next.cookies.set("stakefit_session", session, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return next;
}
