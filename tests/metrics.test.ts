import { describe, expect, it } from "vitest";
import { loadSkuRows } from "../src/data.js";
import { computeMetrics, geometricGrowth, simulateRunway } from "../src/metrics.js";
import { recommend } from "../src/recommend.js";
import { fileURLToPath } from "node:url";

const CSV = fileURLToPath(new URL("../data/mock_data.csv", import.meta.url));
const rows = loadSkuRows(CSV);
const metrics = rows.map(computeMetrics);
const recs = recommend(metrics);
const get = (sku: string) => {
  const m = metrics.find((x) => x.sku === sku);
  const r = recs.find((x) => x.sku === sku);
  if (!m || !r) throw new Error(`SKU not found: ${sku}`);
  return { m, r };
};

describe("data loading", () => {
  it("loads all 12 SKUs with sane values", () => {
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.retailPriceUsd).toBeGreaterThan(0);
      expect(row.targetMonthsCover === 2 || row.targetMonthsCover === 3).toBe(true);
    }
  });

  it("keeps the one 3-month target on MGO 1700+ 100g only", () => {
    const three = rows.filter((r) => r.targetMonthsCover === 3);
    expect(three.map((r) => r.sku)).toEqual(["Manuka Honey MGO 1700+ 100g"]);
  });
});

describe("growth math", () => {
  it("geometric growth reproduces the endpoints", () => {
    // 100 → 133.1 over 3 periods at exactly 10%/mo
    expect(geometricGrowth([100, 110, 121, 133.1])).toBeCloseTo(0.1, 10);
  });

  it("hand-checked: MGO 100+ combined growth ≈ 3.8%/mo", () => {
    const { m } = get("Manuka Honey MGO 100+ 250g");
    // combined M1=924, M4=1032 → (1032/924)^(1/3)-1
    expect(m.combined).toEqual([924, 928, 1024, 1032]);
    expect(m.growthRate).toBeCloseTo(Math.pow(1032 / 924, 1 / 3) - 1, 3);
  });

  it("Bioactive SKUs measure trend from M2, not the partial launch month", () => {
    for (const sku of metrics.filter((m) => m.isBioactive)) {
      expect(sku.trendFromMonth).toBe(2);
    }
    const { m } = get("Bioactive Blend Immunity 250g");
    // M2 combined = 256+168 = 424; M4 = 316+212 = 528 → 2-period window
    expect(m.growthRate).toBeCloseTo(Math.pow(528 / 424, 1 / 2) - 1, 3);
  });
});

describe("runway simulation", () => {
  it("flat demand, no order: exact division", () => {
    expect(simulateRunway({ stock: 600, baselineDemand: 100, growthRate: 0, unitsOnOrder: 0, orderArrivalMonths: 0 })).toBe(6);
  });

  it("an arriving order extends the runway", () => {
    const without = simulateRunway({ stock: 300, baselineDemand: 100, growthRate: 0, unitsOnOrder: 0, orderArrivalMonths: 0 });
    const withOrder = simulateRunway({ stock: 300, baselineDemand: 100, growthRate: 0, unitsOnOrder: 200, orderArrivalMonths: 2 });
    expect(without).toBe(3);
    expect(withOrder).toBe(5);
  });

  it("Order_Arrival_Months = 0 means NO order, not instant arrival", () => {
    const a = simulateRunway({ stock: 300, baselineDemand: 100, growthRate: 0, unitsOnOrder: 500, orderArrivalMonths: 0 });
    expect(a).toBe(3); // the 500 units must not be counted
  });

  it("growth shortens runway versus simple cover", () => {
    const { m } = get("Manuka Honey MGO 263+ 500g");
    expect(m.runwayMonths).toBeLessThan(m.simpleMonthsCover);
  });
});

describe("business rules", () => {
  it("recommends at least 3 reorders, ranked by revenue opportunity", () => {
    const ranked = recs.filter((r) => r.priorityRank !== null);
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    const now = ranked.filter((r) => r.action === "REORDER_NOW").sort((a, b) => a.priorityRank! - b.priorityRank!);
    for (let i = 1; i < now.length; i++) {
      expect(now[i - 1].revenueOpportunity).toBeGreaterThanOrEqual(now[i].revenueOpportunity);
    }
  });

  it("REORDER_NOW set matches the hand-derived list", () => {
    const nowSkus = recs.filter((r) => r.action === "REORDER_NOW").map((r) => r.sku).sort();
    expect(nowSkus).toEqual(
      [
        "Manuka Honey MGO 514+ 500g",
        "Manuka Honey MGO 850+ 500g",
        "Bioactive Blend Energy 250g",
        "Bioactive Blend Recovery 250g",
      ].sort(),
    );
  });

  it("Propolis is flagged, not reordered, while cover ≥ 30 days", () => {
    const { m, r } = get("Propolis Tincture 30ml");
    expect(m.runwayMonths).toBeGreaterThanOrEqual(1); // above the 30-day exception
    expect(m.runwayMonths).toBeLessThan(3); // stocks out inside the Q2 window
    expect(r.action).toBe("MONITOR");
    expect(r.tension).toMatch(/phase/i);
  });

  it("MGO 1700+ is judged against its 3-month target, not 2", () => {
    const { r } = get("Manuka Honey MGO 1700+ 100g");
    expect(r.targetMonthsCover).toBe(3);
    // 3.32 months runway would be NO_ACTION at a 2-month target; the 3-month target makes it act
    expect(r.action).toBe("REORDER_SOON");
  });

  it("catches the MGO 100+ Amazon latest-month dip that first→last growth smooths over", () => {
    const { m, r } = get("Manuka Honey MGO 100+ 250g");
    expect(m.flags.join(" ")).toMatch(/Amazon units fell in the latest month \(404 → 388\)/);
    expect(r.action).toBe("MONITOR");
  });

  it("revenue opportunity = retail price × projected demand", () => {
    for (const m of metrics) {
      const row = rows.find((r) => r.sku === m.sku)!;
      expect(m.revenueOpportunity).toBeCloseTo(m.projectedDemand * row.retailPriceUsd, 1);
    }
  });
});
