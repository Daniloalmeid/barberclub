import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // O middleware vê o path cru e é quem emite o 308 da barra final.
  // Sem isto o Next colapsa %2e%2e e redireciona antes da validação.
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
