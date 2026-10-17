import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./.tameion/deployment-approval.json", "./.tameion/operator-source.json", "./.tameion/financial-source.json", "./.tameion/financial-requester.json"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
