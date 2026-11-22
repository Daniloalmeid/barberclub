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

// Serviços públicos da barbearia (public_api.list_services, com anon EXECUTE).
// Falha aqui não derruba a página: a barbearia continua aparecendo sem a lista.
const SERVICE_COLS = "service_id,name,description,duration_min,price_cents,category,display_order";

export type ServicePublic = {
  service_id: string;
  name: string;
  description: string | null;
  duration_min: number;
  price_cents: number;
  category: string | null;
  display_order: number | null;
};

async function rpcServices(slug: string): Promise<ServicePublic[]> {
  const url = process.env[["SUPABASE", "URL"].join("_")];
  const key = process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")];
  if (!url || !key) return [];
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/list_services?select=${SERVICE_COLS}`, {
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
  if (!response.ok) return [];
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is ServicePublic => {
    if (!row || typeof row !== "object") return false;
    const item = row as Record<string, unknown>;
    return typeof item.service_id === "string" && typeof item.name === "string";
  });
}

export async function listServices(slug: string): Promise<ServicePublic[]> {
  try {
    return await rpcServices(slug);
  } catch {
    return [];
  }
}

// Equipe e horários livres: mesmas RPCs públicas (anon EXECUTE).
export type StaffPublic = { staff_id: string; display_name: string; photo_url: string | null; short_bio: string | null; service_ids: string[] };
export type ProdutoPublic = {
  product_id: string;
  name: string;
  description: string | null;
  category: string;
  price_cents: number;
  compare_price_cents: number | null;
  image_url: string | null;
};

export type SlotPublic = { staff_id: string; starts_at: string; ends_at: string };

async function rpcPublic<T>(fn: string, cols: string, body: Record<string, unknown>): Promise<T[]> {
  const url = process.env[["SUPABASE", "URL"].join("_")];
  const key = process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")];
  if (!url || !key) return [];
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}?select=${cols}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "content-profile": "public_api",
      "accept-profile": "public_api",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) return [];
  const rows: unknown = await response.json();
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function listStaff(slug: string): Promise<StaffPublic[]> {
  try {
    return await rpcPublic<StaffPublic>("list_staff", "staff_id,display_name,photo_url,short_bio,service_ids", { p_slug: slug });
  } catch {
    return [];
  }
}

export async function listProducts(slug: string): Promise<ProdutoPublic[]> {
  try {
    return await rpcPublic<ProdutoPublic>(
      "list_products",
      "product_id,name,description,category,price_cents,compare_price_cents,image_url",
      { p_slug: slug },
    );
  } catch {
    return [];
  }
}

// janela de 14 dias, um dia por chamada: a RPC aceita p_day e devolve slot a slot
export async function listFreeSlots(slug: string, serviceId: string, day: string, staffId?: string): Promise<SlotPublic[]> {
  try {
    return await rpcPublic<SlotPublic>("list_free_slots", "staff_id,starts_at,ends_at", {
      p_slug: slug,
      p_service: serviceId,
      p_staff: staffId ?? null,
      p_day: day,
    });
  } catch {
    return [];
  }
}

export function forgetTenant(slug: string): void {
  negative.delete(slug);
}

export function tenantCanonical(slug: string): string {
  const cfg = loadConfig();
  return `${cfg.scheme}://${slug}.${cfg.rootDomain}/`;
}
