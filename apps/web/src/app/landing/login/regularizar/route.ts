import { LINKS } from "@barberclub/config/links";
import { loadConfig, originOf, parseRegularizationRow } from "@barberclub/core";
import { NextResponse } from "next/server";
import { escapeHtml } from "@/server/html";
import { regularizationRows } from "@/server/login-flow";
import { cookieOptions, createJarClient, readCookieHeader } from "@/server/supabase";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  past_due: "Pagamento em atraso",
  suspended: "Assinatura suspensa",
};

function loginRedirect(): NextResponse {
  const response = NextResponse.redirect(new URL("/login", `${originOf(loadConfig(), loadConfig().rootDomain)}/`), 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const jar = createJarClient(readCookieHeader(request.headers.get("cookie")));
  let loaded;
  try {
    loaded = await regularizationRows(jar.client);
  } catch {
    return loginRedirect();
  }
  if (loaded.type === "login") return loginRedirect();
  let rows;
  try {
    rows = loaded.rows.map((row) => parseRegularizationRow(row));
  } catch {
    return loginRedirect();
  }
  if (rows.length === 0) return loginRedirect();
  const items = rows
    .map(
      (item) =>
        `<li><p>${escapeHtml(item.display_name)}</p><p>${escapeHtml(LABELS[item.status] ?? item.status)}</p><a href="${escapeHtml(LINKS.regularizar)}" target="_blank" rel="noopener noreferrer">Regularizar</a></li>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Regularizar</title></head><body><main><h1>Regularizar</h1><ul>${items}</ul><p><a href="${escapeHtml(LINKS.suporte)}" target="_blank" rel="noopener noreferrer">Falar com o suporte</a></p><form method="post" action="/login/regularizar"><input type="hidden" name="acao" value="sair"><button type="submit">Sair</button></form></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const cfg = loadConfig();
  if (!origin || origin !== originOf(cfg, cfg.rootDomain)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const formData = await request.formData();
  if (String(formData.get("acao") ?? "") !== "sair") return loginRedirect();
  const jar = createJarClient(readCookieHeader(request.headers.get("cookie")));
  await jar.client.auth.signOut({ scope: "local" });
  const response = loginRedirect();
  for (const name of jar.jar.keys()) {
    if (name.startsWith("sb-")) response.cookies.set(name, "", cookieOptions({ maxAge: 0 }));
  }
  return response;
}
