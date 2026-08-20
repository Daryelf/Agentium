// ─────────────────────────────────────────────────────────────────────────────
// Print Estimator Service
// Calculates print time, material cost, and suggested pricing
// ─────────────────────────────────────────────────────────────────────────────

const ELECTRICITY_COST_PER_HOUR_CENTS = 15; // ~$0.15/hr
const DEFAULT_MARKUP_MULTIPLIER = 4;

/**
 * Estimate a print job's cost and suggested price
 * @param {object} params
 * @param {number} params.filamentGrams
 * @param {number} params.printHours
 * @param {number} params.costPerGramCents - material cost per gram in cents
 * @param {number} [params.markupMultiplier=4]
 * @returns {object}
 */
function estimatePrintJob({ filamentGrams, printHours, costPerGramCents = 3, markupMultiplier = DEFAULT_MARKUP_MULTIPLIER }) {
  const materialCostCents = Math.round(filamentGrams * costPerGramCents);
  const electricityCostCents = Math.round(printHours * ELECTRICITY_COST_PER_HOUR_CENTS);
  const laborCostCents = Math.round(printHours * 50); // $0.50/hr passive labor
  const totalCostCents = materialCostCents + electricityCostCents + laborCostCents;
  const suggestedPriceCents = Math.round(totalCostCents * markupMultiplier);

  return {
    filamentGrams,
    printHours,
    breakdown: {
      materialCostCents,
      electricityCostCents,
      laborCostCents,
      totalCostCents
    },
    suggestedPriceCents,
    margin: `${Math.round((1 - 1 / markupMultiplier) * 100)}%`
  };
}

/**
 * Estimate print time from volume (rough approximation)
 * @param {number} volumeCm3 - volume in cm³
 * @param {string} quality - 'draft'|'normal'|'fine'
 * @returns {number} hours
 */
function estimatePrintTime(volumeCm3, quality = 'normal') {
  const speedMap = { draft: 60, normal: 40, fine: 20 }; // cm³/hr
  const speed = speedMap[quality] || 40;
  return Math.max(0.25, volumeCm3 / speed);
}

module.exports = { estimatePrintJob, estimatePrintTime };
