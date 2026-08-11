import type { SkuRow, SkuMetrics } from "./types.js";

export const BIOACTIVE_PREFIX = "Bioactive Blend";
export const PHASE_OUT_SKU = "Propolis Tincture 30ml";
/** M4 = March 2026. Q2 2026 ends in June = 3 months after M4. */
export const PHASE_OUT_HORIZON_MONTHS = 3;

/** Geometric mean month-over-month growth between first and last value of a window. */
export function geometricGrowth(values: number[]): number {
  const first = values[0];
  const last = values[values.length - 1];
  const periods = values.length - 1;
  if (periods < 1 || first <= 0) return 0;
  return Math.pow(last / first, 1 / periods) - 1;
}

/**
 * Simulate months until stockout. Demand starts at baseline and compounds by
 * growthRate each month. A confirmed order (if any) lands at the START of month
 * `orderArrivalMonths` (1 = start of next month). Returns fractional months,
 * capped at `capMonths`.
 */
export function simulateRunway(opts: {
  stock: number;
  baselineDemand: number;
  growthRate: number;
  unitsOnOrder: number;
  orderArrivalMonths: number; // 0 = no order
  capMonths?: number;
}): number {
  const cap = opts.capMonths ?? 24;
  let stock = opts.stock;
  let demand = opts.baselineDemand;
  if (demand <= 0) return cap;
  for (let month = 1; month <= cap; month++) {
    demand = demand * (1 + opts.growthRate);
    if (opts.orderArrivalMonths > 0 && month === opts.orderArrivalMonths) {
      stock += opts.unitsOnOrder;
    }
    if (stock < demand) {
      return month - 1 + stock / demand;
    }
    stock -= demand;
  }
  return cap;
}

export function computeMetrics(row: SkuRow): SkuMetrics {
  const combined = row.shopify.map((s, i) => s + row.amazon[i]) as [number, number, number, number];
  const isBioactive = row.sku.startsWith(BIOACTIVE_PREFIX);
  const isPhaseOut = row.sku === PHASE_OUT_SKU;
  // Bioactive launched mid-January (M2): a trend against a partial launch month M1 would overstate growth.
  const trendFromMonth = isBioactive ? 2 : 1;
  const window = combined.slice(trendFromMonth - 1);
  const growthRate = geometricGrowth(window);
  const perChannelGrowth = {
    shopify: geometricGrowth(row.shopify.slice(trendFromMonth - 1)),
    amazon: geometricGrowth(row.amazon.slice(trendFromMonth - 1)),
  };
  const baselineDemand = combined[3];
  const projectedDemand = Math.round(baselineDemand * (1 + growthRate));
  const revenueOpportunity = Math.round(projectedDemand * row.retailPriceUsd * 100) / 100;
  const simpleMonthsCover = round2(row.stockOnHand / baselineDemand);
  const runwayMonths = round2(
    simulateRunway({
      stock: row.stockOnHand,
      baselineDemand,
      growthRate,
      unitsOnOrder: row.unitsOnOrder,
      orderArrivalMonths: row.orderArrivalMonths,
    }),
  );
  const runwayWithoutOrderMonths = round2(
    simulateRunway({
      stock: row.stockOnHand,
      baselineDemand,
      growthRate,
      unitsOnOrder: 0,
      orderArrivalMonths: 0,
    }),
  );

  const flags: string[] = [];
  if (isBioactive) flags.push("Launched mid-January 2026 — trend measured M2→M4.");
  if (isPhaseOut) flags.push("Phase-out in Q2 2026 — reorder only if cover falls below 30 days.");
  if (row.sku === "Manuka Honey MGO 1700+ 100g")
    flags.push("Premium price point and longer supplier lead time — target cover is 3 months.");
  if (perChannelGrowth.shopify > 0 && perChannelGrowth.amazon < 0)
    flags.push("Channel divergence: Shopify growing while Amazon declines.");
  if (perChannelGrowth.amazon > 0 && perChannelGrowth.shopify < 0)
    flags.push("Channel divergence: Amazon growing while Shopify declines.");
  // A trend measured first→last smooths over a reversal in the latest month —
  // surface any channel whose most recent month dipped, even if the window is up overall.
  if (row.amazon[3] < row.amazon[2])
    flags.push(
      `Amazon units fell in the latest month (${row.amazon[2]} → ${row.amazon[3]}) even though the overall trend is up — watch channel mix before extrapolating growth.`,
    );
  if (row.shopify[3] < row.shopify[2])
    flags.push(
      `Shopify units fell in the latest month (${row.shopify[2]} → ${row.shopify[3]}) even though the overall trend is up — watch channel mix before extrapolating growth.`,
    );

  return {
    sku: row.sku,
    combined,
    baselineDemand,
    trendFromMonth,
    growthRate: round4(growthRate),
    perChannelGrowth: { shopify: round4(perChannelGrowth.shopify), amazon: round4(perChannelGrowth.amazon) },
    projectedDemand,
    revenueOpportunity,
    simpleMonthsCover,
    runwayMonths,
    runwayWithoutOrderMonths,
    isBioactive,
    isPhaseOut,
    flags,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
