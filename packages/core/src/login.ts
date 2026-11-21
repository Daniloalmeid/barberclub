export type LoginTenant = { slug: string; displayName: string };
export type RegularizationTenant = { slug: string; displayName: string; status: string };

export type LoginResolution =
  | { kind: "none" }
  | { kind: "redirect"; location: "/login/regularizar" }
  | { kind: "handoff"; slug: string }
  | { kind: "choose"; items: LoginTenant[]; pending: boolean };

export function resolveLogin(active: LoginTenant[], pending: RegularizationTenant[]): LoginResolution {
  if (active.length === 0 && pending.length === 0) return { kind: "none" };
  if (active.length === 0) return { kind: "redirect", location: "/login/regularizar" };
  if (pending.length > 0) return { kind: "choose", items: active, pending: true };
  if (active.length === 1) return { kind: "handoff", slug: active[0]?.slug ?? "" };
  return { kind: "choose", items: active, pending: false };
}

export const NONE_TENANT_MESSAGE = "Não encontramos uma barbearia ativa vinculada a esta conta.";
export const LOGIN_FAILURE_MESSAGE = "Não foi possível entrar.";

const REGULARIZATION_KEYS = ["slug", "display_name", "status", "reason_code", "action_code"] as const;

export function parseRegularizationRow(value: unknown): {
  slug: string;
  display_name: string;
  status: string;
  reason_code: string;
  action_code: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("linha invalida");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== REGULARIZATION_KEYS.length || REGULARIZATION_KEYS.some((key) => !keys.includes(key))) {
    throw new Error("coluna extra");
  }
  for (const key of REGULARIZATION_KEYS) {
    if (typeof row[key] !== "string") throw new Error("coluna invalida");
  }
  return {
    slug: row.slug as string,
    display_name: row.display_name as string,
    status: row.status as string,
    reason_code: row.reason_code as string,
    action_code: row.action_code as string,
  };
}
