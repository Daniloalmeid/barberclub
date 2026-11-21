import { classifyHost, loadConfig } from "@barberclub/core";
import { tenantSitemap } from "@/server/seo";
import { getTenantPublic } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = loadConfig();
  if (cfg.appEnv !== "production") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind !== "tenant") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  const row = await getTenantPublic(host.slug);
  if (!row) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(tenantSitemap(host.slug), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
