/**
 * A borda (Traefik) não normaliza path com parâmetro (`/..;x/`).
 * A rejeição acontece aqui, antes de qualquer resolução de tenant.
 */
const ENCODED_DANGER = /%(?:25)*(?:2e|2f|5c|00)/i;

function stripSuffix(value: string): string {
  const noHash = value.split("#")[0] ?? value;
  return noHash.split("?")[0] ?? noHash;
}

function hasBadSegments(path: string): boolean {
  if (path.includes("\\") || path.includes("\0") || path.includes(";")) {
    return true;
  }
  for (const segment of path.split("/")) {
    if (segment === "." || segment === ".." || segment.startsWith("..;")) {
      return true;
    }
  }
  return false;
}

export function isUnsafePath(input: string): boolean {
  const raw = stripSuffix(input);
  if (raw.startsWith("//") || raw.includes("\\") || raw.includes("\0")) {
    return true;
  }
  if (ENCODED_DANGER.test(raw)) {
    return true;
  }

  let current = raw;
  for (let pass = 0; pass < 4; pass += 1) {
    if (hasBadSegments(current)) {
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (decoded.startsWith("//")) {
      return true;
    }
    if (decoded === current) {
      break;
    }
    current = decoded;
  }
  return hasBadSegments(current);
}

/** Path seguro com barra final vira a URL sem barra. A raiz fica. Location é sempre relativo. */
export function canonicalLocation(pathname: string, search: string): string | null {
  if (pathname === "/" || !pathname.endsWith("/") || pathname.startsWith("//")) {
    return null;
  }
  const bare = pathname.replace(/\/+$/, "");
  if (!bare.startsWith("/") || bare.startsWith("//") || bare.includes("\\") || /[\r\n\0]/.test(bare)) {
    return null;
  }
  const query = search === "" ? "" : search.startsWith("?") ? search : `?${search}`;
  if (/[\r\n\0]/.test(query)) {
    return null;
  }
  return `${bare}${query}`;
}

export function rawPathFromUrl(url: string): string {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i);
  if (match?.[1]) {
    return match[1];
  }
  return stripSuffix(url);
}
