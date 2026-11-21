import { classifyHost, loadConfig } from "@barberclub/core";
import { robotsBody } from "@/server/seo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = loadConfig();
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind !== "base") {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(robotsBody("base"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
