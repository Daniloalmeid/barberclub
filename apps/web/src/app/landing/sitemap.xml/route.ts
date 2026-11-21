import { loadConfig } from "@barberclub/core";
import { headers } from "next/headers";
import { landingSitemap } from "@/server/seo";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadConfig();
  const route = (await headers()).get("x-bc-route");
  if (route !== "landing" || cfg.appEnv !== "production") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(landingSitemap(), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
