import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { loadConfig, originOf } from "@barberclub/core";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await context.params;
  const route = (await headers()).get("x-bc-route");
  const cfg = loadConfig();
  const login = `${originOf(cfg, cfg.rootDomain)}/login`;
  if (route !== `tenant:${tenant}`) {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const code = new URL(request.url).searchParams.get("c") ?? "";
  if (!/^[0-9a-f]{64}$/.test(code)) {
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.redirect(login, 303);
}
