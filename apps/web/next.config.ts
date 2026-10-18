import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  transpilePackages: ["@chog/shared-types", "@chog/art-composition"],
  serverExternalPackages: ["mongodb"],
};
export default nextConfig;
