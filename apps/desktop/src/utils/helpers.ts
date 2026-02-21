/**
 * Common utility functions
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Date Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get date string in YYYY-MM-DD format for today
 */
export const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Get date string in YYYY-MM-DD format for yesterday
 */
export const getYesterdayDate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

/**
 * Check if a date string (YYYY-MM-DD) is older than N days
 */
export const isOlderThanDays = (dateStr: string, days: number): boolean => {
  const fileDate = new Date(dateStr + 'T00:00:00');
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return fileDate < cutoff;
};

/**
 * Check if a date string is within the last N days (but not today/yesterday)
 */
export const isWithinDaysRange = (
  dateStr: string,
  minDays: number,
  maxDays: number
): boolean => {
  const fileDate = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const minCutoff = new Date(now);
  minCutoff.setDate(minCutoff.getDate() - minDays);

  const maxCutoff = new Date(now);
  maxCutoff.setDate(maxCutoff.getDate() - maxDays);

  return fileDate < minCutoff && fileDate >= maxCutoff;
};

// ─────────────────────────────────────────────────────────────────────────────
// Text Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncate text to limit, keeping most recent content (from the end)
 */
export const truncateToLimit = (
  text: string,
  maxChars: number,
  label: string = 'content'
): string => {
  if (!text || text.length <= maxChars) return text;

  const truncated = text.slice(-maxChars);
  // Try to start at a line break for cleaner output
  const firstLineBreak = truncated.indexOf('\n');
  const cleanStart =
    firstLineBreak > 0 && firstLineBreak < 200
      ? truncated.slice(firstLineBreak + 1)
      : truncated;

  // Text truncated for memory limit
  return `[...earlier ${label} truncated...]\n\n${cleanStart}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Directory Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the base Wovly directory (~/.wovly-assistant)
 * Creates it if it doesn't exist
 * Can be overridden with WOVLY_DIR environment variable (for testing)
 */
export const getWovlyDir = async (): Promise<string> => {
  const dir = process.env.WOVLY_DIR || path.join(os.homedir(), '.wovly-assistant');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

/**
 * Get user-specific data directory
 * @throws Error if no username provided
 */
export const getUserDataDir = async (username: string): Promise<string> => {
  if (!username) throw new Error('No user logged in');
  const baseDir = await getWovlyDir();
  const userDir = path.join(baseDir, 'users', username);
  await fs.mkdir(userDir, { recursive: true });
  return userDir;
};

/**
 * Get path to user settings file
 */
export const getSettingsPath = async (username: string): Promise<string> => {
  const dir = await getUserDataDir(username);
  return path.join(dir, 'settings.json');
};
