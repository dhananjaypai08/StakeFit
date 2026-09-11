import { NextResponse } from "next/server";

export function GET(request: Request) {
  const url = new URL(request.url);
  const next = NextResponse.redirect(new URL("/", url.origin));
  next.cookies.set("stakefit_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return next;
}
