/**
 * Custom Web Integration Tools
 *
 * Tool executor for architect-builder to query messages from custom web integrations.
 * Following the pattern of Gmail/Slack/iMessage tools.
 */

import * as webMessages from '../storage/webmessages';
import { config as configManager } from '../webscraper';
import type { WebMessage } from '../storage/webmessages';

/**
 * search_custom_web_messages input
 */
export interface SearchCustomWebMessagesInput {
  query: string;
  site?: string;
  from?: string;
  days_back?: number;
  limit?: number;
}

/**
 * get_recent_custom_web_messages input
 */
export interface GetRecentCustomWebMessagesInput {
  site?: string;
  hours?: number;
  limit?: number;
}

/**
 * get_custom_web_messages_by_date input
 */
export interface GetCustomWebMessagesByDateInput {
  date: string;
  end_date?: string;
  site?: string;
}

/**
 * list_custom_web_sites input (no parameters)
 */
export interface ListCustomWebSitesInput {
  // No parameters
}

/**
 * Formatted message output
 */
export interface FormattedMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  snippet: string;
  timestamp: string;
  platform: string;
  source?: string;
  url?: string;
  cached: boolean;
  cacheAge?: string;
}

/**
 * Search result
 */
export interface SearchResult {
  messages: FormattedMessage[];
  count: number;
  note?: string;
  error?: string;
}

/**
 * Recent messages result
 */
export interface RecentMessagesResult {
  messages: FormattedMessage[];
  count: number;
  timeframe: string;
  error?: string;
}

/**
 * Messages by date result
 */
export interface MessagesByDateResult {
  messages: FormattedMessage[];
  count: number;
  date: string;
  error?: string;
}

/**
 * Site info
 */
export interface SiteInfo {
  id: string;
  name: string;
  url?: string;
  enabled: boolean;
  status: string;
  lastSuccess?: string;
  lastError?: string;
  consecutiveFailures?: number;
  error?: string;
}

/**
 * List sites result
 */
export interface ListSitesResult {
  sites: SiteInfo[];
  summary: {
    total: number;
    enabled: number;
    paused: number;
    errors: number;
  };
}

/**
 * Tool input union type
 */
export type CustomWebToolInput =
  | SearchCustomWebMessagesInput
  | GetRecentCustomWebMessagesInput
  | GetCustomWebMessagesByDateInput
  | ListCustomWebSitesInput;

/**
 * Tool result union type
 */
export type CustomWebToolResult =
  | SearchResult
  | RecentMessagesResult
  | MessagesByDateResult
  | ListSitesResult;

/**
 * Execute a custom web tool
 */
export async function executeCustomWebTool(
  toolName: string,
  toolInput: CustomWebToolInput,
  username: string
): Promise<CustomWebToolResult> {
  try {
    switch (toolName) {
      case 'search_custom_web_messages':
        return await searchCustomWebMessages(toolInput as SearchCustomWebMessagesInput, username);

      case 'get_recent_custom_web_messages':
        return await getRecentCustomWebMessages(toolInput as GetRecentCustomWebMessagesInput, username);

      case 'get_custom_web_messages_by_date':
        return await getCustomWebMessagesByDate(toolInput as GetCustomWebMessagesByDateInput, username);

      case 'list_custom_web_sites':
        return await listCustomWebSites(toolInput as ListCustomWebSitesInput, username);

      default:
        throw new Error(`Unknown custom web tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[CustomWebTools] Error executing ${toolName}:`, error);
    return {
      error: (error as Error).message,
      messages: [],
      count: 0
    };
  }
}

/**
 * Search messages from custom web integrations
 */
export async function searchCustomWebMessages(
  input: SearchCustomWebMessagesInput,
  username: string
): Promise<SearchResult> {
  const { query, site, from, days_back = 30, limit = 20 } = input;

  if (!query) {
    return {
      error: 'Query parameter is required',
      messages: [],
      count: 0
    };
  }

  const results = await webMessages.searchMessages(username, query, {
    site,
    from,
    daysBack: days_back,
    limit
  });

  // Check if any results are from cache
  const hasCachedResults = results.some((m: WebMessage) => m._cached);
  const oldestCache = results
    .filter((m: WebMessage) => m._cached)
    .reduce((oldest: number, m: WebMessage) => Math.max(oldest, m._cacheAge || 0), 0);

  return {
    messages: results.map(formatMessage),
    count: results.length,
    note: hasCachedResults && oldestCache > 86400000 // 24 hours
      ? `Some results from cached data (site may be unavailable)`
      : undefined
  };
}

/**
 * Get recent messages from custom web integrations
 */
export async function getRecentCustomWebMessages(
  input: GetRecentCustomWebMessagesInput,
  username: string
): Promise<RecentMessagesResult> {
  const { site, hours = 24, limit = 50 } = input;

  const results = await webMessages.getRecentMessages(username, hours, site, limit);

  return {
    messages: results.map(formatMessage),
    count: results.length,
    timeframe: `${hours} hours`
  };
}

/**
 * Get messages by date or date range
 */
export async function getCustomWebMessagesByDate(
  input: GetCustomWebMessagesByDateInput,
  username: string
): Promise<MessagesByDateResult> {
  const { date, end_date, site } = input;

  if (!date) {
    return {
      error: 'Date parameter is required (YYYY-MM-DD format)',
      messages: [],
      count: 0,
      date: ''
    };
  }

  let allMessages: WebMessage[] = [];

  if (end_date) {
    // Date range
    const startDate = new Date(date);
    const endDate = new Date(end_date);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    for (let i = 0; i <= daysDiff; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];

      const messages = await webMessages.loadMessagesByDate(username, dateStr, site);
      allMessages.push(...messages);
    }
  } else {
    // Single date
    allMessages = await webMessages.loadMessagesByDate(username, date, site);
  }

  return {
    messages: allMessages.map(formatMessage),
    count: allMessages.length,
    date: end_date ? `${date} to ${end_date}` : date
  };
}

/**
 * List all configured custom web sites
 */
export async function listCustomWebSites(
  input: ListCustomWebSitesInput,
  username: string
): Promise<ListSitesResult> {
  const sites = await configManager.listIntegrations(username);

  // Load full config for each site to get status
  const detailedSites = await Promise.all(
    sites.map(async (site): Promise<SiteInfo> => {
      try {
        const fullConfig = await configManager.getIntegration(username, site.id);
        if (!fullConfig) {
          return {
            id: site.id,
            name: site.name,
            enabled: site.enabled,
            status: 'unknown',
            error: 'Configuration not found'
          };
        }
        return {
          id: fullConfig.id,
          name: fullConfig.name,
          url: fullConfig.url,
          enabled: fullConfig.enabled,
          status: fullConfig.status?.paused ? 'paused' :
                  fullConfig.status?.lastError ? 'error' :
                  fullConfig.status?.lastSuccess ? 'active' : 'not checked',
          lastSuccess: fullConfig.status?.lastSuccess || undefined,
          lastError: fullConfig.status?.lastError || undefined,
          consecutiveFailures: fullConfig.status?.consecutiveFailures || 0
        };
      } catch (err) {
        return {
          id: site.id,
          name: site.name,
          enabled: site.enabled,
          status: 'unknown',
          error: (err as Error).message
        };
      }
    })
  );

  const summary = {
    total: detailedSites.length,
    enabled: detailedSites.filter((s: SiteInfo) => s.enabled && s.status !== 'paused').length,
    paused: detailedSites.filter((s: SiteInfo) => s.status === 'paused').length,
    errors: detailedSites.filter((s: SiteInfo) => s.status === 'error').length
  };

  return {
    sites: detailedSites,
    summary
  };
}

/**
 * Format message for output
 */
function formatMessage(message: WebMessage): FormattedMessage {
  return {
    id: message.id,
    from: message.from,
    subject: message.subject || '',
    body: message.body,
    snippet: message.snippet || message.body.substring(0, 200),
    timestamp: message.timestamp,
    platform: message.platform,
    source: message.source,
    url: message.sourceUrl,
    cached: message._cached || false,
    cacheAge: message._cacheAge ? formatCacheAge(message._cacheAge) : undefined
  };
}

/**
 * Format cache age in human-readable form
 */
function formatCacheAge(ageMs: number): string {
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    return 'less than 1 hour ago';
  }
}
