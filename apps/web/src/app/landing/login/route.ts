import { LOGIN_FAILURE_MESSAGE, NONE_TENANT_MESSAGE, loadConfig, originOf, safeNextPath } from "@barberclub/core";
import { NextResponse } from "next/server";
import { escapeHtml } from "@/server/html";
import { chooseTenant, continueSession, signIn, verifyTotp, type LoginOutcome } from "@/server/login-flow";
import { cookieOptions, createJarClient, readCookieHeader, type PendingCookie } from "@/server/supabase";

export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

function page(body: string, status = 200): NextResponse {
  return new NextResponse(`<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Entrar</title></head><body><main><h1>Entrar</h1>${body}</main></body></html>`, {
    status,
    headers: HEADERS,
  });
}

function form(next: string, totp: boolean): string {
  return `<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label>E-mail<input name="email" type="email" autocomplete="username"></label><label>Senha<input name="password" type="password" autocomplete="current-password"></label>${totp ? `<p>Confirme o código do autenticador.</p><label>Código<input name="totp" inputmode="numeric" autocomplete="one-time-code"></label><input type="hidden" name="acao" value="totp">` : ""}<button type="submit">Entrar</button></form>`;
}

function render(outcome: LoginOutcome, next: string): NextResponse {
  if (outcome.type === "fail") return page(`<p>${LOGIN_FAILURE_MESSAGE}</p>${form(next, false)}`);
  if (outcome.type === "mfa") return page(form(next, true));
  if (outcome.type === "none") {
    return page(`<p>${NONE_TENANT_MESSAGE}</p><form method="post" action="/login"><input type="hidden" name="acao" value="sair"><button type="submit">Sair</button></form>`);
  }
  if (outcome.type === "regularizar") return NextResponse.redirect(new URL("/login/regularizar", `${originOf(loadConfig(), loadConfig().rootDomain)}/`), 303);
  if (outcome.type === "choose") {
    const pending = outcome.pending ? `<p><a href="/login/regularizar">Há barbearias com pendência de assinatura</a></p>` : "";
    const items = outcome.items
      .map(
        (item) =>
          `<li><form method="post" action="/login"><input type="hidden" name="acao" value="escolher"><input type="hidden" name="slug" value="${escapeHtml(item.slug)}"><input type="hidden" name="next" value="${escapeHtml(next)}"><button type="submit">${escapeHtml(item.displayName)}</button></form></li>`,
      )
      .join("");
    return page(`${pending}<ul>${items}</ul>`);
  }
  return NextResponse.redirect(outcome.location, 303);
}

function apply(response: NextResponse, cookies: PendingCookie[], clear: boolean, names: string[]) {
  if (clear) {
    for (const name of names) {
      if (name.startsWith("sb-")) response.cookies.set(name, "", cookieOptions({ maxAge: 0 }));
    }
    return;
  }
  const last = new Map<string, PendingCookie>();
  for (const item of cookies) last.set(item.name, item);
  for (const item of last.values()) response.cookies.set(item.name, item.value, item.options);
}

function finish(response: NextResponse, outcome: LoginOutcome, changed: PendingCookie[], names: string[]) {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex");
  apply(response, changed, outcome.type === "handoff", names);
  return response;
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const cfg = loadConfig();
  return origin === originOf(cfg, cfg.rootDomain);
}

export async function GET(request: Request) {
  const next = safeNextPath(new URL(request.url).searchParams.get("next")) ?? "";
  const jar = createJarClient(readCookieHeader(request.headers.get("cookie")));
  const outcome = await continueSession(jar.client, next || null);
  if (outcome.type === "fail") return page(form("", false));
  return finish(render(outcome, next), outcome, jar.changed, [...jar.jar.keys()]);
}

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const formData = await request.formData();
  const next = safeNextPath(formData.get("next"));
  const action = String(formData.get("acao") ?? "");
  const jar = createJarClient(readCookieHeader(request.headers.get("cookie")));
  if (action === "sair") {
    await jar.client.auth.signOut({ scope: "local" });
    const response = NextResponse.redirect(new URL("/login", `${originOf(loadConfig(), loadConfig().rootDomain)}/`), 303);
    apply(response, jar.changed, true, [...jar.jar.keys()]);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }
  let outcome: LoginOutcome;
  if (action === "escolher") outcome = await chooseTenant(jar.client, String(formData.get("slug") ?? ""), next);
  else if (action === "totp") outcome = await verifyTotp(jar.client, String(formData.get("totp") ?? ""), next);
  else {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const totp = String(formData.get("totp") ?? "");
    outcome = !email || !password ? { type: "fail" } : await signIn(jar.client, email, password, totp, next);
  }
  return finish(render(outcome, next ?? ""), outcome, jar.changed, [...jar.jar.keys()]);
}
