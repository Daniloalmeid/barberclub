import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

process.env.APP_ENV = "production";
process.env.ROOT_DOMAIN = "barber.workloop.com.br";
process.env.PUBLIC_SCHEME = "https";
process.env.PUBLIC_PORT = "";
process.env.BC_ROUTE_SECRET = "0123456789abcdef0123456789abcdef";

const requestOrigin = "http://slug.barber.workloop.com.br";
const canonicalOrigin = "https://barber.workloop.com.br";

function call(path: string) {
  const url = path.startsWith("//") ? `${requestOrigin}${path}` : new URL(path, requestOrigin);
  return middleware(new NextRequest(url, { headers: { host: "barber.workloop.com.br" } }));
}

function canonicalTarget(response: Response) {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const url = new URL(location ?? "");
  expect(url.origin).toBe(canonicalOrigin);
  expect(url.origin).not.toBe(requestOrigin);
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  return `${url.pathname}${url.search}`;
}

describe("middleware de entrada", () => {
  it("responde 400 para o que ainda chega depois do parser de URL", async () => {
    for (const path of ["/foo/%252e%252e/bar", "/foo/%252fbar", "/foo/%5c", "/foo/%2fbar", "/..;x/", "/a;b"]) {
      const response = await call(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_path" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("manda a barra final para o origin canônico do host", async () => {
    expect((await call("/foo/")).status).toBe(308);
    expect(canonicalTarget(await call("/foo/"))).toBe("/foo");
    expect(canonicalTarget(await call("/foo/?a=1"))).toBe("/foo?a=1");
    expect((await call("/api/health/")).status).toBe(308);
    expect(canonicalTarget(await call("/api/health/"))).toBe("/api/health");
    expect(canonicalTarget(await call("/foo///"))).toBe("/foo");
  });

  it("não redireciona a raiz", async () => {
    const response = await call("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejeita // inicial sem Location quando o path chega na função", async () => {
    const response = await call("//evil.com/");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "bad_path" });
  });

  it("deixa passar o health e recusa path fora da allowlist", async () => {
    expect((await call("/api/health")).status).toBe(200);
    expect((await call("/api/health/live")).status).toBe(200);
    expect((await call("/agendar")).headers.get("x-middleware-rewrite")).toContain("/__bc/404");
  });
});
