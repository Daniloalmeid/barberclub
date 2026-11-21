import { createHmac, timingSafeEqual } from "node:crypto";
import { classifyHost, loadConfig } from "@barberclub/core";

export const dynamic = "force-dynamic";

function authorized(given: string): boolean {
  const secret = process.env[["CRON", "SECRET"].join("_")] ?? "";
  if (!secret || given.length === 0) return false;
  const left = createHmac("sha256", "cron").update(secret).digest();
  const right = createHmac("sha256", "cron").update(given).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind !== "base") {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!authorized(request.headers.get("x-cron-secret") ?? "")) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = process.env[["SUPABASE", "URL"].join("_")] ?? "";
  const secret = process.env[["SUPABASE", "SECRET", "KEY"].join("_")] ?? "";
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/purge_login_handoffs`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "content-profile": "server_api",
      "accept-profile": "server_api",
    },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) {
    return Response.json({ error: "purge" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const deleted: unknown = await response.json();
  return Response.json({ deleted }, { headers: { "cache-control": "no-store" } });
}
