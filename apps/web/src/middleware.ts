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

// CSP com nonce. Sem o nonce, o Next não executa os próprios scripts inline de
// bootstrap (o push do payload RSC): o HTML chega completo e a página é pintada em
// branco, porque a árvore do React nunca é hidratada. Medido: <main> no DOM, PNG e
// PDF vazios. O Next lê o nonce do header content-security-policy da REQUISIÇÃO e o
// aplica às suas tags <script>, por isso ele vai nos dois lados.
function contentSecurityPolicy(nonce?: string): string {
  const supabase = process.env.SUPABASE_URL;
  const connect = supabase ? `'self' ${supabase}` : "'self'";
  const script = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return [
    "default-src 'self'",
    "img-src 'self' https: data:",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function attachNonce(headers: Headers): string {
  const nonce = newNonce();
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", contentSecurityPolicy(nonce));
  return nonce;
}

function withCommonHeaders(response: NextResponse, nonce?: string): NextResponse {
  const value = nonce ?? newNonce();
  response.headers.set("content-security-policy", contentSecurityPolicy(value));
  // x-nonce NÃO vai na resposta: o navegador lê o nonce do próprio CSP. Devolvê-lo
  // num header só aumenta a diferença entre duas respostas iguais, e a D7 promete
  // 404 idêntico para host inexistente, inativo, inválido e reservado.
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
  const headers = withoutClientMarks(request.headers);
  const nonce = attachNonce(headers);
  return hideInternalMarks(withCommonHeaders(NextResponse.next({ request: { headers } }), nonce));
}

async function localNeutral(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  url.pathname = "/__bc/404";
  url.search = "";
  const headers = withoutClientMarks(request.headers);
  headers.set("x-bc-seal", await routeSeal("/__bc/404", mintHost(request)));
  const nonce = attachNonce(headers);
  return hideInternalMarks(withCommonHeaders(NextResponse.rewrite(url, { request: { headers } }), nonce));
}

function continueSealed(request: NextRequest, host: string): NextResponse {
  const headers = withoutClientMarks(request.headers);
  headers.set("x-bc-host", host);
  const nonce = attachNonce(headers);
  return hideInternalMarks(withCommonHeaders(NextResponse.next({ request: { headers } }), nonce));
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
  let value = raw.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? "" : value.slice(0, end + 1);
  }
  value = value.replace(/\s+/g, "");
  value = value.replace(/:\d+$/, "");
  if (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

function isLocalHop(raw: string): boolean {
  const name = normalizeHost(raw).replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1";
}

function mintHost(request: NextRequest): string {
  return normalizeHost(rawHost(request));
}

async function rewrite(request: NextRequest, url: URL): Promise<NextResponse> {
  const headers = withoutClientMarks(request.headers);
  const host = mintHost(request);
  if (host && !isLocalHop(host)) headers.set("x-bc-host", host);
  headers.set("x-bc-seal", await routeSeal(url.pathname, host));
  const nonce = attachNonce(headers);
  return hideInternalMarks(withCommonHeaders(NextResponse.rewrite(url, { request: { headers } }), nonce));
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
    const real = mintHost(request);
    if (!isLocalHop(real)) return neutral404(request);
    const presented = request.headers.get("x-bc-seal") ?? "";
    const carried = normalizeHost(request.headers.get("x-bc-host") ?? "");
    if (carried && !isLocalHop(carried)) {
      const expected = await routeSeal(pathname, carried);
      if (!sealsEqual(presented, expected)) return localNeutral(request);
      return continueSealed(request, carried);
    }
    if (pathname === "/__bc/404" && sealsEqual(presented, await routeSeal("/__bc/404", real))) return continueClean(request);
    return localNeutral(request);
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
