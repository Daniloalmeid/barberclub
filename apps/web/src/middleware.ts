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
import { routeSeal, sealsEqual } from "./server/route-seal";
import { getTenantPublic, UpstreamError } from "./server/tenant-public";

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
  return NextResponse.json({ error: "bad_path" }, { status: 400, headers: { "cache-control": "no-store" } });
}

function badHost() {
  return NextResponse.json({ error: "bad_host" }, { status: 400, headers: { "cache-control": "no-store" } });
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

async function neutral404(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  url.pathname = "/__bc/404";
  url.search = "";
  return rewrite(request, url);
}

function withoutClientMarks(source: Headers): Headers {
  const headers = new Headers(source);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith("x-bc-")) headers.delete(key);
  }
  return headers;
}

function redirectCanonical(location: string | null, hostName: string) {
  if (!location || !location.startsWith("/") || location.startsWith("//")) return badPath();
  const origin = originOf(loadConfig(), hostName);
  let target: URL;
  try {
    target = new URL(location, `${origin}/`);
  } catch {
    return badPath();
  }
  if (target.origin !== origin || target.username || target.password) return badPath();
  if (`${target.pathname}${target.search}` !== location) return badPath();
  return withCommonHeaders(NextResponse.redirect(target, 308));
}

function continueClean(request: NextRequest): NextResponse {
  return hideInternalMarks(withCommonHeaders(NextResponse.next({ request: { headers: withoutClientMarks(request.headers) } })));
}

function continueSealed(request: NextRequest): NextResponse {
  const headers = withoutClientMarks(request.headers);
  if (isLocalHop(rawHost(request))) headers.set("x-bc-host", sealHost(request));
  return hideInternalMarks(withCommonHeaders(NextResponse.next({ request: { headers } })));
}

function hideInternalMarks(response: NextResponse): NextResponse {
  for (const key of [...response.headers.keys()]) {
    if (key.toLowerCase().startsWith("x-bc-")) response.headers.delete(key);
  }
  return response;
}

function rawHost(request: NextRequest): string {
  return request.headers.get("host") ?? "";
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed;
  const colon = trimmed.lastIndexOf(":");
  const name = colon === -1 ? trimmed : trimmed.slice(0, colon);
  const port = colon === -1 ? "" : trimmed.slice(colon);
  return `${name.endsWith(".") ? name.slice(0, -1) : name}${port}`;
}

function isLocalHop(raw: string): boolean {
  const name = normalizeHost(raw).replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name === "0.0.0.0";
}

function sealHost(request: NextRequest): string {
  const real = normalizeHost(rawHost(request));
  if (!isLocalHop(real)) return real;
  return normalizeHost(request.headers.get("x-bc-host") ?? "") || real;
}

async function rewrite(request: NextRequest, url: URL): Promise<NextResponse> {
  const headers = withoutClientMarks(request.headers);
  const host = sealHost(request);
  headers.set("x-bc-host", host);
  headers.set("x-bc-seal", await routeSeal(url.pathname, host));
  return hideInternalMarks(withCommonHeaders(NextResponse.rewrite(url, { request: { headers } })));
}

function isPassthrough(path: string): boolean {
  return path.startsWith("/_next/") || path === "/api/health" || path === "/api/health/live";
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
}

async function routeBase(request: NextRequest, path: string): Promise<NextResponse> {
  if (path === "/login/regularizar" && !hasSessionCookie(request)) {
    const login = new URL("/login", `${originOf(loadConfig(), loadConfig().rootDomain)}/`);
    return withCommonHeaders(NextResponse.redirect(login, 303));
  }
  if (BASE_ALLOW.has(path)) {
    const dest = safeJoin("/landing", path);
    if (!dest) return neutral404(request);
    const url = request.nextUrl.clone();
    url.pathname = dest;
    const response = await rewrite(request, url);
    if (path === "/login" || path === "/login/regularizar") {
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
    }
    return response;
  }
  if (path.startsWith("/api/webhooks/") || path.startsWith("/api/cron/") || path.startsWith("/api/internal/")) {
    return continueClean(request);
  }
  return neutral404(request);
}

function unavailable(): NextResponse {
  return withCommonHeaders(
    new NextResponse("<main><p>Serviço indisponível.</p></main>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "30" },
    }),
  );
}

async function routeTenant(request: NextRequest, slug: string, path: string): Promise<NextResponse> {
  if (path.startsWith("/api/")) return neutral404(request);
  if (path !== "/robots.txt" && path !== "/sitemap.xml") {
    try {
      const row = await getTenantPublic(slug);
      if (!row) return neutral404(request);
    } catch (error) {
      if (error instanceof UpstreamError) return unavailable();
      throw error;
    }
  }
  const dest = safeJoin("/tenant/x", path);
  if (!dest) return neutral404(request);
  const url = request.nextUrl.clone();
  url.pathname = dest;
  return rewrite(request, url);
}

function canonicalHost(host: ReturnType<typeof classifyHost>, root: string): string | null {
  if (host.kind === "base") return root;
  if (host.kind === "tenant") return `${host.slug}.${root}`;
  if (host.kind === "special") return `${host.name}.${root}`;
  return null;
}

export async function middleware(request: NextRequest) {
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
  const named = canonicalHost(host, cfg.rootDomain);
  if (needsSlash && named) return redirectCanonical(fixed, named);

  if (isPassthrough(path)) return continueClean(request);
  if (pathname === "/__bc/404" || /^\/(landing|tenant)(\/|$)/i.test(pathname)) {
    const expected = await routeSeal(pathname, sealHost(request));
    const presented = request.headers.get("x-bc-seal") ?? "";
    if (sealsEqual(presented, expected)) return continueSealed(request);
    return neutral404(request);
  }

  switch (host.kind) {
    case "base":
      return routeBase(request, path);
    case "tenant":
      return routeTenant(request, host.slug, path);
    default:
      return neutral404(request);
  }
}

export const config = {
  matcher: "/:path*",
};
