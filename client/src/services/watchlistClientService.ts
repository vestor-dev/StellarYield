/**
 * Client-side service for managing yield opportunity watchlist.
 * Handles API communication for CRUD operations and threshold checks.
 */

import { apiUrl, apiFetch } from "../lib/api";
import type {
  YieldOpportunityWatchItem,
  WatchlistItem,
  WatchlistResponse,
  ThresholdRule,
  ThresholdCheckResult,
} from "../../../shared/types/watchlist";

export class WatchlistClientService {
  private static readonly baseUrl = "/api/watchlist";

  /**
   * Get user's watchlist with summary
   */
  static async getWatchlist(): Promise<WatchlistResponse> {
    const response = await apiFetch(apiUrl(this.baseUrl));

    if (!response.ok) {
      throw new Error(`Failed to fetch watchlist: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all unacknowledged alerts
   */
  static async getAlerts(): Promise<{
    alerts: Array<{
      itemId: string;
      opportunityName: string;
      alerts: Array<{
        ruleId: string;
        message: string;
        timestamp: string;
      }>;
    }>;
    total: number;
  }> {
    const response = await apiFetch(apiUrl(`${this.baseUrl}/alerts`));

    if (!response.ok) {
      throw new Error(`Failed to fetch alerts: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Add an opportunity to watchlist
   */
  static async addToWatchlist(
    opportunityId: string,
    opportunityType: "protocol" | "pool" | "strategy",
    opportunityName: string,
    currentApy: number,
    currentTvl: number
  ): Promise<YieldOpportunityWatchItem> {
    const response = await apiFetch(apiUrl(this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunityId,
        opportunityType,
        opportunityName,
        currentApy,
        currentTvl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add to watchlist: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Remove an opportunity from watchlist
   */
  static async removeFromWatchlist(itemId: string): Promise<void> {
    const response = await apiFetch(apiUrl(`${this.baseUrl}/${itemId}`), {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to remove from watchlist: ${response.statusText}`);
    }
  }

  /**
   * Add a threshold rule to a watchlist item
   */
  static async addThresholdRule(
    itemId: string,
    type:
      | "apy_above"
      | "apy_below"
      | "tvl_above"
      | "tvl_below"
      | "spread_change_above",
    value: number,
    triggerOnce?: boolean
  ): Promise<ThresholdRule> {
    const response = await apiFetch(apiUrl(`${this.baseUrl}/${itemId}/rules`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, value, triggerOnce }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add threshold rule: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Remove a threshold rule
   */
  static async removeThresholdRule(itemId: string, ruleId: string): Promise<void> {
    const response = await apiFetch(
      apiUrl(`${this.baseUrl}/${itemId}/rules/${ruleId}`),
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to remove threshold rule: ${response.statusText}`);
    }
  }

  /**
   * Check thresholds for a specific item
   */
  static async checkThresholds(
    itemId: string,
    currentApy: number,
    currentTvl: number,
    spreadChange?: number
  ): Promise<{ checks: ThresholdCheckResult[]; triggeredCount: number }> {
    const response = await apiFetch(apiUrl(`${this.baseUrl}/${itemId}/check`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentApy,
        currentTvl,
        spreadChange,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to check thresholds: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Acknowledge an alert
   */
  static async acknowledgeAlert(itemId: string, ruleId: string): Promise<void> {
    const response = await apiFetch(
      apiUrl(`${this.baseUrl}/${itemId}/alerts/${ruleId}/acknowledge`),
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to acknowledge alert: ${response.statusText}`);
    }
  }

  /**
   * Batch check thresholds for multiple items
   */
  static async batchCheckThresholds(
    items: Array<{
      itemId: string;
      currentApy: number;
      currentTvl: number;
      spreadChange?: number;
    }>
  ): Promise<{ checked: number; triggeredCount: number; results: ThresholdCheckResult[] }> {
    const response = await apiFetch(apiUrl(`${this.baseUrl}/batch/check`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      throw new Error(`Failed to batch check thresholds: ${response.statusText}`);
    }

    return response.json();
  }
}
