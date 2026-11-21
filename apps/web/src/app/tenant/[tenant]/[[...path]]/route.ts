import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { canonicalUrl, loadConfig } from "@barberclub/core";
import { headers } from "next/headers";
import { getTenantPublic, UpstreamError } from "@/server/tenant-public";

const NOT_FOUND_HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><main><p>Página não encontrada.</p></main></body></html>';

function neutral(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
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

export async function GET(_request: Request, context: { params: Promise<{ tenant: string; path?: string[] }> }) {
  const { tenant, path } = await context.params;
  const route = (await headers()).get("x-bc-route");
  if (route !== `tenant:${tenant}`) return neutral();
  if (!isSlugShape(tenant) || isReservedSlug(tenant)) return neutral();
  let row;
  try {
    row = await getTenantPublic(tenant);
  } catch (error) {
    if (error instanceof UpstreamError) return unavailable();
    throw error;
  }
  if (!row) return neutral();
  if (path && path.length > 0) return neutral();
  const cfg = loadConfig();
  const canonical = canonicalUrl({ kind: "tenant", slug: tenant }, "/", cfg);
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="index,follow"><link rel="canonical" href="${canonical}"></head><body><main><h1>${String(row.display_name)}</h1><p>${String(row.slug)}</p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
