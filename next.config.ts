import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./.tameion/deployment-approval.json"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
