import { NextResponse, type NextRequest } from "next/server";
import {
  canonicalLocation,
  classifyHost,
  isUnsafePath,
  loadConfig,
  originOf,
  rawPathFromUrl,
  safeJoin,
} from "@barberclub/core";

const BASE_ALLOW = new Set([
  "/",
  "/login",
  "/login/regularizar",
  "/termos",
  "/privacidade",
  "/robots.txt",
  "/sitemap.xml",
]);

function badPath() {
  return NextResponse.json(
    { error: "bad_path" },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

function badHost() {
  return NextResponse.json(
    { error: "bad_host" },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

function redirectSameOrigin(request: NextRequest, location: string | null) {
  if (!location || !location.startsWith("/") || location.startsWith("//")) return badPath();
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
  if (target.origin !== origin || target.username || target.password) return badPath();
  if (`${target.pathname}${target.search}` !== location) return badPath();
  return withCommonHeaders(NextResponse.redirect(target, 308));
}

function contentSecurityPolicy(): string {
  const supabase = process.env.SUPABASE_URL;
  const connect = supabase ? `'self' ${supabase}` : "'self'";
  return [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

function withCommonHeaders(response: NextResponse): NextResponse {
  response.headers.set("content-security-policy", contentSecurityPolicy());
  if ((process.env.APP_ENV ?? "development") !== "production") {
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}

function neutral404(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = safeJoin("/tenant/x", path) ?? "/tenant/x";
  url.search = "";
  return rewrite(request, url, "tenant:x");
}

function rewrite(request: NextRequest, url: URL, route: string): NextResponse {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith("x-bc-")) headers.set(key, "");
  }
  headers.set("x-bc-route", route);
  return withCommonHeaders(NextResponse.rewrite(url, { request: { headers } }));
}

function isPassthrough(path: string): boolean {
  return path.startsWith("/_next/") || path === "/api/health" || path === "/api/health/live";
}

function routeBase(request: NextRequest, path: string): NextResponse {
  if (path === "/login/regularizar" && !hasSessionCookie(request)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return withCommonHeaders(NextResponse.redirect(login, 303));
  }
  if (BASE_ALLOW.has(path)) {
    const dest = safeJoin("/landing", path);
    if (!dest) return neutral404(request, path);
    const url = request.nextUrl.clone();
    url.pathname = dest;
    const response = rewrite(request, url, "landing");
    if (path === "/login" || path === "/login/regularizar") {
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
    }
    return response;
  }
  if (path.startsWith("/api/webhooks/") || path.startsWith("/api/cron/") || path.startsWith("/api/internal/")) {
    return withCommonHeaders(NextResponse.next());
  }
  return neutral404(request, path);
}

function routeTenant(request: NextRequest, slug: string, path: string): NextResponse {
  if (path.startsWith("/api/")) return neutral404(request, path);
  const dest = safeJoin(`/tenant/${slug}`, path);
  if (!dest) return neutral404(request, path);
  const url = request.nextUrl.clone();
  url.pathname = dest;
  return rewrite(request, url, `tenant:${slug}`);
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
}

export function middleware(request: NextRequest) {
  const raw = rawPathFromUrl(request.url);
  const pathname = request.nextUrl.pathname;
  if ([pathname, raw].some((path) => isUnsafePath(path))) return badPath();

  const path = raw.startsWith("/") ? raw : pathname;
  const search = request.nextUrl.search;
  const cfg = loadConfig();
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind === "bad") return badHost();

  const needsSlash = path !== "/" && path.endsWith("/");
  const fixed = needsSlash ? canonicalLocation(path, search) : `${path}${search}`;
  if (fixed === null) return badPath();
  if (host.kind === "redirect") {
    return withCommonHeaders(NextResponse.redirect(new URL(fixed, `${originOf(cfg, host.host)}/`), 308));
  }
  if (needsSlash) return redirectSameOrigin(request, fixed);

  if (isPassthrough(path)) return withCommonHeaders(NextResponse.next());
  if (/^\/(landing|tenant)(\/|$)/i.test(path)) {
    const mark = request.headers.get("x-bc-route") ?? "";
    const internal =
      (mark === "landing" && path.toLowerCase().startsWith("/landing")) ||
      (mark.startsWith("tenant:") && path.toLowerCase().startsWith("/tenant/"));
    if (internal) return withCommonHeaders(NextResponse.next());
    return neutral404(request, path);
  }

  switch (host.kind) {
    case "base":
      return routeBase(request, path);
    case "tenant":
      return routeTenant(request, host.slug, path);
    default:
      return neutral404(request, path);
  }
}

export const config = {
  matcher: "/:path*",
};
