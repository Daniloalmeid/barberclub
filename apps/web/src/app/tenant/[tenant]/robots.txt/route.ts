import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { headers } from "next/headers";
import { robotsBody } from "@/server/seo";
import { getTenantPublic } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await context.params;
  const route = (await headers()).get("x-bc-route");
  if (route !== `tenant:${tenant}`) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!isSlugShape(tenant) || isReservedSlug(tenant)) {
    return new Response(robotsBody("closed"), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const row = await getTenantPublic(tenant).catch(() => null);
  const body = row ? robotsBody("tenant", tenant) : robotsBody("closed");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
