import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, experimental: { serverActions: { bodySizeLimit: "5mb" } } };
export default config;
