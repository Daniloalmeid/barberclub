import { classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { robotsBody } from "@/server/seo";
import { getTenantPublic } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(forwardedHost(request.headers), cfg.rootDomain);
  if (host.kind !== "tenant") {
    return new Response(robotsBody("closed"), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const row = await getTenantPublic(host.slug).catch(() => null);
  const body = row ? robotsBody("tenant", host.slug) : robotsBody("closed");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
