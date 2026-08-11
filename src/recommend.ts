import type { SkuMetrics, Recommendation } from "./types.js";
import { PHASE_OUT_HORIZON_MONTHS, round2 } from "./metrics.js";

/**
 * Decision rule (documented in README):
 * - REORDER_NOW  — runway (including confirmed orders) is below target cover.
 * - REORDER_SOON — runway clears target by less than one month, i.e. the next
 *                  order must be placed within this cycle to stay above target.
 * - MONITOR      — flagged tensions or channel declines worth watching.
 * - NO_ACTION    — comfortably covered.
 * Phase-out override: Propolis is only reordered if cover drops below 30 days
 * (runway < 1 month); otherwise its stockout risk inside Q2 is flagged, not acted on.
 * Priority among reorders = revenue opportunity (retail price × projected demand),
 * with declining-demand tensions surfaced instead of blindly re-ranked.
 */
export function recommend(metrics: SkuMetrics[]): Recommendation[] {
  const recs: Recommendation[] = metrics.map((m) => {
    const target = targetFor(m);
    let action: Recommendation["action"];
    let reasoning: string;
    let tension: string | null = null;

    if (m.isPhaseOut) {
      const stocksOutInsideQ2 = m.runwayMonths < PHASE_OUT_HORIZON_MONTHS;
      if (m.runwayMonths < 1) {
        action = "REORDER_NOW";
        reasoning = `Phase-out SKU, but cover is below 30 days (${m.runwayMonths} months) — the phase-out rule's own exception applies. Place a small final order sized to bridge the remaining sell-down, not to rebuild buffer.`;
      } else if (stocksOutInsideQ2) {
        action = "MONITOR";
        reasoning = `Projected to stock out in ~${m.runwayMonths} months — inside the Q2 2026 phase-out window. Demand is still growing (${pct(m.growthRate)}/mo), so this sells down naturally; deprioritized per phase-out policy unless cover drops below 30 days.`;
        tension = `Demand is growing ${pct(m.growthRate)}/mo on a product being phased out — natural sell-down is on track, but if the phase-out date slips, this becomes a stockout.`;
      } else {
        action = "NO_ACTION";
        reasoning = "Phase-out SKU with stock lasting past the Q2 window; let it sell down.";
      }
    } else if (m.runwayMonths < target) {
      action = "REORDER_NOW";
      reasoning = buildReorderReasoning(m, target);
    } else if (m.runwayMonths < target + 1) {
      action = "REORDER_SOON";
      reasoning = `Runway of ${m.runwayMonths} months clears the ${target}-month target by under a month. No emergency, but the next PO belongs in this cycle.`;
    } else {
      const watchFlag = m.flags.find(
        (f) => f.startsWith("Channel divergence") || f.includes("fell in the latest month"),
      );
      action = watchFlag ? "MONITOR" : "NO_ACTION";
      reasoning = watchFlag
        ? `Stock is healthy (${m.runwayMonths} months runway vs ${target} target) but the channel picture needs watching: ${watchFlag}`
        : `Covered: ${m.runwayMonths} months runway against a ${target}-month target.`;
    }

    if (!tension && action !== "NO_ACTION" && m.growthRate < 0) {
      tension = `High revenue at stake but demand is declining (${pct(m.growthRate)}/mo) — verify before committing a large PO.`;
    }

    return {
      sku: m.sku,
      action,
      priorityRank: null,
      revenueOpportunity: m.revenueOpportunity,
      runwayMonths: m.runwayMonths,
      targetMonthsCover: target,
      reasoning,
      tension,
    };
  });

  // Rank REORDER_NOW then REORDER_SOON by revenue opportunity.
  const ranked = recs
    .filter((r) => r.action === "REORDER_NOW" || r.action === "REORDER_SOON")
    .sort((a, b) => {
      if (a.action !== b.action) return a.action === "REORDER_NOW" ? -1 : 1;
      return b.revenueOpportunity - a.revenueOpportunity;
    });
  ranked.forEach((r, i) => (r.priorityRank = i + 1));
  return recs;
}

function targetFor(m: SkuMetrics): number {
  return m.sku === "Manuka Honey MGO 1700+ 100g" ? 3 : 2;
}

function buildReorderReasoning(m: SkuMetrics, target: number): string {
  const noOrder = m.runwayMonths === m.runwayWithoutOrderMonths;
  const orderNote = noOrder
    ? "No order is currently placed"
    : `Even counting the confirmed incoming order, runway is ${m.runwayMonths} months`;
  return `${orderNote}; stock runs out in ~${m.runwayMonths} months against a ${target}-month cover target while demand grows ${pct(m.growthRate)}/mo. Roughly $${fmt(m.revenueOpportunity)}/month of revenue is exposed if this stocks out.`;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export { targetFor };
