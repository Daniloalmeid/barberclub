import { LOGIN_FAILURE_MESSAGE, NONE_TENANT_MESSAGE, loadConfig, originOf, safeNextPath } from "@barberclub/core";
import { LINKS } from "@barberclub/config/links";
import { NextResponse } from "next/server";
import { escapeHtml } from "@/server/html";
import { chooseTenant, clientIp, confirmEnroll, continueSession, signIn, startEnroll, verifyTotp, type LoginOutcome } from "@/server/login-flow";
import { cookieOptions, createJarClient, readCookieHeader, type PendingCookie } from "@/server/supabase";

export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

// Página montada à mão, então o estilo vai inline: a CSP permite
// style-src 'unsafe-inline' e isto não depende do hash do CSS do build.
const STYLE =
  ':root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;display:flex;flex-direction:column;min-height:100vh}.wrap{width:100%;max-width:26rem;margin:0 auto;padding:0 1.25rem}header{border-bottom:1px solid #e5e5e5}header .wrap{display:flex;align-items:center;padding:1.25rem}b,strong{font-weight:600}.brand{display:flex;align-items:center;gap:.5rem;font-weight:600;letter-spacing:-.01em;text-decoration:none;color:#171717}.brand i{display:block;width:.375rem;height:1.5rem;border-radius:9999px;background:#171717}main{flex:1;padding:2.5rem 0}h1{font-size:1.5rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .5rem}p{color:#525252;font-size:.9375rem;margin:.75rem 0}form{display:flex;flex-direction:column;gap:.875rem;margin-top:1.5rem}label{display:flex;flex-direction:column;gap:.375rem;font-size:.8125rem;font-weight:500;color:#404040}input{font:inherit;padding:.625rem .75rem;border:1px solid #d4d4d4;border-radius:.625rem;background:#fff;color:#171717}input:focus{outline:2px solid #a3a3a3;outline-offset:1px}button{font:inherit;font-weight:500;padding:.7rem 1rem;border:1px solid #171717;border-radius:.625rem;background:#171717;color:#fff;cursor:pointer}button:hover{background:#404040;border-color:#404040}code{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8125rem;background:#f5f5f5;border-radius:.5rem;padding:.625rem .75rem;word-break:break-all;color:#171717}ul{list-style:none;padding:0;margin:1rem 0;display:flex;flex-direction:column;gap:.5rem}a{color:#171717}footer{border-top:1px solid #e5e5e5;color:#737373;font-size:.8125rem}footer .wrap{padding:1.5rem 1.25rem}@media(min-width:640px){h1{font-size:1.75rem}main{padding:3.5rem 0}}';

function shell(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Entrar — BarberClub</title><style>${STYLE}</style></head><body><header><div class="wrap"><a class="brand" href="/"><i aria-hidden="true"></i>BarberClub</a></div></header><main><div class="wrap"><h1>Entrar</h1>${body}</div></main><footer><div class="wrap"><a href="/">Voltar para o início</a></div></footer></body></html>`,
    { status, headers: HEADERS },
  );
}

function page(body: string, status = 200): NextResponse {
  return shell(body, status);
}

// Sem Supabase configurado, createJarClient lança (runtimeEnv) e o Next devolveria
// 500 com página de erro em branco. Melhor uma página honesta dizendo o que houve.
function supabaseReady(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

function notConfigured(): NextResponse {
  return shell(
    `<p>O acesso ainda não está liberado nesta instalação.</p><p>Fale com a gente no WhatsApp que resolvemos na hora.</p><p><a href="${LINKS.suporte}" target="_blank" rel="noopener noreferrer">Falar com o suporte</a></p>`,
    503,
  );
}

function form(next: string, totp: boolean): string {
  return `<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label>E-mail<input name="email" type="email" autocomplete="username"></label><label>Senha<input name="password" type="password" autocomplete="current-password"></label>${totp ? `<p>Confirme o código do autenticador.</p><label>Código<input name="totp" inputmode="numeric" autocomplete="one-time-code"></label><input type="hidden" name="acao" value="totp">` : ""}<button type="submit">Entrar</button></form>`;
}

function render(outcome: LoginOutcome, next: string): NextResponse {
  if (outcome.type === "limit") return page("<p>Muitas tentativas. Tente de novo mais tarde.</p>", 429);
  if (outcome.type === "fail") return page(`<p>${LOGIN_FAILURE_MESSAGE}</p>${form(next, false)}`);
  if (outcome.type === "owner-blocked") {
    return page("<p>A conta de dono exige o autenticador. Não foi possível cadastrá-lo.</p>");
  }
  if (outcome.type === "enroll-needed") {
    return page(`<p>Cadastre o autenticador. A conta de dono não entra sem ele.</p><form method="post" action="/login"><input type="hidden" name="acao" value="comecar"><input type="hidden" name="next" value="${escapeHtml(next)}"><button type="submit">Cadastrar autenticador</button></form>`);
  }
  if (outcome.type === "enroll") {
    const uri = `otpauth://totp/BarberClub:owner?secret=${encodeURIComponent(outcome.secret)}&issuer=BarberClub`;
    return page(`<p>Cadastre o autenticador. A conta de dono não entra sem ele.</p><form method="post" action="/login"><input type="hidden" name="acao" value="cadastrar"><input type="hidden" name="fator" value="${escapeHtml(outcome.factorId)}"><input type="hidden" name="next" value="${escapeHtml(next)}"><code data-secret="${escapeHtml(outcome.secret)}">${escapeHtml(outcome.secret)}</code><p>${escapeHtml(uri)}</p><label>Código<input name="totp" inputmode="numeric" autocomplete="one-time-code"></label><button type="submit">Cadastrar</button></form>`);
  }
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
  if (!origin) return false;
  const cfg = loadConfig();
  return origin === originOf(cfg, cfg.rootDomain);
}

export async function GET(request: Request) {
  if (!supabaseReady()) return notConfigured();
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
  if (!supabaseReady()) return notConfigured();
  const formData = await request.formData();
  const next = safeNextPath(formData.get("next"));
  const action = String(formData.get("acao") ?? "");
  const ip = clientIp(request.headers.get("x-forwarded-for"));
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
  else if (action === "totp") outcome = await verifyTotp(jar.client, String(formData.get("totp") ?? ""), next, ip);
  else if (action === "comecar") outcome = await startEnroll(jar.client);
  else if (action === "cadastrar") {
    outcome = await confirmEnroll(jar.client, String(formData.get("fator") ?? ""), String(formData.get("totp") ?? ""), next, ip);
  } else {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const totp = String(formData.get("totp") ?? "");
    outcome = !email || !password ? { type: "fail" } : await signIn(jar.client, email, password, totp, next, ip);
  }
  return finish(render(outcome, next ?? ""), outcome, jar.changed, [...jar.jar.keys()]);
}
