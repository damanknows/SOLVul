// src/web/components/JudgeQuickTour.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import JudgeQuickTour from "./JudgeQuickTour";

describe("JudgeQuickTour Component", () => {
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

  it("1. Renders 3 steps and quick tour title by default", async () => {
    await act(async () => {
      root.render(<JudgeQuickTour />);
    });

    expect(container.querySelector("[data-testid='judge-quick-tour']")).not.toBeNull();
    expect(container.textContent).toContain("Hackathon Judge Quick-Tour");
    expect(container.querySelector("[data-testid='judge-tour-step-1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='judge-tour-step-2']")).not.toBeNull();
    expect(container.querySelector("[data-testid='judge-tour-step-3']")).not.toBeNull();
  });

  it("2. Collapses and expands when toggle button is clicked", async () => {
    await act(async () => {
      root.render(<JudgeQuickTour defaultExpanded={true} />);
    });

    const toggleBtn = container.querySelector("[data-testid='judge-tour-toggle']") as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();

    // Initially expanded
    expect(container.querySelector("[data-testid='judge-tour-step-1']")).not.toBeNull();

    // Click to collapse
    await act(async () => {
      toggleBtn.click();
    });
    expect(container.querySelector("[data-testid='judge-tour-step-1']")).toBeNull();

    // Click to expand again
    await act(async () => {
      toggleBtn.click();
    });
    expect(container.querySelector("[data-testid='judge-tour-step-1']")).not.toBeNull();
  });

  it("3. Calls onSelectScenario when Step 1 launch button is clicked", async () => {
    const handleSelectScenario = jest.fn();
    await act(async () => {
      root.render(<JudgeQuickTour onSelectScenario={handleSelectScenario} />);
    });

    const step1Btn = container.querySelector("[data-testid='judge-tour-step-1-btn']") as HTMLButtonElement;
    expect(step1Btn).not.toBeNull();

    await act(async () => {
      step1Btn.click();
    });

    expect(handleSelectScenario).toHaveBeenCalledWith("assign-memo-injection");
    expect(container.textContent).toContain("Payload Synthesized");
  });

  it("4. Renders navigation link to inspector when onSelectScenario is not provided", async () => {
    await act(async () => {
      root.render(<JudgeQuickTour />);
    });

    const link = container.querySelector("[data-testid='judge-tour-go-inspector']") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/inspector");
  });
});
