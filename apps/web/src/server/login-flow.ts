import { createHash, randomUUID } from "node:crypto";
import {
  NONE_TENANT_MESSAGE,
  resolveLogin,
  safeNextPath,
  type LoginResolution,
  type LoginTenant,
  type RegularizationTenant,
} from "@barberclub/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHandoff, handoffLocation } from "./handoff";

const EMAIL_LIMIT = 20;
const IP_LIMIT = 80;
const NONE_IP_LIMIT = 10;
const WINDOW_SECONDS = 900;

export type LoginOutcome =
  | { type: "fail" }
  | { type: "limit" }
  | { type: "mfa" }
  | { type: "enroll-needed" }
  | { type: "enroll"; factorId: string; secret: string }
  | { type: "owner-blocked" }
  | { type: "none" }
  | { type: "regularizar" }
  | { type: "choose"; items: LoginTenant[]; pending: boolean }
  | { type: "handoff"; location: string };

type ActiveRow = { slug: string; display_name: string; role: string };
type PendingRow = { slug: string; display_name: string; status: string };

export function clientIp(header: string | null): string {
  const last = (header ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop();
  return last && last.length <= 64 ? last : "none";
}

async function rpc<T>(name: string, token: string): Promise<T> {
  const url = process.env[["SUPABASE", "URL"].join("_")] ?? "";
  const key = process.env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")] ?? "";
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-profile": "public_api",
      "accept-profile": "public_api",
    },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(name);
  return (await response.json()) as T;
}

export async function sessionFacts(client: SupabaseClient) {
  const userResult = await client.auth.getUser();
  const user = userResult.data.user;
  if (!user) return { user: null, aal: null as string | null, factors: [] as { id: string }[], token: null, refresh: null };
  const [aal, factors, session] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    client.auth.mfa.listFactors(),
    client.auth.getSession(),
  ]);
  return {
    user,
    aal: aal.data?.currentLevel ?? null,
    factors: factors.data?.totp ?? [],
    token: session.data.session?.access_token ?? null,
    refresh: session.data.session?.refresh_token ?? null,
  };
}

async function tenantRows(token: string): Promise<{ active: ActiveRow[]; pending: PendingRow[] }> {
  const [active, pending] = await Promise.all([
    rpc<ActiveRow[]>("my_login_tenants", token),
    rpc<PendingRow[]>("my_regularization_tenants", token),
  ]);
  return { active, pending };
}

export function ownerAccount(active: ActiveRow[], pending: PendingRow[]): boolean {
  return active.some((row) => row.role === "owner") || pending.length > 0;
}

export async function resolutionFor(token: string): Promise<LoginResolution> {
  const { active, pending } = await tenantRows(token);
  return resolveLogin(
    active.map((row): LoginTenant => ({ slug: row.slug, displayName: row.display_name })),
    pending.map((row): RegularizationTenant => ({ slug: row.slug, displayName: row.display_name, status: row.status })),
  );
}

function productionRate(): boolean {
  return (process.env.APP_ENV ?? "development") !== "development";
}

async function rateHit(bucket: string, limit: number): Promise<boolean> {
  const url = process.env[["SUPABASE", "URL"].join("_")] ?? "";
  const secret = process.env[["SUPABASE", "SECRET", "KEY"].join("_")] ?? "";
  if (!url || !secret) {
    if (productionRate()) {
      console.error("rate_limit_hit sem credencial");
      return false;
    }
    return true;
  }
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/rate_limit_hit`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "content-profile": "server_api",
      "accept-profile": "server_api",
    },
    body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_window_seconds: WINDOW_SECONDS }),
    cache: "no-store",
  });
  if (!response.ok) {
    if (productionRate()) {
      console.error(`rate_limit_hit indisponivel status=${response.status}`);
      return false;
    }
    return true;
  }
  return (await response.json()) === true;
}

export async function loginAllowed(email: string, ip: string): Promise<boolean> {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const ipLimit = ip === "none" ? NONE_IP_LIMIT : IP_LIMIT;
  const [byEmail, byIp] = await Promise.all([
    rateHit(`login:email:${hash}`, EMAIL_LIMIT),
    rateHit(`login:ip:${ip}`, ipLimit),
  ]);
  return byEmail && byIp;
}

export async function totpAllowed(userId: string, ip: string): Promise<boolean> {
  const ipLimit = ip === "none" ? NONE_IP_LIMIT : IP_LIMIT;
  const [byUser, byIp] = await Promise.all([
    rateHit(`totp:user:${userId}`, EMAIL_LIMIT),
    rateHit(`totp:ip:${ip}`, ipLimit),
  ]);
  return byUser && byIp;
}

async function outcomeFor(userId: string, token: string, refresh: string, next: string | null, aal: string | null): Promise<LoginOutcome> {
  const { active, pending } = await tenantRows(token);
  if (ownerAccount(active, pending) && aal !== "aal2") return { type: "owner-blocked" };
  const resolution = resolveLogin(
    active.map((row): LoginTenant => ({ slug: row.slug, displayName: row.display_name })),
    pending.map((row): RegularizationTenant => ({ slug: row.slug, displayName: row.display_name, status: row.status })),
  );
  if (resolution.kind === "none") return { type: "none" };
  if (resolution.kind === "redirect") return { type: "regularizar" };
  if (resolution.kind === "choose") return { type: "choose", items: resolution.items, pending: resolution.pending };
  const code = await createHandoff({
    userId,
    slug: resolution.slug,
    nextPath: next ?? "/",
    session: { access_token: token, refresh_token: refresh },
  });
  return { type: "handoff", location: handoffLocation(resolution.slug, code) };
}

async function currentAal(client: SupabaseClient): Promise<string | null> {
  const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  return level.data?.currentLevel ?? null;
}

async function enrollOrChallenge(client: SupabaseClient, totp: string): Promise<LoginOutcome | null> {
  const factors = await client.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (factor) {
    if (!totp) return { type: "mfa" };
    const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) return { type: "fail" };
    const verified = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code: totp });
    if (verified.error) return { type: "mfa" };
    return null;
  }
  return { type: "enroll-needed" };
}

export async function startEnroll(client: SupabaseClient): Promise<LoginOutcome> {
  const listed = await client.auth.mfa.listFactors();
  for (const factor of listed.data?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status !== "verified") {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `owner-${randomUUID()}` });
  if (enrolled.error || !enrolled.data?.id || !enrolled.data.totp?.secret) return { type: "owner-blocked" };
  return { type: "enroll", factorId: enrolled.data.id, secret: enrolled.data.totp.secret };
}

export async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
  totp: string,
  next: string | null,
  ip: string,
): Promise<LoginOutcome> {
  if (!(await loginAllowed(email, ip))) return { type: "limit" };
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.user || !signed.data.session) return { type: "fail" };
  const access = signed.data.session.access_token;
  const { active, pending } = await tenantRows(access);
  if (ownerAccount(active, pending) && (await currentAal(client)) !== "aal2") {
    const gate = await enrollOrChallenge(client, totp);
    if (gate) return gate;
  }
  const session = await client.auth.getSession();
  const refresh = session.data.session?.refresh_token;
  const token = session.data.session?.access_token;
  if (!token || !refresh) return { type: "fail" };
  return outcomeFor(signed.data.user.id, token, refresh, next, await currentAal(client));
}

export async function continueSession(client: SupabaseClient, next: string | null): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.token || !state.refresh) return { type: "fail" };
  const { active, pending } = await tenantRows(state.token);
  if (ownerAccount(active, pending) && state.aal !== "aal2") {
    const gate = await enrollOrChallenge(client, "");
    return gate ?? { type: "mfa" };
  }
  return outcomeFor(state.user.id, state.token, state.refresh, next, state.aal);
}

export async function verifyTotp(client: SupabaseClient, code: string, next: string | null, ip: string): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.factors[0]) return { type: "fail" };
  if (!(await totpAllowed(state.user.id, ip))) return { type: "limit" };
  const challenge = await client.auth.mfa.challenge({ factorId: state.factors[0].id });
  if (challenge.error || !challenge.data) return { type: "fail" };
  const verified = await client.auth.mfa.verify({ factorId: state.factors[0].id, challengeId: challenge.data.id, code });
  if (verified.error) return { type: "mfa" };
  const session = await client.auth.getSession();
  const access = session.data.session?.access_token;
  const refresh = session.data.session?.refresh_token;
  if (!access || !refresh) return { type: "fail" };
  return outcomeFor(state.user.id, access, refresh, next, await currentAal(client));
}

export async function confirmEnroll(
  client: SupabaseClient,
  factorId: string,
  code: string,
  next: string | null,
  ip: string,
): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user) return { type: "fail" };
  if (!(await totpAllowed(state.user.id, ip))) return { type: "limit" };
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error || !challenge.data) return { type: "owner-blocked" };
  const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
  if (verified.error) return { type: "enroll", factorId, secret: "" };
  const session = await client.auth.getSession();
  const access = session.data.session?.access_token;
  const refresh = session.data.session?.refresh_token;
  if (!access || !refresh) return { type: "fail" };
  return outcomeFor(state.user.id, access, refresh, next, await currentAal(client));
}

export async function chooseTenant(client: SupabaseClient, slug: string, next: string | null): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.token || !state.refresh) return { type: "fail" };
  const { active, pending } = await tenantRows(state.token);
  if (ownerAccount(active, pending) && state.aal !== "aal2") return { type: "owner-blocked" };
  const resolution = resolveLogin(
    active.map((row): LoginTenant => ({ slug: row.slug, displayName: row.display_name })),
    pending.map((row): RegularizationTenant => ({ slug: row.slug, displayName: row.display_name, status: row.status })),
  );
  if (resolution.kind !== "choose" || !resolution.items.some((item) => item.slug === slug)) {
    if (resolution.kind === "choose") return { type: "choose", items: resolution.items, pending: resolution.pending };
    return continueSession(client, next);
  }
  const code = await createHandoff({
    userId: state.user.id,
    slug,
    nextPath: safeNextPath(next) ?? "/",
    session: { access_token: state.token, refresh_token: state.refresh },
  });
  return { type: "handoff", location: handoffLocation(slug, code) };
}

export async function regularizationRows(client: SupabaseClient) {
  const state = await sessionFacts(client);
  if (!state.user || !state.token) return { type: "login" as const, rows: [] };
  const { active, pending } = await tenantRows(state.token);
  if (ownerAccount(active, pending) && state.aal !== "aal2") return { type: "login" as const, rows: [] };
  const rows = await rpc<unknown[]>("my_regularization_tenants", state.token);
  return { type: "rows" as const, rows };
}

export { NONE_TENANT_MESSAGE };
