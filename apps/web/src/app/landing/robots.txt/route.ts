import { headers } from "next/headers";
import { robotsBody } from "@/server/seo";

export const dynamic = "force-dynamic";

export async function GET() {
  const route = (await headers()).get("x-bc-route");
  if (route !== "landing") {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(robotsBody("base"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
