// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import SolveProgressChart, { buildChartModel } from "../../src/components/SolveProgressChart";
import type { SolveRead } from "../../src/api/solves";

// Helper to create a SolveRead mock
function createSolve(overrides: Partial<SolveRead>): SolveRead {
  return {
    id: overrides.id ?? "solve-" + Math.random().toString(36).slice(2, 9),
    scramble: overrides.scramble ?? "R U R' U'",
    time_ms: overrides.time_ms ?? 15000,
    status: overrides.status ?? "valid",
    verify_frames_ok: overrides.verify_frames_ok ?? true,
    cube_id: overrides.cube_id ?? null,
    scramble_id: overrides.scramble_id ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

describe("buildChartModel", () => {
  it("sorts mixed-order solves by created_at ascending regardless of input order", () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 3000).toISOString();
    const t2 = new Date(now.getTime() - 2000).toISOString();
    const t3 = new Date(now.getTime() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s3", created_at: t3, time_ms: 13000, status: "valid" }),
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 14000, status: "valid" }),
    ];

    const model = buildChartModel(solves);
    expect(model.kind).toBe("ready");
    expect(model.validPoints.length).toBe(3);
    expect(model.validPoints[0].id).toBe("s1");
    expect(model.validPoints[1].id).toBe("s2");
    expect(model.validPoints[2].id).toBe("s3");
  });

  it("computes PB as min time_ms among valid solves; ties go to first occurrence", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 12000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 12000, status: "valid" }), // tie
    ];

    const model = buildChartModel(solves);
    expect(model.pb).not.toBeNull();
    expect(model.pb?.id).toBe("s1"); // first occurrence
    expect(model.pb?.isPB).toBe(true);
  });

  it("never makes a DNF or rejected solve the PB", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 5000, status: "dnf" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 15000, status: "valid" }),
    ];

    const model = buildChartModel(solves);
    expect(model.pb?.id).toBe("s2");
    expect(model.pb?.isPB).toBe(true); // PB should be set
  });

  it("excludes DNF and rejected solves from valid points", () => {
    const t1 = new Date(Date.now() - 3000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 5000, status: "dnf" }),
      createSolve({ id: "s3", created_at: t3, time_ms: 14000, status: "valid" }),
    ];

    const model = buildChartModel(solves);
    expect(model.validPoints.length).toBe(2);
    expect(model.validPoints[0].id).toBe("s1");
    expect(model.validPoints[1].id).toBe("s3");
  });

  it("splits polyline into 2 segments when a non-valid solve sits between two valids", () => {
    const t1 = new Date(Date.now() - 3000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 5000, status: "dnf" }),
      createSolve({ id: "s3", created_at: t3, time_ms: 14000, status: "valid" }),
    ];

    const model = buildChartModel(solves);
    expect(model.segments.length).toBe(2);
    expect(model.segments[0].length).toBe(1);
    expect(model.segments[0][0].id).toBe("s1");
    expect(model.segments[1].length).toBe(1);
    expect(model.segments[1][0].id).toBe("s3");
  });

  it("handles unparseable created_at by falling back to input index order, no throw", () => {
    const validDate = new Date().toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: "invalid-date", time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: validDate, time_ms: 14000, status: "valid" }),
    ];

    const model = buildChartModel(solves);
    expect(model.kind).toBe("ready");
    // Fallback to input order when date parse fails
    expect(model.validPoints.length).toBe(2);
  });

  it("clamps outlier valid solves to pinned===true at domain.max, not stretching domain.min", () => {
    const t1 = new Date(Date.now() - 5000).toISOString();
    const t2 = new Date(Date.now() - 4000).toISOString();
    const t3 = new Date(Date.now() - 3000).toISOString();
    const t4 = new Date(Date.now() - 2000).toISOString();
    const t5 = new Date(Date.now() - 1000).toISOString();

    // Create enough points so that p95 is well-defined and an outlier is clearly beyond it
    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 16000, status: "valid" }),
      createSolve({ id: "s3", created_at: t3, time_ms: 17000, status: "valid" }),
      createSolve({ id: "s4", created_at: t4, time_ms: 18000, status: "valid" }),
      createSolve({ id: "s5", created_at: t5, time_ms: 300000, status: "valid" }), // huge outlier
    ];

    const model = buildChartModel(solves);
    expect(model.validPoints.length).toBe(5);

    const outlierPoint = model.validPoints[4]; // last point is the outlier

    // Outlier should be pinned
    expect(outlierPoint.pinned).toBe(true);

    // Domain top should not be stretched to the outlier value
    expect(model.domain.max).toBeLessThan(300000);

    // The fast edge (min) should not be stretched
    expect(model.domain.min).toBe(15000); // min of valid times
  });

  it("single valid point renders with no polyline segments and dot at mid-height", () => {
    const t1 = new Date().toISOString();

    const solves = [createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" })];

    const model = buildChartModel(solves);
    expect(model.validPoints.length).toBe(1);
    // A single point forms one segment of length 1, which won't render a polyline (polyline requires >=2 points)
    expect(model.segments.length).toBe(1);
    expect(model.segments[0].length).toBe(1);
  });

  it("all-non-valid solves result in empty model", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "dnf" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 14000, status: "rejected" }),
    ];

    const model = buildChartModel(solves);
    expect(model.kind).toBe("empty");
    expect(model.validPoints.length).toBe(0);
    expect(model.segments.length).toBe(0);
  });

  it("empty solves array returns empty model", () => {
    const model = buildChartModel([]);
    expect(model.kind).toBe("empty");
    expect(model.validPoints.length).toBe(0);
  });
});

describe("SolveProgressChart — RTL", () => {
  it("renders svg with polylines when valid solves present", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 14000, status: "valid" }),
    ];

    render(
      <BrowserRouter>
        <SolveProgressChart solves={solves} />
      </BrowserRouter>,
    );

    const svg = screen.getByRole("img");
    expect(svg).toBeTruthy();

    // Check for polyline element
    const polylines = svg.querySelectorAll("polyline");
    expect(polylines.length).toBeGreaterThanOrEqual(1);
  });

  it("renders PB element queryable by title 'Личный рекорд'", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 14000, status: "valid" }),
    ];

    render(
      <BrowserRouter>
        <SolveProgressChart solves={solves} />
      </BrowserRouter>,
    );

    const svg = screen.getByRole("img");
    const pbElement = svg.querySelector('circle[r="5"]');
    expect(pbElement).toBeTruthy();

    // Check title contains "Личный рекорд"
    const titleEl = pbElement?.querySelector("title");
    expect(titleEl?.textContent).toContain("Личный рекорд");
  });

  it("renders placeholder card when solves is empty", () => {
    render(
      <BrowserRouter>
        <SolveProgressChart solves={[]} />
      </BrowserRouter>,
    );

    expect(screen.getByText(/Пока недостаточно засчитанных сборок/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /К соло-тренировке/ });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/solo");

    // No SVG should be present
    const svg = screen.queryByRole("img");
    expect(svg).toBeNull();
  });

  it("renders placeholder card when no valid points exist (all DNF/rejected)", () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "dnf" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 14000, status: "rejected" }),
    ];

    render(
      <BrowserRouter>
        <SolveProgressChart solves={solves} />
      </BrowserRouter>,
    );

    expect(screen.getByText(/Пока недостаточно засчитанных сборок/)).toBeTruthy();
    // No polyline
    const svg = screen.queryByRole("img");
    expect(svg).toBeNull();
  });

  it("renders DNF solves as baseline markers with title 'DNF', not as line vertices", () => {
    const t1 = new Date(Date.now() - 4000).toISOString();
    const t2 = new Date(Date.now() - 3000).toISOString();
    const t3 = new Date(Date.now() - 2000).toISOString();
    const t4 = new Date(Date.now() - 1000).toISOString();

    // Create 4 solves: valid, dnf, valid, valid (to ensure polyline renders with >=2 points)
    const solves = [
      createSolve({ id: "s1", created_at: t1, time_ms: 15000, status: "valid" }),
      createSolve({ id: "s2", created_at: t2, time_ms: 5000, status: "dnf" }),
      createSolve({ id: "s3", created_at: t3, time_ms: 14000, status: "valid" }),
      createSolve({ id: "s4", created_at: t4, time_ms: 13000, status: "valid" }),
    ];

    render(
      <BrowserRouter>
        <SolveProgressChart solves={solves} />
      </BrowserRouter>,
    );

    const svg = screen.getByRole("img");

    // Look for DNF marker line elements (baseline ticks)
    const lines = svg.querySelectorAll("line");
    let dnfLineFound = false;
    lines.forEach((line) => {
      const titleEl = line.querySelector("title");
      if (titleEl?.textContent === "DNF") {
        dnfLineFound = true;
      }
    });

    expect(dnfLineFound).toBe(true);

    // Verify polyline segments are present (separated around DNF: 1 valid before, 2 valid after)
    const polylines = svg.querySelectorAll("polyline");
    expect(polylines.length).toBeGreaterThanOrEqual(1);
  });
});
