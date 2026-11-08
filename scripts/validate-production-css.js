#!/usr/bin/env node
// scripts/validate-production-css.js
/**
 * Automated Production CSS Compilation Validator
 *
 * Verifies that Next.js and PostCSS successfully compiled Tailwind directives
 * into production CSS assets under `.next/static/css/`.
 * Fails if any generated stylesheet contains unresolved `@tailwind` directives
 * or is suspiciously small (e.g. the 56-byte directive-only stylesheet).
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const CSS_DIR = path.join(ROOT_DIR, ".next", "static", "css");
const TAILWIND_CONFIG_PATH = path.join(ROOT_DIR, "tailwind.config.js");

console.log("🔍 Running production CSS validation...");

// 1. Verify tailwind.config.js content paths
if (!fs.existsSync(TAILWIND_CONFIG_PATH)) {
  console.error("❌ tailwind.config.js not found at " + TAILWIND_CONFIG_PATH);
  process.exit(1);
}

const tailwindConfig = require(TAILWIND_CONFIG_PATH);
const contentPaths = tailwindConfig.content || [];
console.log("  ✓ Tailwind content configuration:", JSON.stringify(contentPaths));

const hasSrcGlob = contentPaths.some((p) => p.includes("./src") || p.includes("src/"));
if (!hasSrcGlob) {
  console.error("❌ tailwind.config.js is missing src content paths! Expected './src/**/*.{js,ts,jsx,tsx}'.");
  process.exit(1);
}

// 2. Verify .next/static/css directory exists
if (!fs.existsSync(CSS_DIR)) {
  console.error(`❌ Generated CSS directory not found at ${CSS_DIR}. Run 'next build' first.`);
  process.exit(1);
}

const cssFiles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
if (cssFiles.length === 0) {
  console.error(`❌ No .css files found under ${CSS_DIR}`);
  process.exit(1);
}

console.log(`  ✓ Found ${cssFiles.length} generated CSS asset(s): ${cssFiles.join(", ")}`);

const FORBIDDEN_DIRECTIVES = [
  "@tailwind base",
  "@tailwind components",
  "@tailwind utilities",
  "@tailwind variants",
  "@tailwind screens",
];

const REQUIRED_PATTERNS = [
  "box-sizing", // Tailwind Preflight
  "--tw-",      // Tailwind CSS variables
];

let hasErrors = false;

for (const filename of cssFiles) {
  const filePath = path.join(CSS_DIR, filename);
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);

  console.log(`\n  Checking asset: ${filename} (${stats.size} bytes)...`);

  // Size assertion: uncompiled directives are ~56 bytes; compiled output is >15KB
  if (stats.size < 1000) {
    console.error(`  ❌ FAIL: Asset ${filename} size is only ${stats.size} bytes (too small, directives likely uncompiled).`);
    hasErrors = true;
  } else {
    console.log(`  ✓ Asset size is ${stats.size} bytes (substantially larger than 56-byte directive stub)`);
  }

  // Directive assertion: Must not contain raw @tailwind directives
  for (const directive of FORBIDDEN_DIRECTIVES) {
    if (content.includes(directive)) {
      console.error(`  ❌ FAIL: Asset ${filename} contains unresolved directive '${directive}'!`);
      hasErrors = true;
    }
  }

  // Preflight and utility assertions
  for (const pattern of REQUIRED_PATTERNS) {
    if (!content.includes(pattern)) {
      console.error(`  ❌ FAIL: Asset ${filename} is missing expected compiled Tailwind rule '${pattern}'!`);
      hasErrors = true;
    }
  }

  if (!hasErrors) {
    console.log(`  ✓ Asset ${filename} successfully verified (compiled Tailwind preflight and utilities present, no raw directives).`);
  }
}

if (hasErrors) {
  console.error("\n❌ Production CSS validation failed. Uncompiled Tailwind directives detected in production assets.");
  process.exit(1);
}

console.log("\n✅ All production CSS assets successfully validated! Tailwind compiled properly.");
