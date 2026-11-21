import { classifyHost, loadConfig, type HostClass, type PublicCfg } from "@barberclub/core";
import { headers } from "next/headers";

export async function requestHost(): Promise<{ cfg: PublicCfg; host: HostClass; raw: string | null }> {
  const cfg = loadConfig();
  const raw = (await headers()).get("host");
  return { cfg, host: classifyHost(raw, cfg.rootDomain), raw };
}
