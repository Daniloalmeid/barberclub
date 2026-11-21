import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // O middleware precisa ver o path cru. Sem isto o Next normaliza %2e%2e
  // antes da função e redireciona /..;x/ com 308.
  skipMiddlewareUrlNormalize: true,
  skipTrailingSlashRedirect: true,
  transpilePackages: [
    "@barberclub/config",
    "@barberclub/core",
    "@barberclub/db",
    "@barberclub/payments",
    "@barberclub/ui",
  ],
};

export default nextConfig;
