import { classifyHost, loadConfig, originOf, safeNextPath } from "@barberclub/core";
import { NextResponse } from "next/server";
import { consumeHandoff, loginUrl } from "@/server/handoff";
import { ownerAccount } from "@/server/login-flow";
import { cookieOptions, createJarClient, readCookieHeader } from "@/server/supabase";
import { getTenantPublic, UpstreamError } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

const NOT_FOUND_HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><main><p>Página não encontrada.</p></main></body></html>';

function missing(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

function refused(): NextResponse {
  const response = NextResponse.redirect(loginUrl(), 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

export async function GET(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind !== "tenant") return missing();
  try {
    const row = await getTenantPublic(host.slug);
    if (!row) return missing();
  } catch (error) {
    if (error instanceof UpstreamError) {
      return new Response("Serviço indisponível.", {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "30" },
      });
    }
    throw error;
  }
  const code = new URL(request.url).searchParams.get("c") ?? "";
  if (!/^[0-9a-f]{64}$/.test(code)) return refused();
  const consumed = await consumeHandoff(host.slug, code);
  if (!consumed) return refused();
  const jar = createJarClient(readCookieHeader(request.headers.get("cookie")));
  const set = await jar.client.auth.setSession(consumed.session);
  const user = await jar.client.auth.getUser();
  const factors = await jar.client.auth.mfa.listFactors();
  const aal = await jar.client.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasFactor = (factors.data?.totp?.length ?? 0) > 0;
  let owner = false;
  try {
    const [active, pending] = await Promise.all([
      fetch(`${(process.env[["SUPABASE", "URL"].join("_")] ?? "").replace(/\/$/, "")}/rest/v1/rpc/my_login_tenants`, {
        method: "POST",
        headers: {
          apikey: process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")] ?? "",
          authorization: `Bearer ${consumed.session.access_token}`,
          "content-type": "application/json",
          "content-profile": "public_api",
          "accept-profile": "public_api",
        },
        body: "{}",
        cache: "no-store",
      }).then(async (response) => (response.ok ? ((await response.json()) as Array<{ role?: string }>) : [])),
      fetch(`${(process.env[["SUPABASE", "URL"].join("_")] ?? "").replace(/\/$/, "")}/rest/v1/rpc/my_regularization_tenants`, {
        method: "POST",
        headers: {
          apikey: process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")] ?? "",
          authorization: `Bearer ${consumed.session.access_token}`,
          "content-type": "application/json",
          "content-profile": "public_api",
          "accept-profile": "public_api",
        },
        body: "{}",
        cache: "no-store",
      }).then(async (response) => (response.ok ? ((await response.json()) as unknown[]) : [])),
    ]);
    owner = ownerAccount(
      active.map((row) => ({ slug: "", display_name: "", role: row.role ?? "" })),
      pending.map(() => ({ slug: "", display_name: "", status: "" })),
    );
  } catch {
    owner = true;
  }
  if (set.error || user.data.user?.id !== consumed.userId || (owner && aal.data?.currentLevel !== "aal2") || (hasFactor && aal.data?.currentLevel !== "aal2")) {
    await jar.client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return refused();
  }
  const next = safeNextPath(consumed.nextPath) ?? "/";
  const response = NextResponse.redirect(new URL(next, `${originOf(cfg, `${host.slug}.${cfg.rootDomain}`)}/`), 303);
  const last = new Map(jar.changed.map((item) => [item.name, item]));
  for (const item of last.values()) response.cookies.set(item.name, item.value, cookieOptions(item.options));
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}
