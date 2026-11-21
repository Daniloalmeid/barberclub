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

export type LoginOutcome =
  | { type: "fail" }
  | { type: "mfa" }
  | { type: "none" }
  | { type: "regularizar" }
  | { type: "choose"; items: LoginTenant[]; pending: boolean }
  | { type: "handoff"; location: string };

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

export async function resolutionFor(token: string): Promise<LoginResolution> {
  const [active, pending] = await Promise.all([
    rpc<Array<{ slug: string; display_name: string }>>("my_login_tenants", token),
    rpc<Array<{ slug: string; display_name: string; status: string }>>("my_regularization_tenants", token),
  ]);
  return resolveLogin(
    active.map((row): LoginTenant => ({ slug: row.slug, displayName: row.display_name })),
    pending.map((row): RegularizationTenant => ({ slug: row.slug, displayName: row.display_name, status: row.status })),
  );
}

async function outcomeFor(userId: string, token: string, refresh: string, next: string | null): Promise<LoginOutcome> {
  const resolution = await resolutionFor(token);
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

export async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
  totp: string,
  next: string | null,
): Promise<LoginOutcome> {
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.user || !signed.data.session) return { type: "fail" };
  const factors = await client.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (factor) {
    if (!totp) return { type: "mfa" };
    const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) return { type: "fail" };
    const verified = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code: totp });
    if (verified.error) return { type: "mfa" };
  }
  const session = await client.auth.getSession();
  const access = session.data.session?.access_token;
  const refresh = session.data.session?.refresh_token;
  if (!access || !refresh) return { type: "fail" };
  return outcomeFor(signed.data.user.id, access, refresh, next);
}

export async function continueSession(client: SupabaseClient, next: string | null): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.token || !state.refresh) return { type: "fail" };
  if (state.factors.length > 0 && state.aal !== "aal2") return { type: "mfa" };
  return outcomeFor(state.user.id, state.token, state.refresh, next);
}

export async function verifyTotp(client: SupabaseClient, code: string, next: string | null): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.factors[0]) return { type: "fail" };
  const challenge = await client.auth.mfa.challenge({ factorId: state.factors[0].id });
  if (challenge.error || !challenge.data) return { type: "fail" };
  const verified = await client.auth.mfa.verify({ factorId: state.factors[0].id, challengeId: challenge.data.id, code });
  if (verified.error) return { type: "mfa" };
  const session = await client.auth.getSession();
  const access = session.data.session?.access_token;
  const refresh = session.data.session?.refresh_token;
  if (!access || !refresh) return { type: "fail" };
  return outcomeFor(state.user.id, access, refresh, next);
}

export async function chooseTenant(client: SupabaseClient, slug: string, next: string | null): Promise<LoginOutcome> {
  const state = await sessionFacts(client);
  if (!state.user || !state.token || !state.refresh) return { type: "fail" };
  if (state.factors.length > 0 && state.aal !== "aal2") return { type: "mfa" };
  const resolution = await resolutionFor(state.token);
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
  if (state.factors.length > 0 && state.aal !== "aal2") return { type: "login" as const, rows: [] };
  const rows = await rpc<unknown[]>("my_regularization_tenants", state.token);
  return { type: "rows" as const, rows };
}

export { NONE_TENANT_MESSAGE };
