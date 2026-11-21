import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { loadConfig } from "@barberclub/core";
import { headers } from "next/headers";
import { tenantSitemap } from "@/server/seo";
import { getTenantPublic } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenant: string }> }) {
  const cfg = loadConfig();
  if (cfg.appEnv !== "production") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const { tenant } = await context.params;
  const route = (await headers()).get("x-bc-route");
  if (route !== `tenant:${tenant}` || !isSlugShape(tenant) || isReservedSlug(tenant)) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  const row = await getTenantPublic(tenant);
  if (!row) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(tenantSitemap(tenant), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
