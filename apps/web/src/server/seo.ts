import { canonicalUrl, loadConfig } from "@barberclub/core";

export function robotsBody(host: "base" | "tenant" | "closed", slug?: string): string {
  const cfg = loadConfig();
  if (cfg.appEnv !== "production" || host === "closed") {
    return "User-agent: *\nDisallow: /\n";
  }
  if (host === "base") {
    return `User-agent: *\nAllow: /\nDisallow: /login\nSitemap: ${cfg.scheme}://${cfg.rootDomain}/sitemap.xml\n`;
  }
  return `User-agent: *\nAllow: /\nDisallow: /auth/\nSitemap: ${cfg.scheme}://${slug}.${cfg.rootDomain}/sitemap.xml\n`;
}

export function landingSitemap(): string {
  const cfg = loadConfig();
  const urls = ["/", "/termos", "/privacidade"].map((path) =>
    canonicalUrl({ kind: "landing" }, path, cfg),
  );
  return xml(urls);
}

export function tenantSitemap(slug: string): string {
  const cfg = loadConfig();
  return xml([canonicalUrl({ kind: "tenant", slug }, "/", cfg)]);
}

function xml(urls: string[]): string {
  const body = urls.map((url) => `<url><loc>${url}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}
