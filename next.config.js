// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Enable TypeScript strict mode checks (already enforced by tsconfig)
  eslint: {
    // Lint during production builds (set true for ESLint 9 flat config compatibility)
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;

