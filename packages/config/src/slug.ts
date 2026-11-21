export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function isSlugShape(value: string): boolean {
  return SLUG_RE.test(value) && !value.includes("--");
}
