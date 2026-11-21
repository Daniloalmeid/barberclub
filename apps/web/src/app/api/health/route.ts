type SupabaseCheck = { ok: true; latencyMs: number } | { ok: false; error: string };

type HealthBody = {
  status: "ok" | "fail";
  version: string;
  commit: string;
  buildTime: string;
  env: string;
  checks: { supabase: SupabaseCheck };
  time: string;
};

const CACHE_MS = 10_000;
const TIMEOUT_MS = 2_000;

let cache: { at: number; status: number; body: HealthBody } | null = null;

function buildIdentity() {
  return {
    version: process.env.APP_VERSION ?? "0.0.0",
    commit: process.env.GIT_COMMIT ?? "unknown",
    buildTime: process.env.BUILD_TIME ?? "unknown",
    env: process.env.APP_ENV ?? "unknown",
  };
}

async function checkSupabase(): Promise<SupabaseCheck> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return { ok: false, error: "unavailable" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/health`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "content-profile": "server_api",
        "accept-profile": "server_api",
      },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return Response.json(cache.body, {
      status: cache.status,
      headers: { "cache-control": "no-store" },
    });
  }

  const supabase = await checkSupabase();
  const body: HealthBody = {
    ...buildIdentity(),
    status: supabase.ok ? "ok" : "fail",
    checks: { supabase },
    time: new Date(now).toISOString(),
  };
  const status = supabase.ok ? 200 : 503;
  cache = { at: now, status, body };
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
