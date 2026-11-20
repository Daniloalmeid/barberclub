import { NextResponse, type NextRequest } from "next/server";
import { isUnsafePath, rawPathFromUrl } from "./path-guard";

export function middleware(request: NextRequest) {
  const candidates = [request.nextUrl.pathname, rawPathFromUrl(request.url)];
  if (candidates.some((path) => isUnsafePath(path))) {
    return NextResponse.json(
      { error: "bad_path" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
