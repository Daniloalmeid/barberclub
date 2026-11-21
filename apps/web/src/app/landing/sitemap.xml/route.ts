import { classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { landingSitemap } from "@/server/seo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(forwardedHost(request.headers), cfg.rootDomain);
  if (host.kind !== "base" || cfg.appEnv !== "production") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(landingSitemap(), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
