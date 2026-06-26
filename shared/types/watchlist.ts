/**
 * Types and interfaces for yield opportunity watchlist and threshold rules.
 * Supports watching protocols, pools, and strategies with custom threshold alerts.
 */

export type YieldOpportunityType = "protocol" | "pool" | "strategy";

export interface ThresholdRule {
  id: string;
  type: "apy_above" | "apy_below" | "tvl_above" | "tvl_below" | "spread_change_above";
  value: number; // APY %, TVL USD, or spread % change
  triggerOnce?: boolean; // Only trigger once when condition is met
}

export interface YieldOpportunityWatchItem {
  id: string;
  userId: string;
  opportunityId: string;
  opportunityType: YieldOpportunityType;
  opportunityName: string;
  
  // Current metrics snapshot
  currentApy: number;
  currentTvl: number;
  currentSpread?: number; // For pool pairs
  lastMetricUpdate: Date;
  
  // Threshold rules
  rules: ThresholdRule[];
  
  // Alert history
  triggeredAlerts: {
    ruleId: string;
    message: string;
    timestamp: Date;
    acknowledged: boolean;
  }[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  removedAt?: Date; // Soft delete support
}

export interface WatchlistItem {
  id: string;
  userId: string;
  opportunityId: string;
  opportunityType: YieldOpportunityType;
  opportunityName: string;
  currentApy: number;
  currentTvl: number;
  ruleCount: number;
  alertCount: number;
  lastAlertTime?: Date;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  total: number;
  totalUnacknowledgedAlerts: number;
}

export interface ThresholdCheckResult {
  itemId: string;
  ruleId: string;
  triggered: boolean;
  message: string;
  previousTriggered?: boolean;
}

/**
 * Helper to format threshold rule as human-readable text
 */
export function formatThresholdRule(rule: ThresholdRule): string {
  const valueStr = ["apy_above", "apy_below"].includes(rule.type)
    ? `${rule.value.toFixed(2)}%`
    : `$${rule.value.toLocaleString()}`;

  const typeLabels: Record<string, string> = {
    apy_above: "APY above",
    apy_below: "APY below",
    tvl_above: "TVL above",
    tvl_below: "TVL below",
    spread_change_above: "Spread change above",
  };

  return `${typeLabels[rule.type]} ${valueStr}`;
}

/**
 * Helper to check if a threshold rule is triggered
 */
export function checkThresholdTrigger(
  rule: ThresholdRule,
  apy: number,
  tvl: number,
  spreadChange: number = 0
): boolean {
  switch (rule.type) {
    case "apy_above":
      return apy > rule.value;
    case "apy_below":
      return apy < rule.value;
    case "tvl_above":
      return tvl > rule.value;
    case "tvl_below":
      return tvl < rule.value;
    case "spread_change_above":
      return Math.abs(spreadChange) > rule.value;
    default:
      return false;
  }
}

/**
 * Helper to generate alert message for triggered rule
 */
export function generateAlertMessage(
  opportunityName: string,
  rule: ThresholdRule,
  currentApy?: number,
  currentTvl?: number,
  currentSpread?: number
): string {
  switch (rule.type) {
    case "apy_above":
      return `${opportunityName}: APY increased to ${currentApy?.toFixed(2)}%, threshold is ${rule.value.toFixed(2)}%`;
    case "apy_below":
      return `${opportunityName}: APY dropped to ${currentApy?.toFixed(2)}%, below threshold of ${rule.value.toFixed(2)}%`;
    case "tvl_above":
      return `${opportunityName}: TVL increased to $${currentTvl?.toLocaleString()}, above threshold of $${rule.value.toLocaleString()}`;
    case "tvl_below":
      return `${opportunityName}: TVL decreased to $${currentTvl?.toLocaleString()}, below threshold of $${rule.value.toLocaleString()}`;
    case "spread_change_above":
      return `${opportunityName}: Spread changed by ${currentSpread?.toFixed(2)}%, exceeding ${rule.value.toFixed(2)}% threshold`;
    default:
      return `Alert triggered for ${opportunityName}`;
  }
}
