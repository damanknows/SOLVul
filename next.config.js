// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Enable TypeScript strict mode checks (already enforced by tsconfig)
  eslint: {
    // Lint during production builds
    ignoreDuringBuilds: false,
  },
};

module.exports = nextConfig;

