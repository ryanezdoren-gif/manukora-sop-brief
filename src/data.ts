import { readFileSync } from "node:fs";
import type { SkuRow } from "./types.js";

const EXPECTED_HEADER =
  "SKU,Shopify_M1,Shopify_M2,Shopify_M3,Shopify_M4,Amazon_M1,Amazon_M2,Amazon_M3,Amazon_M4,Stock_On_Hand,Units_On_Order,Order_Arrival_Months,Target_Months_Cover,Retail_Price_USD";

export function loadSkuRows(csvPath: string): SkuRow[] {
  const raw = readFileSync(csvPath, "utf8").trim();
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== EXPECTED_HEADER) {
    throw new Error(`Unexpected CSV header — refusing to guess column order.\nGot: ${lines[0]}`);
  }
  return lines.slice(1).map((line, i) => {
    const cols = line.split(",");
    if (cols.length !== 14) throw new Error(`Row ${i + 2}: expected 14 columns, got ${cols.length}`);
    const nums = cols.slice(1).map((c) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Row ${i + 2}: bad number "${c}"`);
      return n;
    });
    return {
      sku: cols[0],
      shopify: [nums[0], nums[1], nums[2], nums[3]],
      amazon: [nums[4], nums[5], nums[6], nums[7]],
      stockOnHand: nums[8],
      unitsOnOrder: nums[9],
      orderArrivalMonths: nums[10],
      targetMonthsCover: nums[11],
      retailPriceUsd: nums[12],
    } satisfies SkuRow;
  });
}
