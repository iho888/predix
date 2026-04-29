const path = require("path")

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["recharts"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "stripe", "jose"],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "src"),
    }
    return config
  },
}

module.exports = nextConfig
