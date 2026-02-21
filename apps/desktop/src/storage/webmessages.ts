/**
 * Web Messages Storage Module
 *
 * Handles persistent storage of messages from custom web integrations.
 * Storage structure:
 *   ~/.wovly-assistant/users/{username}/web-integrations/messages/
 *     raw/{site-id}/{YYYY-MM-DD}.json - Raw scraped messages
 *     analyzed/{YYYY-MM-DD}.md - LLM-analyzed content (markdown)
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getUserDataDir } from '../utils/helpers';
import { getWebIntegrationsDir } from '../webscraper/config-manager';

/**
 * Web message structure
 */
export interface WebMessage {
  id: string;
  platform: string;
  from: string;
  subject?: string;
  body: string;
  timestamp: string;
  snippet?: string;
  source?: string;
  sourceUrl?: string;
  scrapedAt?: string;
  _cached?: boolean;
  _cacheAge?: number;
}

/**
 * Message file data structure
 */
export interface MessagesData {
  date: string;
  siteId: string;
  siteName?: string;
  lastUpdated: string;
  messages: WebMessage[];
  metadata: {
    totalMessages: number;
    successfulScrape: boolean;
    errorCount: number;
  };
}

/**
 * Save result structure
 */
export interface SaveResult {
  date: string;
  siteId: string;
  newMessages: number;
  totalMessages: number;
  filePath: string;
}

/**
 * Search filters structure
 */
export interface SearchFilters {
  site?: string;
  from?: string;
  daysBack?: number;
  limit?: number;
}

/**
 * Cleanup result structure
 */
export interface CleanupResult {
  deletedFiles: number;
  retentionDays: number;
  cutoffDate: string;
}

/**
 * Get the messages directory structure
 */
async function getMessagesDir(username: string): Promise<string> {
  const integrationsDir = await getWebIntegrationsDir(username);
  const messagesDir = path.join(integrationsDir, 'messages');
  await fs.mkdir(messagesDir, { recursive: true });
  return messagesDir;
}

async function getRawMessagesDir(username: string, siteId: string | null = null): Promise<string> {
  const messagesDir = await getMessagesDir(username);
  const rawDir = path.join(messagesDir, 'raw');
  await fs.mkdir(rawDir, { recursive: true });

  if (siteId) {
    const siteDir = path.join(rawDir, siteId);
    await fs.mkdir(siteDir, { recursive: true });
    return siteDir;
  }

  return rawDir;
}

async function getAnalyzedMessagesDir(username: string): Promise<string> {
  const messagesDir = await getMessagesDir(username);
  const analyzedDir = path.join(messagesDir, 'analyzed');
  await fs.mkdir(analyzedDir, { recursive: true });
  return analyzedDir;
}

/**
 * Generate deterministic message ID from message content
 * @param message - Message object
 * @returns Message ID (e.g., "msg_brightwheel_abc123def456")
 */
export function generateMessageId(message: WebMessage): string {
  const hashInput = `${message.source || message.platform}_${message.timestamp}_${message.from}_${message.body.substring(0, 50)}`;
  const hash = crypto.createHash('md5').update(hashInput).digest('hex');
  const source = (message.source || message.platform || 'web').replace(/^custom-/, '');
  return `msg_${source}_${hash.substring(0, 16)}`;
}

/**
 * Deduplicate messages by ID
 * @param existing - Existing messages
 * @param newMessages - New messages to merge
 * @returns Deduplicated messages
 */
export function deduplicateMessages(existing: WebMessage[], newMessages: WebMessage[]): WebMessage[] {
  const existingIds = new Set(existing.map(m => m.id));

  // Generate IDs if not present
  const withIds = newMessages.map(m => ({
    ...m,
    id: m.id || generateMessageId(m)
  }));

  // Only add truly new messages
  const unique = withIds.filter(m => !existingIds.has(m.id));

  return [...existing, ...unique];
}

/**
 * Save messages to daily JSON file (incremental append with deduplication)
 * @param username - Username
 * @param siteId - Site identifier
 * @param messages - Messages to save
 * @returns Save result with counts
 */
export async function saveMessages(
  username: string,
  siteId: string,
  messages: WebMessage[]
): Promise<SaveResult> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const siteDir = await getRawMessagesDir(username, siteId);
  const filePath = path.join(siteDir, `${today}.json`);

  // Load existing messages for today
  let existingData: MessagesData = {
    date: today,
    siteId,
    lastUpdated: new Date().toISOString(),
    messages: [],
    metadata: {
      totalMessages: 0,
      successfulScrape: true,
      errorCount: 0
    }
  };

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    existingData = JSON.parse(content) as MessagesData;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      console.error('[WebMessages] Error reading existing file:', error);
    }
    // File doesn't exist yet, will create new
  }

  // Ensure messages have IDs and timestamp
  const messagesWithIds = messages.map(m => ({
    ...m,
    id: m.id || generateMessageId(m),
    scrapedAt: m.scrapedAt || new Date().toISOString()
  }));

  // Deduplicate
  const deduplicated = deduplicateMessages(existingData.messages, messagesWithIds);
  const newCount = deduplicated.length - existingData.messages.length;

  // Update data
  existingData.messages = deduplicated;
  existingData.lastUpdated = new Date().toISOString();
  existingData.metadata.totalMessages = deduplicated.length;

  // Save
  await fs.writeFile(filePath, JSON.stringify(existingData, null, 2));

  console.log(`[WebMessages] Saved ${newCount} new messages for ${siteId} (total: ${deduplicated.length})`);

  return {
    date: today,
    siteId,
    newMessages: newCount,
    totalMessages: deduplicated.length,
    filePath
  };
}

/**
 * Load messages for a specific date
 * @param username - Username
 * @param date - Date in YYYY-MM-DD format
 * @param siteId - Site identifier (optional, if null returns all sites)
 * @returns Messages for that date
 */
export async function loadMessagesByDate(
  username: string,
  date: string,
  siteId: string | null = null
): Promise<WebMessage[]> {
  const allMessages: WebMessage[] = [];

  if (siteId) {
    // Load single site
    const siteDir = await getRawMessagesDir(username, siteId);
    const filePath = path.join(siteDir, `${date}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as MessagesData;
      return data.messages || [];
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.error(`[WebMessages] Error reading ${siteId} messages for ${date}:`, error);
      }
      return [];
    }
  } else {
    // Load all sites for this date
    const rawDir = await getRawMessagesDir(username);
    const sites = await fs.readdir(rawDir);

    for (const site of sites) {
      const filePath = path.join(rawDir, site, `${date}.json`);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as MessagesData;
        allMessages.push(...(data.messages || []));
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
          console.error(`[WebMessages] Error reading ${site} messages for ${date}:`, error);
        }
        // Skip missing files
      }
    }

    return allMessages;
  }
}

/**
 * Load messages since a timestamp
 * @param username - Username
 * @param siteId - Site identifier (optional)
 * @param sinceTimestamp - Timestamp to load from
 * @param maxDays - Maximum days to look back (default 30)
 * @returns Messages since timestamp
 */
export async function loadMessagesSince(
  username: string,
  siteId: string | null,
  sinceTimestamp: string | Date,
  maxDays: number = 30
): Promise<WebMessage[]> {
  const since = new Date(sinceTimestamp);
  const allMessages: WebMessage[] = [];
  const today = new Date();

  for (let i = 0; i < maxDays; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Stop if we've gone before the since date
    if (date < since) break;

    const dateStr = date.toISOString().split('T')[0];
    const messages = await loadMessagesByDate(username, dateStr, siteId);

    // Filter messages by timestamp
    const filtered = messages.filter(m => new Date(m.timestamp) >= since);
    allMessages.push(...filtered);
  }

  return allMessages;
}

/**
 * Search messages with filters
 * @param username - Username
 * @param query - Search query
 * @param filters - Search filters
 * @returns Matching messages
 */
export async function searchMessages(
  username: string,
  query: string,
  filters: SearchFilters = {}
): Promise<WebMessage[]> {
  const { site, from, daysBack = 30, limit = 20 } = filters;
  const allMessages: WebMessage[] = [];
  const today = new Date();

  // Determine which sites to search
  let sitesToSearch: string[] = [];
  if (site) {
    sitesToSearch = [site];
  } else {
    // Get all sites
    const rawDir = await getRawMessagesDir(username);
    sitesToSearch = await fs.readdir(rawDir);
  }

  // Search through days
  for (let i = 0; i < daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    for (const siteId of sitesToSearch) {
      const messages = await loadMessagesByDate(username, dateStr, siteId);

      // Apply filters
      const filtered = messages.filter(m => {
        // Text search
        if (query) {
          const searchIn = `${m.body} ${m.from} ${m.subject || ''}`.toLowerCase();
          if (!searchIn.includes(query.toLowerCase())) return false;
        }

        // From filter
        if (from && !m.from.toLowerCase().includes(from.toLowerCase())) return false;

        return true;
      });

      allMessages.push(...filtered);

      // Stop if we've hit the limit
      if (limit && allMessages.length >= limit) break;
    }

    if (limit && allMessages.length >= limit) break;
  }

  // Sort by timestamp (newest first) and apply limit
  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return limit ? allMessages.slice(0, limit) : allMessages;
}

/**
 * Get recent messages
 * @param username - Username
 * @param hours - Hours back to look (default 24)
 * @param siteId - Site identifier (optional)
 * @param limit - Max messages (default 50)
 * @returns Recent messages
 */
export async function getRecentMessages(
  username: string,
  hours: number = 24,
  siteId: string | null = null,
  limit: number = 50
): Promise<WebMessage[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const messages = await loadMessagesSince(username, siteId, since, 7); // Look back max 7 days

  // Sort by timestamp (newest first) and limit
  messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return limit ? messages.slice(0, limit) : messages;
}

/**
 * Append to analyzed markdown file
 * @param username - Username
 * @param date - Date in YYYY-MM-DD format
 * @param siteId - Site identifier
 * @param siteName - Site display name
 * @param messages - Messages to add to markdown
 */
export async function appendToAnalyzedMarkdown(
  username: string,
  date: string,
  siteId: string,
  siteName: string,
  messages: WebMessage[]
): Promise<void> {
  const analyzedDir = await getAnalyzedMessagesDir(username);
  const filePath = path.join(analyzedDir, `${date}.md`);

  // Check if file exists
  let existingContent = '';
  try {
    existingContent = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // Create new file with header
      existingContent = `# Web Messages - ${date}\n\n`;
    } else {
      throw error;
    }
  }

  // Check if this site already has content today (avoid duplicates)
  const siteMarker = `## ${siteName}`;
  const hasSiteContent = existingContent.includes(siteMarker);

  if (hasSiteContent) {
    // Update existing section
    const sectionRegex = new RegExp(`${siteMarker}[\\s\\S]*?(?=\\n## |$)`);
    const newSection = generateMarkdownSection(siteName, messages);
    existingContent = existingContent.replace(sectionRegex, newSection);
  } else {
    // Append new section
    const newSection = generateMarkdownSection(siteName, messages);
    existingContent += newSection + '\n';
  }

  await fs.writeFile(filePath, existingContent);
  console.log(`[WebMessages] Updated analyzed markdown for ${siteId} on ${date}`);
}

/**
 * Generate markdown section for a site's messages
 */
function generateMarkdownSection(siteName: string, messages: WebMessage[]): string {
  const now = new Date().toISOString();
  let section = `## ${siteName}\n`;
  section += `**Last checked:** ${now}\n\n`;

  if (messages.length === 0) {
    section += '*No new messages*\n';
    return section;
  }

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    section += `### ${msg.from} (${time})\n`;
    section += `${msg.body}\n\n`;
  }

  section += '---\n';
  return section;
}

/**
 * Cleanup old messages (retention policy)
 * @param username - Username
 * @param retentionDays - Days to keep (default 90)
 * @returns Cleanup stats
 */
export async function cleanupOldMessages(
  username: string,
  retentionDays: number = 90
): Promise<CleanupResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  let deletedFiles = 0;

  // Clean raw messages
  const rawDir = await getRawMessagesDir(username);
  const sites = await fs.readdir(rawDir);

  for (const siteId of sites) {
    const siteDir = path.join(rawDir, siteId);
    const files = await fs.readdir(siteDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const dateStr = file.replace('.json', '');
      if (dateStr < cutoffStr) {
        await fs.unlink(path.join(siteDir, file));
        deletedFiles++;
      }
    }
  }

  // Clean analyzed markdown
  const analyzedDir = await getAnalyzedMessagesDir(username);
  const analyzedFiles = await fs.readdir(analyzedDir);

  for (const file of analyzedFiles) {
    if (!file.endsWith('.md')) continue;

    const dateStr = file.replace('.md', '');
    if (dateStr < cutoffStr) {
      await fs.unlink(path.join(analyzedDir, file));
      deletedFiles++;
    }
  }

  console.log(
    `[WebMessages] Cleaned up ${deletedFiles} old message files (retention: ${retentionDays} days)`
  );

  return {
    deletedFiles,
    retentionDays,
    cutoffDate: cutoffStr
  };
}
