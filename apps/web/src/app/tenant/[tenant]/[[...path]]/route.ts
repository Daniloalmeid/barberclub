import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { canonicalUrl, classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { escapeHtml } from "@/server/html";
import { getTenantPublic, UpstreamError } from "@/server/tenant-public";

const NOT_FOUND_HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><main><p>Página não encontrada.</p></main></body></html>';

function neutral(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "x-robots-tag": "noindex",
    },
  });
}

export const dynamic = "force-dynamic";

function unavailable(): Response {
  return new Response("<main><p>Serviço indisponível.</p></main>", {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "30",
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ tenant: string; path?: string[] }> }) {
  const { path } = await context.params;
  const cfg = loadConfig();
  const host = classifyHost(forwardedHost(request.headers), cfg.rootDomain);
  if (host.kind !== "tenant") return neutral();
  const slug = host.slug;
  if (!isSlugShape(slug) || isReservedSlug(slug)) return neutral();
  let row;
  try {
    row = await getTenantPublic(slug);
  } catch (error) {
    if (error instanceof UpstreamError) return unavailable();
    throw error;
  }
  if (!row) return neutral();
  if (path && path.length > 0) return neutral();
  const canonical = canonicalUrl({ kind: "tenant", slug }, "/", cfg);
  const name = escapeHtml(String(row.display_name ?? ""));
  const shown = escapeHtml(String(row.slug ?? ""));
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="index,follow"><link rel="canonical" href="${escapeHtml(canonical)}"></head><body><main><h1>${name}</h1><p>${shown}</p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
