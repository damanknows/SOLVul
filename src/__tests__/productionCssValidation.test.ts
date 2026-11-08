// src/__tests__/productionCssValidation.test.ts
import fs from "fs";
import path from "path";
import postcss from "postcss";

describe("Production Tailwind CSS Compilation & Configuration", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const tailwindConfigPath = path.join(rootDir, "tailwind.config.js");
  const postcssConfigPath = path.join(rootDir, "postcss.config.js");
  const globalsCssPath = path.join(rootDir, "src/web/styles/globals.css");
  const nextCssDir = path.join(rootDir, ".next/static/css");

  it("verifies tailwind.config.js includes all required content paths under src", () => {
    expect(fs.existsSync(tailwindConfigPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(tailwindConfigPath);
    expect(config.content).toBeDefined();
    expect(Array.isArray(config.content)).toBe(true);

    const contentPatterns: string[] = config.content;
    const coversSrc = contentPatterns.some((pattern) =>
      pattern.includes("./src") || pattern.includes("src/")
    );
    expect(coversSrc).toBe(true);
  });

  it("verifies postcss.config.js registers tailwindcss and autoprefixer plugins", () => {
    expect(fs.existsSync(postcssConfigPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(postcssConfigPath);
    expect(config.plugins).toBeDefined();
    expect(config.plugins.tailwindcss).toBeDefined();
    expect(config.plugins.autoprefixer).toBeDefined();
  });

  it("compiles globals.css through PostCSS & Tailwind without unresolved @tailwind directives", async () => {
    expect(fs.existsSync(globalsCssPath)).toBe(true);
    const rawCss = fs.readFileSync(globalsCssPath, "utf-8");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tailwindPlugin = require("tailwindcss")(tailwindConfigPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const autoprefixerPlugin = require("autoprefixer")();

    const result = await postcss([tailwindPlugin, autoprefixerPlugin]).process(rawCss, {
      from: globalsCssPath,
    });

    const compiledCss = result.css;

    // Must not contain unresolved directives
    expect(compiledCss).not.toContain("@tailwind base");
    expect(compiledCss).not.toContain("@tailwind components");
    expect(compiledCss).not.toContain("@tailwind utilities");

    // Must contain Tailwind preflight styles and utility classes
    expect(compiledCss).toContain("box-sizing");
    expect(compiledCss).toContain("--tw-");
    expect(compiledCss.length).toBeGreaterThan(15000); // Compiled stylesheet is >15KB
  });

  it("verifies that if .next/static/css exists, production assets contain no unresolved directives", () => {
    if (!fs.existsSync(nextCssDir)) {
      // In clean checkout before build, skip directory inspection
      return;
    }

    const cssFiles = fs.readdirSync(nextCssDir).filter((f) => f.endsWith(".css"));
    if (cssFiles.length === 0) {
      return;
    }

    for (const file of cssFiles) {
      const filePath = path.join(nextCssDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const stat = fs.statSync(filePath);

      // Must be compiled, not the 56-byte directive stub
      expect(stat.size).toBeGreaterThan(1000);

      // Zero unresolved directives
      expect(content).not.toContain("@tailwind base");
      expect(content).not.toContain("@tailwind components");
      expect(content).not.toContain("@tailwind utilities");

      // Preflight and variables present
      expect(content).toContain("box-sizing");
      expect(content).toContain("--tw-");
    }
  });
});
