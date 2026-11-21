import { assertExternal } from "@barberclub/config/links";
import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import {
  classifyHost,
  loadConfig,
  parseRegularizationRow,
  resolveLogin,
  safeJoin,
  safeNextPath,
  tenantUrl,
} from "@barberclub/core";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

const root = "barber.workloop.com.br";
process.env.APP_ENV = "production";
process.env.ROOT_DOMAIN = root;
process.env.PUBLIC_SCHEME = "https";
process.env.PUBLIC_PORT = "";
process.env.BC_ROUTE_SECRET = "0123456789abcdef0123456789abcdef";
const cfg = loadConfig(process.env);

function call(path: string, host = root) {
  const request = new NextRequest(new URL(path, "http://slug.barber.workloop.com.br"), { headers: { host } });
  return middleware(request);
}

describe("slug e reservados", () => {
  it.each(["abc", "a1b", "123", "a-b", "minha-barbearia", "a".repeat(32)])("aceita %s", (value) => {
    expect(isSlugShape(value)).toBe(true);
  });
  it.each(["a", "ab", "a".repeat(33), "-abc", "abc-", "a--b", "ab--cd", "xn--abc", "Abc", "ab_c", "ab.c", "ab c", "ção", ""])(
    "rejeita %s",
    (value) => {
      expect(isSlugShape(value)).toBe(false);
    },
  );
  it("reconhece reservado e prefixo", () => {
    expect(isReservedSlug("www")).toBe(true);
    expect(isReservedSlug("cdn-01")).toBe(true);
    expect(isReservedSlug("barbearia-do-ze")).toBe(false);
  });
});

describe("classifyHost", () => {
  it("classifica o host base, o tenant e o desconhecido", () => {
    expect(classifyHost(null, root)).toEqual({ kind: "bad" });
    expect(classifyHost("a b.barber.workloop.com.br", root)).toEqual({ kind: "bad" });
    expect(classifyHost("barber.workloop.com.br", root)).toEqual({ kind: "base" });
    expect(classifyHost("www.barber.workloop.com.br", root)).toEqual({ kind: "redirect", host: root });
    expect(classifyHost("abc.barber.workloop.com.br", root)).toEqual({ kind: "tenant", slug: "abc" });
    expect(classifyHost("abc.barber.workloop.com.br.", root)).toEqual({
      kind: "redirect",
      host: "abc.barber.workloop.com.br",
    });
    expect(classifyHost("app.barber.workloop.com.br", root)).toEqual({ kind: "special", name: "app" });
    expect(classifyHost("a.b.barber.workloop.com.br", root)).toEqual({ kind: "unknown" });
    expect(classifyHost("127.0.0.1", root)).toEqual({ kind: "unknown" });
    expect(classifyHost("evil.com", root)).toEqual({ kind: "unknown" });
    expect(classifyHost("localhost:3000", "localhost")).toEqual({ kind: "base" });
    expect(classifyHost("abc.localhost:3000", "localhost")).toEqual({ kind: "tenant", slug: "abc" });
  });
});

describe("safeNextPath e tenantUrl", () => {
  it("aceita path relativo canônico", () => {
    expect(safeNextPath("/agendar?d=2026-11-21")).toBe("/agendar?d=2026-11-21");
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/x/")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("/x%0d%0aSet-Cookie:a=b")).toBeNull();
    expect(safeNextPath("/%5cevil.com")).toBeNull();
    expect(safeNextPath("\\\\evil.com")).toBeNull();
  });
  it("monta a URL do tenant só com o slug aprovado", () => {
    expect(tenantUrl("abc", "/x", cfg)).toBe("https://abc.barber.workloop.com.br/x");
    expect(() => tenantUrl("abc", "//evil.com", cfg)).toThrow();
    expect(() => tenantUrl("api", "/", cfg)).toThrow();
  });
});

describe("resolveLogin", () => {
  const a = { slug: "ativo", displayName: "Ativo" };
  const b = { slug: "trial1", displayName: "Trial" };
  const pending = { slug: "suspenso", displayName: "Suspenso", status: "suspended" };
  it("escolhe nenhum, regularização, handoff ou lista", () => {
    expect(resolveLogin([], [])).toEqual({ kind: "none" });
    expect(resolveLogin([], [pending])).toEqual({ kind: "redirect", location: "/login/regularizar" });
    expect(resolveLogin([a], [])).toEqual({ kind: "handoff", slug: "ativo" });
    expect(resolveLogin([a], [pending])).toEqual({ kind: "choose", items: [a], pending: true });
    expect(resolveLogin([a, b], [])).toEqual({ kind: "choose", items: [a, b], pending: false });
  });
  it("rejeita coluna extra na regularização", () => {
    expect(() => parseRegularizationRow({ slug: "a", display_name: "A", status: "suspended", reason_code: "x", action_code: "y", extra: "z" })).toThrow();
  });
});

describe("middleware de host", () => {
  it("mantém o 400 de path antes do host", async () => {
    const response = await call("/..;x/", "naoexiste.barber.workloop.com.br");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_path" });
  });
  it("redireciona www e a barra num salto", async () => {
    const response = await call("/foo/?a=1", "www.barber.workloop.com.br");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://barber.workloop.com.br/foo?a=1");
  });
  it("rejeita host malformado", async () => {
    const response = await call("/", "a b.barber.workloop.com.br");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_host" });
  });
  it("entrega o selo no rewrite e não repassa x-bc do cliente", async () => {
    const request = new NextRequest(new URL("/", "http://slug.barber.workloop.com.br"), {
      headers: { host: root, "x-bc-route": "landing", "x-bc-evil": "1" },
    });
    const response = await middleware(request);
    const override = (response.headers.get("x-middleware-override-headers") ?? "").toLowerCase().split(",");
    expect(override).toContain("x-bc-seal");
    expect(override).not.toContain("x-bc-route");
    expect(override).not.toContain("x-bc-evil");
    expect((response.headers.get("x-middleware-request-x-bc-seal") ?? "").length).toBeGreaterThan(16);
    expect(response.headers.get("x-middleware-request-x-bc-route")).toBeNull();
  });
  it("assina o selo com o Host real e não com o x-bc-host do cliente", async () => {
    const request = new NextRequest(new URL("/robots.txt", "http://slug.barber.workloop.com.br"), {
      headers: { host: `ativo.${root}`, "x-bc-host": `trial1.${root}` },
    });
    const response = await middleware(request);
    expect(response.headers.get("x-middleware-request-x-bc-host")).toBe(`ativo.${root}`);
  });
  it("em /api/internal o x-bc-host do cliente não troca o host do ativo", async () => {
    const request = new NextRequest(new URL("/api/internal/revalidate", "http://slug.barber.workloop.com.br"), {
      headers: { host: `ativo.${root}`, "x-bc-host": `trial1.${root}` },
    });
    const response = await middleware(request);
    expect(response.headers.get("x-middleware-rewrite") ?? "").toContain("/__bc/404");
    expect(response.headers.get("x-middleware-request-x-bc-host")).toBe(`ativo.${root}`);
  });
  it("não repassa x-bc-host no passthrough de /api", async () => {
    const request = new NextRequest(new URL("/api/health/live", "http://slug.barber.workloop.com.br"), {
      headers: { host: `ativo.${root}`, "x-bc-host": `trial1.${root}` },
    });
    const response = await middleware(request);
    const override = (response.headers.get("x-middleware-override-headers") ?? "").toLowerCase();
    expect(override.split(",")).not.toContain("x-bc-host");
    expect(response.headers.get("x-middleware-request-x-bc-host")).toBeNull();
  });
  it("responde 404 ao path interno com header forjado", async () => {
    const request = new NextRequest(new URL("/tenant/trial1", "http://slug.barber.workloop.com.br"), {
      headers: { host: `ativo.${root}`, "x-bc-route": "tenant:trial1", "x-bc-seal": "forjado" },
    });
    const response = await middleware(request);
    const target = response.headers.get("x-middleware-rewrite") ?? "";
    expect(target).toContain("/__bc/404");
    expect(target).not.toContain("trial1");
  });
  it("não deixa o rewrite sair do prefixo", () => {
    for (let i = 0; i < 200; i += 1) {
      const noise = `/${"a".repeat(i % 8)}`;
      const joined = safeJoin("/tenant/abc", noise);
      expect(joined === null || joined.startsWith("/tenant/abc")).toBe(true);
    }
  });
});

describe("loadConfig", () => {
  it("recusa produção sem APP_ENV e sem ROOT_DOMAIN", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/APP_ENV/);
    expect(() => loadConfig({ NODE_ENV: "production", APP_ENV: "production" })).toThrow(/ROOT_DOMAIN/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        APP_ENV: "production",
        ROOT_DOMAIN: "barber.workloop.com.br",
        PUBLIC_SCHEME: "https",
        PUBLIC_PORT: "",
      }),
    ).toThrow(/BC_ROUTE_SECRET/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        APP_ENV: "staging",
        ROOT_DOMAIN: "barber-staging.workloop.com.br",
        PUBLIC_SCHEME: "https",
        PUBLIC_PORT: "",
      }),
    ).toThrow(/BC_ROUTE_SECRET/);
  });
});

describe("links externos", () => {
  it("recusa placeholder e host parecido", () => {
    expect(() => assertExternal("https://wa.me/⟦numero⟧")).toThrow();
    expect(() => assertExternal("https://wa.me.evil.com/1")).toThrow();
    expect(() => assertExternal("https://user@wa.me/1")).toThrow();
  });
});
