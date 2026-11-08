// src/__tests__/ssrAndDependencyIntegrity.test.tsx
import React from "react";
import { renderToString } from "react-dom/server";
import Overview from "../web/pages/overview";
import Home from "../web/pages/index";
import Inspector from "../web/pages/inspector";
import Settings from "../web/pages/settings";
import RiskReport from "../web/pages/risk-report";

describe("SSR and Dependency Regression Protection", () => {
  it("verifies rpc-websockets loads with CommonJS-compatible uuid without ERR_REQUIRE_ESM", () => {
    // Attempting to require rpc-websockets must not throw ERR_REQUIRE_ESM
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rpcWs = require("rpc-websockets");
      expect(rpcWs).toBeDefined();
    }).not.toThrow();
  });

  it("verifies @solana/web3.js and Connection can be imported without crashing", async () => {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    expect(Connection).toBeDefined();
    expect(PublicKey).toBeDefined();
    const pubkey = new PublicKey("11111111111111111111111111111111");
    expect(pubkey.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("renders /overview via SSR (renderToString) without throwing", () => {
    expect(() => {
      const html = renderToString(<Overview />);
      expect(html).toContain("Vulture");
      expect(html).toContain("Overview");
    }).not.toThrow();
  });

  it("renders / via SSR (renderToString) without invoking browser-only wallet logic", () => {
    expect(() => {
      const html = renderToString(<Home />);
      expect(html).toContain("SOLVul Pre-Sign Firewall Demo");
      expect(html).toContain("Connect Phantom Wallet");
    }).not.toThrow();
  });

  it("renders /inspector, /settings, /risk-report via SSR without crashing", () => {
    expect(() => {
      renderToString(<Inspector />);
      renderToString(<Settings />);
      renderToString(<RiskReport />);
    }).not.toThrow();
  });
});
