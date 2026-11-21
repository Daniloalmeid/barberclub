import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { isUnsafePath } from "./path-guard";
import { originOf, type PublicCfg } from "./public-config";

const INTERNAL = /^\/(landing|tenant|auth|login|api|_next)(\/|$)/i;

export function safeNextPath(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(input) || input.includes("#")) return null;
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  if (isUnsafePath(input) || isUnsafePath(decoded)) return null;
  let url: URL;
  try {
    url = new URL(input, "https://next.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://next.invalid" || url.username || url.password) return null;
  const out = `${url.pathname}${url.search}`;
  if (out !== input) return null;
  if (url.pathname !== "/" && url.pathname.endsWith("/")) return null;
  if (INTERNAL.test(url.pathname)) return null;
  return out;
}

export function tenantUrl(slug: string, path: string, cfg: PublicCfg): string {
  if (!isSlugShape(slug) || isReservedSlug(slug)) throw new Error("bad_slug");
  const host = `${slug}.${cfg.rootDomain}`;
  const url = new URL(path, `${originOf(cfg, host)}/`);
  if (url.hostname !== host || url.protocol !== `${cfg.scheme}:` || url.username || url.password) {
    throw new Error("bad_target");
  }
  return url.toString();
}

export function canonicalUrl(
  target: { kind: "landing" } | { kind: "tenant"; slug: string },
  path: string,
  cfg: PublicCfg,
): string {
  const host = target.kind === "landing" ? cfg.rootDomain : `${target.slug}.${cfg.rootDomain}`;
  const bare = path === "/" ? "/" : path.replace(/\/+$/, "");
  return new URL(bare, `${cfg.scheme}://${host}/`).toString();
}

export function safeJoin(prefix: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const joined = path === "/" ? prefix : `${prefix}${path}`;
  if (joined !== prefix && !joined.startsWith(`${prefix}/`)) return null;
  if (joined.includes("\\") || joined.includes("\0")) return null;
  return joined;
}

export const LOCAL_SIGNOUT_SCOPE = "local" as const;
