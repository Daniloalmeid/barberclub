import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { loadConfig, originOf, safeNextPath, tenantUrl } from "@barberclub/core";

type SealedSession = { access_token: string; refresh_token: string };

function key(): Buffer {
  const bytes = Buffer.from(process.env[["HANDOFF", "KEY"].join("_")] ?? "", "hex");
  if (bytes.length !== 32) throw new Error("HANDOFF_KEY");
  return bytes;
}

function serviceHeaders(): HeadersInit {
  const secret = process.env[["SUPABASE", "SECRET", "KEY"].join("_")] ?? "";
  return {
    apikey: secret,
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
    "content-profile": "server_api",
    "accept-profile": "server_api",
  };
}

function rest(name: string): string {
  const url = process.env[["SUPABASE", "URL"].join("_")] ?? "";
  return `${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`;
}

export function sealSession(session: SealedSession): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openSession(payload: Buffer): SealedSession {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const body = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(json) as SealedSession;
  if (!parsed.access_token || !parsed.refresh_token) throw new Error("sealed");
  return parsed;
}

function decodeBytea(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) throw new Error("sealed");
  const hex = value.replace(/^\\x/i, "");
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) return Buffer.from(hex, "hex");
  return Buffer.from(value, "base64");
}

export function newHandoffCode(): string {
  return randomBytes(32).toString("hex");
}

export async function createHandoff(input: {
  userId: string;
  slug: string;
  nextPath: string;
  session: SealedSession;
}): Promise<string> {
  if (!isSlugShape(input.slug) || isReservedSlug(input.slug)) throw new Error("bad_slug");
  const nextPath = safeNextPath(input.nextPath) ?? "/";
  const code = newHandoffCode();
  const response = await fetch(rest("create_login_handoff"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_user: input.userId,
      p_slug: input.slug,
      p_next: nextPath,
      p_code: code,
      p_sealed: `\\x${sealSession(input.session).toString("hex")}`,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("handoff");
  return code;
}

export function handoffLocation(slug: string, code: string): string {
  const url = new URL(tenantUrl(slug, "/auth/handoff", loadConfig()));
  url.searchParams.set("c", code);
  return url.toString();
}

export async function consumeHandoff(
  slug: string,
  code: string,
): Promise<{ userId: string; nextPath: string; session: SealedSession } | null> {
  const response = await fetch(rest("consume_login_handoff"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ p_slug: slug, p_code: code }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) return null;
  const row = rows[0] as { user_id?: unknown; next_path?: unknown; sealed?: unknown };
  if (typeof row.user_id !== "string") return null;
  const session = openSession(decodeBytea(row.sealed));
  return { userId: row.user_id, nextPath: safeNextPath(row.next_path) ?? "/", session };
}

export function loginUrl(): string {
  const cfg = loadConfig();
  return `${originOf(cfg, cfg.rootDomain)}/login`;
}
