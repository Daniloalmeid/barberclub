import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

function call(path: string) {
  const request = new NextRequest(new URL(path, "http://slug.barber.workloop.com.br"));
  return middleware(request);
}

describe("middleware de entrada", () => {
  it("responde 400 para o que ainda chega depois do parser de URL", async () => {
    for (const path of ["/foo/%252e%252e/bar", "/foo/%252fbar", "/foo/%5c", "/foo/%2fbar", "/..;x/", "/a;b"]) {
      const response = call(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_path" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("deixa passar o health e um path comum", () => {
    expect(call("/api/health").status).toBe(200);
    expect(call("/api/health/live").status).toBe(200);
    expect(call("/agendar").status).toBe(200);
  });
});
