import { classifyHost, loadConfig, type HostClass, type PublicCfg } from "@barberclub/core";
import { headers } from "next/headers";

export function forwardedHost(source: { get(name: string): string | null }): string | null {
  return source.get("x-bc-host") || source.get("host");
}

export async function requestHost(): Promise<{ cfg: PublicCfg; host: HostClass; raw: string | null }> {
  const cfg = loadConfig();
  const raw = forwardedHost(await headers());
  return { cfg, host: classifyHost(raw, cfg.rootDomain), raw };
}
