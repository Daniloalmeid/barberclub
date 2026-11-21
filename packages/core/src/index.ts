export const appointmentStatuses = [
  "hold",
  "pending_payment",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
  "expired",
  "payment_conflict",
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const bookableTenantStatuses = ["trial", "active"] as const;

export { classifyHost, type HostClass } from "./host";
export { LOGIN_FAILURE_MESSAGE, NONE_TENANT_MESSAGE, parseRegularizationRow, resolveLogin } from "./login";
export type { LoginResolution, LoginTenant, RegularizationTenant } from "./login";
export { canonicalLocation, isUnsafePath, rawPathFromUrl } from "./path-guard";
export { loadConfig, originOf, type PublicCfg } from "./public-config";
export { LOCAL_SIGNOUT_SCOPE, canonicalUrl, safeJoin, safeNextPath, tenantUrl } from "./redirect";
