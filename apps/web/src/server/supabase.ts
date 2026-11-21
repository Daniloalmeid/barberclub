import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "@barberclub/core";

export type PendingCookie = { name: string; value: string; options: CookieOptions };

function runtimeEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name);
  return value;
}

export function cookieOptions(options: CookieOptions = {}): CookieOptions {
  const rest: CookieOptions = { ...options };
  delete rest.domain;
  return {
    ...rest,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: loadConfig().scheme === "https",
  };
}

export function readCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => {
      const index = part.indexOf("=");
      if (index === -1) return null;
      const name = part.slice(0, index).trim();
      if (!name) return null;
      return { name, value: part.slice(index + 1).trim() };
    })
    .filter((item): item is { name: string; value: string } => item !== null);
}

export function createJarClient(seed: { name: string; value: string }[]) {
  const jar = new Map<string, PendingCookie>();
  for (const item of seed) jar.set(item.name, { name: item.name, value: item.value, options: cookieOptions() });
  const changed: PendingCookie[] = [];
  const client = createServerClient(runtimeEnv("SUPABASE_URL"), runtimeEnv("SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll() {
        return [...jar.values()].map(({ name, value }) => ({ name, value }));
      },
      setAll(list) {
        for (const item of list) {
          const stored = { name: item.name, value: item.value, options: cookieOptions(item.options) };
          jar.set(item.name, stored);
          changed.push(stored);
        }
      },
    },
  });
  return { client, changed, jar };
}

export function createServiceClient(): SupabaseClient {
  return createClient(runtimeEnv("SUPABASE_URL"), runtimeEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
