export interface SkuRow {
  sku: string;
  shopify: [number, number, number, number]; // M1..M4 units
  amazon: [number, number, number, number]; // M1..M4 units
  stockOnHand: number;
  unitsOnOrder: number;
  orderArrivalMonths: number; // 0 = no order placed
  targetMonthsCover: number;
  retailPriceUsd: number;
}

export interface SkuMetrics {
  sku: string;
  combined: [number, number, number, number];
  /** Combined Shopify + Amazon units in M4 — the brief's mandated sell-through baseline. */
  baselineDemand: number;
  /** Month index the trend starts at (1-based). Bioactive launched mid-Jan → M2. */
  trendFromMonth: number;
  /** Geometric mean month-over-month growth across the trend window. */
  growthRate: number;
  perChannelGrowth: { shopify: number; amazon: number };
  /** baselineDemand × (1 + growthRate), rounded — projected M5 demand. */
  projectedDemand: number;
  /** retail price × projected monthly demand (brief's definition). */
  revenueOpportunity: number;
  /** Stock on hand ÷ baseline demand. Ignores incoming orders and growth. */
  simpleMonthsCover: number;
  /** Months until stockout, simulating demand growth and confirmed order arrivals. */
  runwayMonths: number;
  /** Runway ignoring the confirmed incoming order (what happens if the shipment slips). */
  runwayWithoutOrderMonths: number;
  isBioactive: boolean;
  isPhaseOut: boolean;
  flags: string[];
}

export interface Recommendation {
  sku: string;
  action: "REORDER_NOW" | "REORDER_SOON" | "MONITOR" | "NO_ACTION";
  priorityRank: number | null; // rank among reorder actions, 1 = highest
  revenueOpportunity: number;
  runwayMonths: number;
  targetMonthsCover: number;
  reasoning: string;
  tension: string | null;
}

export interface AnalysisFacts {
  generatedFor: string; // reporting month, e.g. "March 2026 (M4)"
  metrics: SkuMetrics[];
  recommendations: Recommendation[];
  totals: {
    m4RevenueUsd: number;
    m3RevenueUsd: number;
    // Pre-summed so the narrative never has to add figures itself — the first
    // v2 run summed the four REORDER_NOW exposures on its own (correctly, but
    // unverifiably).
    reorderNowExposureUsdPerMonth: number;
    bestSellersByM4Revenue: string[];
    fastestGrowers: string[];
    decliners: string[];
  };
}
