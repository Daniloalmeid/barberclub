import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: [
    "@barberclub/config",
    "@barberclub/core",
    "@barberclub/db",
    "@barberclub/payments",
    "@barberclub/ui",
  ],
};

export default nextConfig;
