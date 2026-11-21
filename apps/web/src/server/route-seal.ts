const encoder = new TextEncoder();
const nonceBytes = new Uint8Array(16);
crypto.getRandomValues(nonceBytes);
const processNonce = [...nonceBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

let cachedKey: CryptoKey | null = null;
let cachedSecret = "";

export function routeSecret(): string {
  const value = process.env[["BC", "ROUTE", "SECRET"].join("_")] ?? "";
  if (value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "development-only-route-seal-not-for-prod!!";
  throw new Error("BC_ROUTE_SECRET");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  cachedSecret = secret;
  return cachedKey;
}

export async function routeSeal(pathname: string, host: string, secret = routeSecret()): Promise<string> {
  const key = await hmacKey(secret);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${processNonce}\n${host}\n${pathname}`));
  return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sealsEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
