import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";

export type HostClass =
  | { kind: "bad" }
  | { kind: "base" }
  | { kind: "redirect"; host: string }
  | { kind: "special"; name: "app" | "admin" }
  | { kind: "tenant"; slug: string }
  | { kind: "unknown" };

const HOST_CHARS = /^[a-z0-9.\-:[\]]+$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\](?::(\d{1,5}))?$/;
const NAME_PORT = /^([^:[\]]+)(?::(\d{1,5}))?$/;
const SPECIAL = new Set(["app", "admin"]);

function validPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function classifyHost(raw: string | null, root: string): HostClass {
  if (raw == null || raw === "" || raw.length > 255) return { kind: "bad" };
  const lowered = raw.toLowerCase();
  if (!HOST_CHARS.test(lowered)) return { kind: "bad" };
  if (lowered.startsWith("[")) {
    const match = lowered.match(IPV6);
    return !match || (match[1] !== undefined && !validPort(match[1])) ? { kind: "bad" } : { kind: "unknown" };
  }
  const match = lowered.match(NAME_PORT);
  if (!match || (match[2] !== undefined && !validPort(match[2]))) return { kind: "bad" };
  let name = match[1] ?? "";
  const dotted = name.endsWith(".");
  if (dotted) name = name.slice(0, -1);
  if (!name || name.split(".").some((label) => label.length === 0 || label.length > 63)) return { kind: "bad" };
  if (IPV4.test(name)) return { kind: "unknown" };
  if (name === root) return dotted ? { kind: "redirect", host: root } : { kind: "base" };
  if (name === `www.${root}`) return { kind: "redirect", host: root };
  if (!name.endsWith(`.${root}`)) return { kind: "unknown" };
  const label = name.slice(0, -(root.length + 1));
  if (label.includes(".")) return { kind: "unknown" };
  if (SPECIAL.has(label)) {
    return dotted
      ? { kind: "redirect", host: name }
      : { kind: "special", name: label as "app" | "admin" };
  }
  if (!isSlugShape(label) || isReservedSlug(label)) return { kind: "unknown" };
  return dotted ? { kind: "redirect", host: name } : { kind: "tenant", slug: label };
}
