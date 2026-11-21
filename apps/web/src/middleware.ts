import { NextResponse, type NextRequest } from "next/server";
import { canonicalLocation, isUnsafePath, rawPathFromUrl } from "./path-guard";

function badPath() {
  return NextResponse.json(
    { error: "bad_path" },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

function redirectSameOrigin(request: NextRequest, location: string | null) {
  if (!location || !location.startsWith("/") || location.startsWith("//")) {
    return badPath();
  }
  const origin = request.nextUrl.origin;
  let target: URL;
  try {
    const base = new URL(origin);
    if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password) {
      return badPath();
    }
    target = new URL(location, base);
  } catch {
    return badPath();
  }
  if (target.origin !== origin || target.username || target.password) {
    return badPath();
  }
  if (`${target.pathname}${target.search}` !== location) {
    return badPath();
  }
  // Location relativo quebra no runtime do middleware (500). O next start reduz este absoluto ao path.
  return NextResponse.redirect(target, 308);
}

export function middleware(request: NextRequest) {
  const raw = rawPathFromUrl(request.url);
  const pathname = request.nextUrl.pathname;
  if ([pathname, raw].some((path) => isUnsafePath(path))) {
    return badPath();
  }

  const slashPath = raw.startsWith("/") ? raw : pathname;
  if (slashPath !== "/" && slashPath.endsWith("/")) {
    const location = canonicalLocation(slashPath, request.nextUrl.search);
    return redirectSameOrigin(request, location);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
