/**
 * Insights Service
 * Handles insights retrieval and configuration
 */

import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';
import { loadTodayInsights, loadRecentInsights } from '../storage/insights';

/**
 * Service response interface
 */
export interface InsightsResponse {
  ok: boolean;
  insights?: any[];
  error?: string;
}

/**
 * InsightsService - Manages user insights
 */
export class InsightsService {
  /**
   * Set the insights limit preference
   * @param username - Current username
   * @param limit - Number of insights to show (default 5)
   * @returns Success/error response
   */
  static async setLimit(
    username: string | null | undefined,
    limit: number = 5
  ): Promise<InsightsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Save the limit preference immediately
      const settingsPath = await getSettingsPath(username);
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      settings.insightsLimit = limit;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      console.log(`[Insights] Saved limit preference: ${limit}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Insights] Error saving limit preference:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get today's insights with limit (or most recent if today is empty)
   * @param username - Current username
   * @param limit - Number of insights to return (default 5)
   * @returns Array of insights
   */
  static async getToday(
    username: string | null | undefined,
    limit: number = 5
  ): Promise<InsightsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in', insights: [] };
      }

      // First try to load today's insights
      const todayInsights = await loadTodayInsights(username);

      // If today has insights, use those
      if (todayInsights.length > 0) {
        const insights = todayInsights.slice(0, limit);
        return { ok: true, insights };
      }

      // Otherwise, fall back to most recent insights from the last 7 days
      const recentInsights = await loadRecentInsights(username, 7);
      const insights = recentInsights.slice(0, limit);

      return { ok: true, insights };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Insights] Error loading insights:', error);
      return { ok: false, error, insights: [] };
    }
  }

  /**
   * Refresh insights and set limit preference
   * @param username - Current username
   * @param limit - Number of insights to generate (default 5)
   * @param runInsightsCheck - Function to trigger insights generation
   * @returns Updated insights
   */
  static async refresh(
    username: string | null | undefined,
    limit: number = 5,
    runInsightsCheck: (limit: number) => Promise<void>
  ): Promise<InsightsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in', insights: [] };
      }

      // Save the limit preference for future scheduled checks
      try {
        const settingsPath = await getSettingsPath(username);
        const settingsData = await fs.readFile(settingsPath, 'utf8');
        const settings = JSON.parse(settingsData);
        settings.insightsLimit = limit;
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.log('[Insights] Could not save limit preference:', error);
      }

      // Trigger insights generation
      await runInsightsCheck(limit);

      // Load and return updated insights
      const allInsights = await loadTodayInsights(username);
      const insights = allInsights.slice(0, limit);

      return { ok: true, insights };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Insights] Error refreshing insights:', error);
      return { ok: false, error, insights: [] };
    }
  }
}
