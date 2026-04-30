import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output generates a self-contained server bundle for Docker
  // containers. Required for the App Service container deployment.
  output: "standalone",
};

export default nextConfig;
