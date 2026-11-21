export type PublicCfg = {
  appEnv: string;
  rootDomain: string;
  scheme: "http" | "https";
  port: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PublicCfg {
  const appEnv = env.APP_ENV ?? "development";
  const rootDomain = env.ROOT_DOMAIN || (appEnv === "production" ? "" : "barber.workloop.com.br");
  const schemeValue = env.PUBLIC_SCHEME || (appEnv === "development" ? "http" : "https");
  const port = env.PUBLIC_PORT ?? (appEnv === "development" ? "3000" : "");
  if (schemeValue !== "http" && schemeValue !== "https") {
    throw new Error("PUBLIC_SCHEME");
  }
  if (appEnv === "production") {
    if (rootDomain !== "barber.workloop.com.br") throw new Error("ROOT_DOMAIN");
    if (schemeValue !== "https") throw new Error("PUBLIC_SCHEME");
    if (port !== "") throw new Error("PUBLIC_PORT");
  }
  if (!rootDomain) throw new Error("ROOT_DOMAIN");
  return { appEnv, rootDomain, scheme: schemeValue, port };
}

export function originOf(cfg: PublicCfg, host: string): string {
  return `${cfg.scheme}://${host}${cfg.port ? `:${cfg.port}` : ""}`;
}
