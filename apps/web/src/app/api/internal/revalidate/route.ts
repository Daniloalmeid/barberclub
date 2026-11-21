import { createHmac, timingSafeEqual } from "node:crypto";
import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { classifyHost, loadConfig } from "@barberclub/core";
import { forgetTenant } from "@/server/tenant-public";

export const dynamic = "force-dynamic";

function authorized(body: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind !== "base") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const body = await request.text();
  const stamp = request.headers.get("x-bc-timestamp");
  const signature = request.headers.get("x-bc-signature");
  if (!authorized(body, stamp, signature)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const parsed = JSON.parse(body) as { slugs?: unknown };
  const slugs = Array.isArray(parsed.slugs) ? parsed.slugs : [];
  for (const slug of slugs) {
    if (typeof slug === "string" && isSlugShape(slug) && !isReservedSlug(slug)) forgetTenant(slug);
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
