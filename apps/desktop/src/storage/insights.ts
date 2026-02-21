/**
 * Insights Storage Module
 * Handles storage and retrieval of daily insights and last check timestamps
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getUserDataDir } from '../utils/helpers';

/**
 * Individual insight object
 */
export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: number;
  relatedMessages?: Array<{
    platform: string;
    from: string;
    snippet: string;
    timestamp: string;
  }>;
  suggestedAction?: string;
  relatedGoal?: string;
  timestamp: string;
}

/**
 * Insights file structure
 */
export interface InsightsData {
  date: string;
  timestamp: string;
  insights: Insight[];
}

/**
 * Memory entry from daily markdown files
 */
export interface MemoryEntry {
  date: string;
  content: string;
}

/**
 * Last check data structure
 */
export interface LastCheckData {
  lastCheckTimestamp: string | null;
  goalsHash: string;
}

/**
 * Last check file structure
 */
interface LastCheckFile {
  lastCheckTimestamp: string;
  lastCheckDate: string;
  goalsHash: string;
}

/**
 * Get the insights directory for a user
 */
export const getInsightsDir = async (username: string): Promise<string> => {
  const userDir = await getUserDataDir(username);
  const insightsDir = path.join(userDir, 'insights');
  await fs.mkdir(insightsDir, { recursive: true });
  return insightsDir;
};

/**
 * Get the path to today's insights file
 */
export const getTodayInsightsPath = async (username: string): Promise<string> => {
  const insightsDir = await getInsightsDir(username);
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(insightsDir, `${today}.json`);
};

/**
 * Get the path to the last check file
 */
export const getLastCheckPath = async (username: string): Promise<string> => {
  const insightsDir = await getInsightsDir(username);
  return path.join(insightsDir, 'last-check.json');
};

/**
 * Save insights for today
 * @param username - The username
 * @param insights - Array of insight objects
 */
export const saveInsights = async (username: string, insights: Insight[]): Promise<void> => {
  const insightsPath = await getTodayInsightsPath(username);
  const data: InsightsData = {
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    insights: insights || []
  };

  await fs.writeFile(insightsPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Insights] Saved ${insights.length} insights to ${insightsPath}`);
};

/**
 * Load today's insights
 * @param username - The username
 * @returns Array of insights
 */
export const loadTodayInsights = async (username: string): Promise<Insight[]> => {
  try {
    const insightsPath = await getTodayInsightsPath(username);
    const content = await fs.readFile(insightsPath, 'utf8');
    const data = JSON.parse(content) as InsightsData;
    return data.insights || [];
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // File doesn't exist yet
      return [];
    }
    console.error("[Insights] Error loading today's insights:", err);
    throw err;
  }
};

/**
 * Load recent memory history for cross-checking
 * @param username - The username
 * @param daysBack - Number of days to look back (default 7)
 * @returns Array of memory entries
 */
export const loadRecentHistory = async (username: string, daysBack: number = 7): Promise<MemoryEntry[]> => {
  const userDir = await getUserDataDir(username);
  const memoryDir = path.join(userDir, 'memory', 'daily');

  const memories: MemoryEntry[] = [];
  const today = new Date();

  for (let i = 0; i < daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const memoryPath = path.join(memoryDir, `${dateStr}.md`);

    try {
      const content = await fs.readFile(memoryPath, 'utf8');
      memories.push({
        date: dateStr,
        content: content
      });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error(`[Insights] Error reading memory for ${dateStr}:`, err);
      }
      // Skip missing files
    }
  }

  return memories;
};

/**
 * Calculate a hash of user goals for change detection
 * @param goals - Array of goal strings
 * @returns Hash of goals
 */
export const calculateGoalsHash = (goals: string[]): string => {
  if (!goals || goals.length === 0) return '';
  const goalsString = JSON.stringify(goals.sort()); // Sort for consistency
  return crypto.createHash('md5').update(goalsString).digest('hex');
};

/**
 * Get the last check data including timestamp and goals hash
 * @param username - The username
 * @returns Object with lastCheckTimestamp and goalsHash
 */
export const getLastCheckData = async (username: string): Promise<LastCheckData> => {
  try {
    const lastCheckPath = await getLastCheckPath(username);
    const content = await fs.readFile(lastCheckPath, 'utf8');
    const data = JSON.parse(content) as LastCheckFile;
    return {
      lastCheckTimestamp: data.lastCheckTimestamp || null,
      goalsHash: data.goalsHash || ''
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // File doesn't exist - first run
      return { lastCheckTimestamp: null, goalsHash: '' };
    }
    console.error('[Insights] Error reading last check data:', err);
    throw err;
  }
};

/**
 * Get the timestamp of the last successful insights check
 * @param username - The username
 * @returns ISO timestamp or null if never run
 */
export const getLastCheckTimestamp = async (username: string): Promise<string | null> => {
  const data = await getLastCheckData(username);
  return data.lastCheckTimestamp;
};

/**
 * Save the timestamp and goals hash of a successful insights check
 * @param username - The username
 * @param timestamp - ISO timestamp
 * @param goals - Current user goals
 */
export const saveLastCheckTimestamp = async (
  username: string,
  timestamp: string,
  goals: string[] = []
): Promise<void> => {
  const lastCheckPath = await getLastCheckPath(username);
  const goalsHash = calculateGoalsHash(goals);
  const data: LastCheckFile = {
    lastCheckTimestamp: timestamp,
    lastCheckDate: new Date(timestamp).toISOString().split('T')[0],
    goalsHash: goalsHash
  };

  await fs.writeFile(lastCheckPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Insights] Saved last check timestamp: ${timestamp}, goals hash: ${goalsHash}`);
};
