import { writeFileSync, mkdirSync } from "node:fs";
import { loadSkuRows } from "./data.js";
import { computeMetrics, round2 } from "./metrics.js";
import { recommend } from "./recommend.js";
import type { AnalysisFacts } from "./types.js";

const rows = loadSkuRows(new URL("../data/mock_data.csv", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const metrics = rows.map(computeMetrics);
const recommendations = recommend(metrics);

const revenue = (mIdx: number) =>
  round2(rows.reduce((sum, r, i) => sum + metrics[i].combined[mIdx] * r.retailPriceUsd, 0));

const byGrowth = [...metrics].sort((a, b) => b.growthRate - a.growthRate);
const m4Revenue = metrics
  .map((m, i) => ({ sku: m.sku, rev: m.combined[3] * rows[i].retailPriceUsd }))
  .sort((a, b) => b.rev - a.rev);

const facts: AnalysisFacts = {
  generatedFor: "March 2026 (M4)",
  metrics,
  recommendations,
  totals: {
    m4RevenueUsd: revenue(3),
    m3RevenueUsd: revenue(2),
    bestSellersByM4Revenue: m4Revenue.slice(0, 3).map((x) => x.sku),
    fastestGrowers: byGrowth.slice(0, 3).map((m) => m.sku),
    decliners: metrics.filter((m) => m.growthRate < 0).map((m) => m.sku),
  },
};

mkdirSync(new URL("../output", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), { recursive: true });
writeFileSync(
  new URL("../output/facts.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  JSON.stringify(facts, null, 2),
);

// Console summary for a quick human sanity check.
console.log(`M4 revenue: $${facts.totals.m4RevenueUsd.toLocaleString("en-US")} (M3: $${facts.totals.m3RevenueUsd.toLocaleString("en-US")})`);
console.table(
  metrics.map((m) => ({
    SKU: m.sku,
    "M4 demand": m.baselineDemand,
    "growth/mo": `${(m.growthRate * 100).toFixed(1)}%`,
    "cover (simple)": m.simpleMonthsCover,
    "runway (w/ orders)": m.runwayMonths,
    action: recommendations.find((r) => r.sku === m.sku)?.action,
    rank: recommendations.find((r) => r.sku === m.sku)?.priorityRank ?? "",
    "rev opp/mo": `$${Math.round(m.revenueOpportunity).toLocaleString("en-US")}`,
  })),
);
console.log("\nFacts written to output/facts.json");
