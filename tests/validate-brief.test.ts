import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadSkuRows } from "../src/data.js";
import { computeMetrics } from "../src/metrics.js";
import { recommend } from "../src/recommend.js";
import { validateBriefing } from "../src/validate-brief.js";
import type { AnalysisFacts } from "../src/types.js";

const CSV = fileURLToPath(new URL("../data/mock_data.csv", import.meta.url));
const rows = loadSkuRows(CSV);
const metrics = rows.map(computeMetrics);
const recommendations = recommend(metrics);

const facts: AnalysisFacts = {
  generatedFor: "March 2026 (M4)",
  metrics,
  recommendations,
  totals: {
    m4RevenueUsd: 0,
    m3RevenueUsd: 0,
    bestSellersByM4Revenue: [],
    fastestGrowers: [],
    decliners: [],
  },
};

const rankedLines = recommendations
  .filter((r) => r.priorityRank !== null)
  .sort((a, b) => a.priorityRank! - b.priorityRank!)
  .map((r) => `${r.priorityRank}. ${r.sku.replace("Manuka Honey ", "")} — reorder.`);

function narrative(opts: { whatSold?: string; stockRisk?: string; reorder?: string; dropWatchList?: boolean } = {}) {
  const sections = [
    "## The month in one paragraph\nA solid month.",
    `## What sold — and what the trend says\nSales grew broadly. ${opts.whatSold ?? ""}`,
    `## Stock risk\nSeveral SKUs are tight. ${opts.stockRisk ?? ""}`,
    `## Reorder decisions (ranked by revenue at stake)\n${opts.reorder ?? rankedLines.join("\n")}`,
    ...(opts.dropWatchList
      ? []
      : ["## Watch list\nPropolis Tincture 30ml sells down per phase-out policy. MGO 100+ 250g Amazon units dipped."]),
    "## The one tension worth discussing\nPropolis Tincture is growing while being phased out.",
  ];
  return sections.join("\n\n");
}

describe("validateBriefing", () => {
  it("accepts a well-formed narrative", () => {
    const result = validateBriefing(narrative(), facts);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts collective Bioactive references like 'the Bioactive Blend launch' (v1 false-positive regression)", () => {
    const result = validateBriefing(narrative({ whatSold: "The Bioactive Blend launch is working." }), facts);
    expect(result.failures).toEqual([]);
  });

  it("rejects an invented Bioactive variant", () => {
    const result = validateBriefing(narrative({ whatSold: "Bioactive Blend Focus 250g is coming soon." }), facts);
    expect(result.failures.some((f) => f.includes("Bioactive Blend Focus"))).toBe(true);
  });

  it("rejects an invented size variant of a real strength", () => {
    const result = validateBriefing(narrative({ stockRisk: "MGO 850+ 100g is also worth a look." }), facts);
    expect(result.failures.some((f) => f.includes("MGO 850+ 100g"))).toBe(true);
  });

  it("rejects an unknown MGO strength", () => {
    const result = validateBriefing(narrative({ stockRisk: "Consider adding MGO 999+ to the range." }), facts);
    expect(result.failures.some((f) => f.includes("MGO 999"))).toBe(true);
  });

  it("rejects the phase-out SKU inside the reorder section", () => {
    const reorder = `${rankedLines.join("\n")}\n7. Propolis Tincture 30ml — reorder as well.`;
    const result = validateBriefing(narrative({ reorder }), facts);
    expect(result.failures.some((f) => f.includes("Phase-out SKU appears inside"))).toBe(true);
  });

  it("rejects a missing section", () => {
    const result = validateBriefing(narrative({ dropWatchList: true }), facts);
    expect(result.failures.some((f) => f.includes('"## Watch list"'))).toBe(true);
  });

  it("rejects a broken priority ranking order", () => {
    const result = validateBriefing(narrative({ reorder: [...rankedLines].reverse().join("\n") }), facts);
    expect(result.failures.some((f) => f.includes("ranking order violated"))).toBe(true);
  });
});
