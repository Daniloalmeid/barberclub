import { loadConfig } from "@barberclub/core";

const COLS =
  "slug,display_name,logo_url,banner_urls,color_primary,color_secondary,color_accent," +
  "address_line,city,state,phone_public,whatsapp_public,instagram_handle,timezone,opening_hours,booking_policy_text";

const KEYS = COLS.split(",");
const NEG_TTL_MS = 30_000;
const negative = new Map<string, number>();

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super("upstream");
  }
}

export type TenantPublic = Record<(typeof KEYS)[number], unknown>;

function parseRow(value: unknown): TenantPublic {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UpstreamError(500);
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== KEYS.length || KEYS.some((key) => !keys.includes(key))) throw new UpstreamError(500);
  return row;
}

async function rpcTenantPublic(slug: string): Promise<TenantPublic | null> {
  const url = process.env[["SUPABASE", "URL"].join("_")];
  const key = process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")];
  if (!url || !key) throw new UpstreamError(503);
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/get_tenant_public?select=${COLS}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "content-profile": "public_api",
      "accept-profile": "public_api",
    },
    body: JSON.stringify({ p_slug: slug }),
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new UpstreamError(response.status);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new UpstreamError(500);
  return rows.length ? parseRow(rows[0]) : null;
}

export async function getTenantPublic(slug: string): Promise<TenantPublic | null> {
  const expires = negative.get(slug);
  if (expires && expires > Date.now()) return null;
  try {
    const row = await rpcTenantPublic(slug);
    if (!row) {
      if (negative.size > 10_000) negative.clear();
      negative.set(slug, Date.now() + NEG_TTL_MS);
      return null;
    }
    negative.delete(slug);
    return row;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(503);
  }
}

export function forgetTenant(slug: string): void {
  negative.delete(slug);
}

export function tenantCanonical(slug: string): string {
  const cfg = loadConfig();
  return `${cfg.scheme}://${slug}.${cfg.rootDomain}/`;
}
