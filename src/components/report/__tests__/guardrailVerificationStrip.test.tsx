// src/components/report/__tests__/guardrailVerificationStrip.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import GuardrailVerificationStrip from "../GuardrailVerificationStrip";

describe("GuardrailVerificationStrip Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("1. Renders all 4 live verification badges with PASS indicators", async () => {
    await act(async () => {
      root.render(<GuardrailVerificationStrip />);
    });

    // Strip rendered
    expect(container.querySelector("[data-testid='guardrail-verification-strip']")).not.toBeNull();

    // 4 Badges
    const badgeStrs = container.querySelector("[data-testid='badge-strs-locked']");
    expect(badgeStrs).not.toBeNull();
    expect(badgeStrs?.textContent).toContain("STRS Score Locked Pre-LLM");

    const badgeMemo = container.querySelector("[data-testid='badge-memo-sanitized']");
    expect(badgeMemo).not.toBeNull();
    expect(badgeMemo?.textContent).toContain("Untrusted Memo / Metadata Sanitized");

    const badgeZod = container.querySelector("[data-testid='badge-zod-verified']");
    expect(badgeZod).not.toBeNull();
    expect(badgeZod?.textContent).toContain("Zod Schema & Finding-ID Verified");

    const badgeSafe = container.querySelector("[data-testid='badge-readonly-safe']");
    expect(badgeSafe).not.toBeNull();
    expect(badgeSafe?.textContent).toContain("No Private Keys or Auto-Broadcast");
  });

  test("2. Toggles technical telemetry details view", async () => {
    await act(async () => {
      root.render(<GuardrailVerificationStrip />);
    });

    // Telemetry details panel is hidden by default
    expect(container.querySelector("[data-testid='telemetry-details-panel']")).toBeNull();

    // Click toggle button
    const toggleBtn = container.querySelector("[data-testid='toggle-telemetry-details-btn']");
    expect(toggleBtn).not.toBeNull();

    await act(async () => {
      (toggleBtn as HTMLButtonElement).click();
    });

    // Telemetry details panel is now visible
    const detailsPanel = container.querySelector("[data-testid='telemetry-details-panel']");
    expect(detailsPanel).not.toBeNull();
    expect(detailsPanel?.textContent).toContain("Pre-Flight STRS Mathematical Scoring Active");
    expect(detailsPanel?.textContent).toContain("Zod GeminiExplanationSchema");
  });

  test("3. Displays Deterministic-Only Mode badge when isOfflineMode is true", async () => {
    await act(async () => {
      root.render(<GuardrailVerificationStrip isOfflineMode={true} />);
    });

    const offlineBadge = container.querySelector("[data-testid='badge-offline-mode']");
    expect(offlineBadge).not.toBeNull();
    expect(offlineBadge?.textContent).toContain("Deterministic-Only Mode");
  });

  test("4. Highlights Adversarial Injection Neutralized when injectionDetected is true", async () => {
    await act(async () => {
      root.render(<GuardrailVerificationStrip injectionDetected={true} />);
    });

    const neutralizedBadge = container.querySelector("[data-testid='badge-injection-neutralized']");
    expect(neutralizedBadge).not.toBeNull();
    expect(neutralizedBadge?.textContent).toContain("NEUTRALIZED");
  });
});
