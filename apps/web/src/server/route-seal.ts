const encoder = new TextEncoder();

export function routeSecret(): string {
  const value = process.env[["BC", "ROUTE", "SECRET"].join("_")] ?? "";
  const env = process.env[["APP", "ENV"].join("_")] ?? "development";
  if (value.length >= 32) return value;
  if (env === "development") return "development-only-route-seal-not-for-prod!!";
  throw new Error("BC_ROUTE_SECRET");
}

export async function routeSeal(pathname: string, secret = routeSecret()): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(pathname));
  return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sealsEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
