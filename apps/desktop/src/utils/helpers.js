/**
 * Common utility functions
 */

const path = require("path");
const fs = require("fs/promises");
const os = require("os");

// ─────────────────────────────────────────────────────────────────────────────
// Date Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Get date string in YYYY-MM-DD format
const getTodayDate = () => new Date().toISOString().split('T')[0];

const getYesterdayDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

// Check if a date string (YYYY-MM-DD) is older than N days
const isOlderThanDays = (dateStr, days) => {
  const fileDate = new Date(dateStr + 'T00:00:00');
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return fileDate < cutoff;
};

// Check if a date string is within the last N days (but not today/yesterday)
const isWithinDaysRange = (dateStr, minDays, maxDays) => {
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

// Truncate text to limit, keeping most recent content (from the end)
const truncateToLimit = (text, maxChars, label = "content") => {
  if (!text || text.length <= maxChars) return text;
  
  const truncated = text.slice(-maxChars);
  // Try to start at a line break for cleaner output
  const firstLineBreak = truncated.indexOf('\n');
  const cleanStart = firstLineBreak > 0 && firstLineBreak < 200 
    ? truncated.slice(firstLineBreak + 1) 
    : truncated;
  
  console.log(`[Memory] Truncated ${label} from ${text.length} to ${cleanStart.length} chars`);
  return `[...earlier ${label} truncated...]\n\n${cleanStart}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Directory Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getWovlyDir = async () => {
  const dir = path.join(os.homedir(), ".wovly-assistant");
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

// Get user-specific data directory
const getUserDataDir = async (username) => {
  if (!username) throw new Error("No user logged in");
  const baseDir = await getWovlyDir();
  const userDir = path.join(baseDir, "users", username);
  await fs.mkdir(userDir, { recursive: true });
  return userDir;
};

const getSettingsPath = async (username) => {
  const dir = await getUserDataDir(username);
  return path.join(dir, "settings.json");
};

module.exports = {
  // Date helpers
  getTodayDate,
  getYesterdayDate,
  isOlderThanDays,
  isWithinDaysRange,
  // Text helpers
  truncateToLimit,
  // Directory helpers
  getWovlyDir,
  getUserDataDir,
  getSettingsPath
};
