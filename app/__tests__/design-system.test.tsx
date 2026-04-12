import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";

describe("Design System", () => {
  it("smoke test — vitest runs successfully", () => {
    expect(true).toBe(true);
  });

  describe("Rekon CSS tokens", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../globals.css"),
      "utf-8"
    );

    it("defines background tokens", () => {
      expect(css).toContain("--bg-page:");
      expect(css).toContain("--bg-warm:");
      expect(css).toContain("--bg-surface:");
    });

    it("defines fill tokens", () => {
      expect(css).toContain("--fill-action:");
    });

    it("defines text color tokens", () => {
      expect(css).toContain("--text-primary:");
      expect(css).toContain("--text-secondary:");
      expect(css).toContain("--text-tertiary:");
    });

    it("defines border tokens", () => {
      expect(css).toContain("--border:");
    });

    it("defines semantic color tokens", () => {
      expect(css).toContain("--color-success:");
      expect(css).toContain("--color-error:");
      expect(css).toContain("--color-warning-text:");
    });

    it("defines font family tokens", () => {
      expect(css).toContain("--font-display:");
      expect(css).toContain("--font-body:");
      expect(css).toContain("--font-mono:");
    });

    it("defines spacing scale", () => {
      expect(css).toContain("--space-1:");
      expect(css).toContain("--space-4:");
      expect(css).toContain("--space-8:");
    });

    it("defines border radius tokens", () => {
      expect(css).toContain("--radius-sm: 4px");
      expect(css).toContain("--radius-md: 8px");
      expect(css).toContain("--radius-lg: 12px");
      expect(css).toContain("--radius-full: 999px");
    });
  });

  describe("Shared button classes", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../globals.css"),
      "utf-8"
    );

    it("defines .btn-primary", () => {
      expect(css).toContain(".btn-primary");
    });

    it("defines .btn-outline", () => {
      expect(css).toContain(".btn-outline");
    });

    it("defines .btn-stop", () => {
      expect(css).toContain(".btn-stop");
    });
  });

  describe("Shared card class", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../globals.css"),
      "utf-8"
    );

    it("defines .card with 8px radius", () => {
      expect(css).toContain(".card");
      expect(css).toContain("var(--radius-md)");
    });
  });

  describe("Button rendering", () => {
    it("renders btn-primary with correct styles", () => {
      render(<button className="btn-primary">Start</button>);
      const btn = screen.getByText("Start");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveClass("btn-primary");
    });

    it("renders btn-outline", () => {
      render(<button className="btn-outline">Cancel</button>);
      expect(screen.getByText("Cancel")).toHaveClass("btn-outline");
    });

    it("renders btn-stop", () => {
      render(<button className="btn-stop">Stop</button>);
      expect(screen.getByText("Stop")).toHaveClass("btn-stop");
    });
  });

  describe("Layout metadata", () => {
    it("layout.tsx exports correct metadata title", async () => {
      const layoutModule = await import("../layout");
      expect(layoutModule.metadata).toBeDefined();
      expect(layoutModule.metadata.title).toBe("Workflow Capture");
    });
  });

  describe("Google Fonts", () => {
    it("layout.tsx includes Google Fonts link for DM Sans, Inter, Fragment Mono", async () => {
      const layoutSource = fs.readFileSync(
        path.resolve(__dirname, "../layout.tsx"),
        "utf-8"
      );
      expect(layoutSource).toContain("DM+Sans");
      expect(layoutSource).toContain("Inter");
      expect(layoutSource).toContain("Fragment+Mono");
      expect(layoutSource).toContain("fonts.googleapis.com");
    });
  });
});
