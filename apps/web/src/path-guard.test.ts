import { describe, expect, it } from "vitest";
import { isUnsafePath } from "./path-guard";

const safe = ["/", "/api/health", "/api/health/live", "/agendar", "/painel/equipe", "/servicos/corte-masculino"];

const encoded = [
  "/foo/%2e",
  "/foo/%2E",
  "/foo/%2e%2e/bar",
  "/foo/%2E%2E/bar",
  "/%2fetc/passwd",
  "/foo/%2Fbar",
  "/foo/%5cbar",
  "/foo/%5C..%5Cwindows",
  "/%00",
  "/foo/%00bar",
];

const doubleEncoded = [
  "/foo/%252e",
  "/foo/%252E%252e/bar",
  "/foo/%252fbar",
  "/foo/%255cbar",
  "/foo/%25252e",
  "/foo/%252500",
];

const dotSegments = ["/.", "/./", "/foo/.", "/foo/../bar", "/..", "/../etc/passwd", "/a/../../b"];

const semicolon = ["/..;x/", "/foo/..;algo/bar", "/foo/..;x", "/a;b", "/foo/bar;baz", "/;"];

const other = ["/foo\\bar", "/foo\\\u0000bar", "/%", "/%ZZ", "/foo/%2"];

describe("isUnsafePath", () => {
  it.each(safe)("aceita %s", (path) => {
    expect(isUnsafePath(path)).toBe(false);
  });

  it.each(encoded)("rejeita segmento codificado %s", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each(doubleEncoded)("rejeita codificação dupla %s", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each(dotSegments)("rejeita dot-segment %s", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each(semicolon)("rejeita ; no segmento %s", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each(other)("rejeita forma malformada %s", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it("ignora a query ao julgar o path", () => {
    expect(isUnsafePath("/api/health?ok=1")).toBe(false);
    expect(isUnsafePath("/foo/%2e?x=1")).toBe(true);
  });
});
