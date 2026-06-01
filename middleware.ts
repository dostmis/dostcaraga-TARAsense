import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/MSME/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = "/msme/dashboard";
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}
