import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

const origin = "http://slug.barber.workloop.com.br";

function call(path: string) {
  const url = path.startsWith("//") ? `${origin}${path}` : new URL(path, origin);
  return middleware(new NextRequest(url));
}

function canonicalTarget(response: Response) {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const url = new URL(location ?? "");
  expect(url.origin).toBe(origin);
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  return `${url.pathname}${url.search}`;
}

describe("middleware de entrada", () => {
  it("responde 400 para o que ainda chega depois do parser de URL", async () => {
    for (const path of ["/foo/%252e%252e/bar", "/foo/%252fbar", "/foo/%5c", "/foo/%2fbar", "/..;x/", "/a;b"]) {
      const response = call(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_path" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("manda a barra final para a URL sem barra, no mesmo origin", () => {
    expect(call("/foo/").status).toBe(308);
    expect(canonicalTarget(call("/foo/"))).toBe("/foo");
    expect(canonicalTarget(call("/foo/?a=1"))).toBe("/foo?a=1");
    expect(call("/api/health/").status).toBe(308);
    expect(canonicalTarget(call("/api/health/"))).toBe("/api/health");
    expect(canonicalTarget(call("/foo///"))).toBe("/foo");
  });

  it("não redireciona a raiz", () => {
    const response = call("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejeita // inicial sem Location quando o path chega na função", async () => {
    const response = call("//evil.com/");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "bad_path" });
  });

  it("deixa passar o health e um path comum", () => {
    expect(call("/api/health").status).toBe(200);
    expect(call("/api/health/live").status).toBe(200);
    expect(call("/agendar").status).toBe(200);
  });
});
