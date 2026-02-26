/**
 * Memory Integration
 *
 * Provides tools for accessing and searching historical conversations:
 * - Search conversations by keyword
 * - Get conversations for specific dates
 * - Search within date ranges
 * - List available conversation dates
 * - Get conversation summaries
 */

import { Integration, Tool, IntegrationContext } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getMemoryDailyDir, getMemoryLongtermDir } from '../../storage/memory';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const memoryTools: Tool[] = [
  {
    name: 'search_memory',
    description:
      "Search through historical conversations by keyword. Use when user asks about past conversations with specific topics. Examples: 'did we ever discuss Italy?', 'what did I say about the project?'",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms to look for in past conversations' },
        date_range: {
          type: 'string',
          description: "How far back to search. Default is 'all' for comprehensive search.",
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_conversations_for_date',
    description:
      "Get all conversations from a specific date. Use when user asks about what was discussed on a particular day. Examples: 'what did we talk about yesterday?', 'what did we discuss on Monday?', 'show me our conversation from January 15th'",
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            "The date to retrieve. Can be: 'today', 'yesterday', a relative day like 'last Monday', or a specific date like '2024-01-15' or 'January 15, 2024'",
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'search_memory_between_dates',
    description:
      "Search conversations within a specific date range. Use when user asks about discussions during a time period. Examples: 'what did we discuss last week?', 'find mentions of the project between Christmas and New Year'",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search terms. If empty, returns all conversations in range.',
        },
        start_date: {
          type: 'string',
          description:
            "Start date (inclusive). Format: 'YYYY-MM-DD' or relative like 'last Monday', '2 weeks ago'",
        },
        end_date: {
          type: 'string',
          description:
            "End date (inclusive). Format: 'YYYY-MM-DD' or relative like 'yesterday', 'today'",
        },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'list_memory_dates',
    description:
      "List all dates that have conversation records. Use to see conversation history availability or find when conversations started. Examples: 'when did we first chat?', 'how many days have we talked?', 'list all our conversation dates'",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of dates to return. Default 30.' },
      },
      required: [],
    },
  },
  {
    name: 'get_conversation_summary',
    description:
      "Get the AI-generated summary for a specific date's conversations. Faster than retrieving full conversations when user just wants highlights. Examples: 'give me a summary of yesterday's chat', 'what were the key points from last Monday?'",
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            "The date to get summary for. Format: 'YYYY-MM-DD' or relative like 'yesterday', 'last Monday'",
        },
      },
      required: ['date'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function parseDateString(dateStr: string): string | null {
  const now = new Date();
  const lower = dateStr.toLowerCase().trim();

  if (lower === 'today') return now.toISOString().split('T')[0];
  if (lower === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  const daysAgoMatch = lower.match(/^(\d+)\s*days?\s*ago$/);
  if (daysAgoMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(daysAgoMatch[1]));
    return d.toISOString().split('T')[0];
  }

  const weeksAgoMatch = lower.match(/^(\d+)\s*weeks?\s*ago$/);
  if (weeksAgoMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(weeksAgoMatch[1]) * 7);
    return d.toISOString().split('T')[0];
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const lastDayMatch = lower.match(
    /^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/
  );
  if (lastDayMatch) {
    const targetDay = dayNames.indexOf(lastDayMatch[1]);
    const d = new Date(now);
    let daysBack = d.getDay() - targetDay;
    if (daysBack <= 0) daysBack += 7;
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split('T')[0];
  }

  const thisDayMatch = lower.match(
    /^this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/
  );
  if (thisDayMatch) {
    const targetDay = dayNames.indexOf(thisDayMatch[1]);
    const d = new Date(now);
    d.setDate(d.getDate() + (targetDay - d.getDay()));
    return d.toISOString().split('T')[0];
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  return null;
}

function getDateCutoff(dateRange: string): Date | null {
  const now = new Date();
  if (dateRange === 'last_week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (dateRange === 'last_month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  if (dateRange === 'last_3_months') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }
  return null;
}

async function searchFileForQuery(
  filePath: string,
  dateStr: string,
  queryLower: string,
  maxMatches: number = 5
): Promise<any | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (content.toLowerCase().includes(queryLower)) {
      const lines = content.split('\n');
      const matchingLines = lines
        .filter((line) => line.toLowerCase().includes(queryLower))
        .slice(0, maxMatches);
      if (matchingLines.length > 0) {
        return { date: dateStr, matches: matchingLines };
      }
    }
  } catch {
    // Skip unreadable files
  }
  return null;
}

async function searchDirectories(
  dirs: string[],
  queryLower: string,
  cutoffDate: Date | null
): Promise<any[]> {
  const results: any[] = [];

  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');

        if (cutoffDate) {
          const fileDate = new Date(dateStr + 'T00:00:00');
          if (fileDate < cutoffDate) continue;
        }

        const result = await searchFileForQuery(path.join(dir, file), dateStr, queryLower);
        if (result) results.push(result);
      }
    } catch {
      // Directory not found
    }
  }

  return results;
}

async function readMemoryFile(
  username: string,
  dateStr: string
): Promise<{ content: string; source: string } | null> {
  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);

  const paths = [
    { dir: dailyDir, source: 'daily' },
    { dir: longtermDir, source: 'longterm' },
  ];

  for (const { dir, source } of paths) {
    try {
      const content = await fs.readFile(path.join(dir, `${dateStr}.md`), 'utf8');
      return { content, source };
    } catch {
      // Try next location
    }
  }

  return null;
}

async function getAllMemoryDates(username: string): Promise<string[]> {
  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);
  const allDates = new Set<string>();

  for (const dir of [dailyDir, longtermDir]) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          allDates.add(file.replace('.md', ''));
        }
      }
    } catch {
      // Directory not found
    }
  }

  return Array.from(allDates).sort().reverse();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution Functions
// ─────────────────────────────────────────────────────────────────────────────

async function executeMemorySearch(
  query: string,
  dateRange: string = 'all',
  username: string
): Promise<any> {
  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);
  const cutoffDate = getDateCutoff(dateRange);
  const queryLower = query.toLowerCase();

  const results = await searchDirectories([dailyDir, longtermDir], queryLower, cutoffDate);
  results.sort((a, b) => b.date.localeCompare(a.date));

  if (results.length === 0) {
    return {
      found: false,
      message: `No conversations found matching "${query}" in the specified time range.`,
    };
  }

  return {
    found: true,
    totalMatches: results.length,
    results: results.slice(0, 10),
  };
}

async function executeGetConversationsForDate(dateInput: string, username: string): Promise<any> {
  const dateStr = parseDateString(dateInput);
  if (!dateStr) {
    return {
      error: `Could not parse date: "${dateInput}". Try formats like "yesterday", "last Monday", "2024-01-15", or "January 15, 2024"`,
    };
  }

  const fileData = await readMemoryFile(username, dateStr);
  if (!fileData) {
    return { found: false, date: dateStr, message: `No conversations found for ${dateStr}.` };
  }

  const entries = fileData.content.split(/\n---\n/).filter((e) => e.trim());
  const conversations: any[] = [];

  for (const entry of entries) {
    if (entry.startsWith('## Summary')) continue;

    const timestampMatch = entry.match(/\*\*\[([^\]]+)\]\*\*/);
    const userMatch = entry.match(/\*\*User:\*\*\s*([\s\S]*?)(?=\*\*Assistant:\*\*|$)/);
    const assistantMatch = entry.match(/\*\*Assistant:\*\*\s*([\s\S]*?)$/);

    if (userMatch || assistantMatch) {
      conversations.push({
        timestamp: timestampMatch?.[1] || null,
        user: userMatch?.[1]?.trim() || null,
        assistant: assistantMatch?.[1]?.trim() || null,
      });
    }
  }

  return {
    found: true,
    date: dateStr,
    source: fileData.source,
    conversationCount: conversations.length,
    conversations: conversations.slice(0, 20),
  };
}

async function executeSearchMemoryBetweenDates(
  query: string,
  startDateInput: string,
  endDateInput: string,
  username: string
): Promise<any> {
  const startDate = parseDateString(startDateInput);
  const endDate = parseDateString(endDateInput);

  if (!startDate) return { error: `Could not parse start date: "${startDateInput}"` };
  if (!endDate) return { error: `Could not parse end date: "${endDateInput}"` };

  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);
  const results: any[] = [];
  const queryLower = query ? query.toLowerCase() : null;

  const searchFile = async (filePath: string, dateStr: string): Promise<void> => {
    try {
      const content = await fs.readFile(filePath, 'utf8');

      if (!queryLower) {
        const preview = content.slice(0, 200).replace(/\n/g, ' ').trim();
        results.push({ date: dateStr, preview: preview + (content.length > 200 ? '...' : '') });
        return;
      }

      if (content.toLowerCase().includes(queryLower)) {
        const lines = content.split('\n');
        const matchingLines = lines
          .filter((line) => line.toLowerCase().includes(queryLower))
          .slice(0, 3);
        if (matchingLines.length > 0) {
          results.push({ date: dateStr, matches: matchingLines });
        }
      }
    } catch {
      // Skip unreadable files
    }
  };

  for (const dir of [dailyDir, longtermDir]) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');
        if (dateStr >= startDate && dateStr <= endDate) {
          await searchFile(path.join(dir, file), dateStr);
        }
      }
    } catch {
      // Directory not found
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date));

  if (results.length === 0) {
    const msg = queryLower
      ? `No conversations matching "${query}" found between ${startDate} and ${endDate}.`
      : `No conversations found between ${startDate} and ${endDate}.`;
    return { found: false, message: msg };
  }

  return {
    found: true,
    dateRange: { start: startDate, end: endDate },
    query: query || null,
    totalDays: results.length,
    results: results.slice(0, 15),
  };
}

async function executeListMemoryDates(limit: number = 30, username: string): Promise<any> {
  const sortedDates = await getAllMemoryDates(username);

  if (sortedDates.length === 0) {
    return { found: false, message: 'No conversation history found.' };
  }

  return {
    found: true,
    totalDays: sortedDates.length,
    oldestDate: sortedDates[sortedDates.length - 1],
    newestDate: sortedDates[0],
    dates: sortedDates.slice(0, limit),
  };
}

async function executeGetConversationSummary(dateInput: string, username: string): Promise<any> {
  const dateStr = parseDateString(dateInput);
  if (!dateStr) {
    return { error: `Could not parse date: "${dateInput}"` };
  }

  const fileData = await readMemoryFile(username, dateStr);
  if (!fileData) {
    return { found: false, date: dateStr, message: `No conversations found for ${dateStr}.` };
  }

  const summaryMatch = fileData.content.match(/## Summary\n([\s\S]*?)\n---/);

  if (summaryMatch) {
    return {
      found: true,
      date: dateStr,
      hasSummary: true,
      summary: summaryMatch[1].trim(),
    };
  }

  const preview = fileData.content.slice(0, 500).replace(/\n+/g, '\n').trim();
  return {
    found: true,
    date: dateStr,
    hasSummary: false,
    message: 'No summary available yet (summaries are generated for older conversations).',
    preview: preview + (fileData.content.length > 500 ? '...' : ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const memoryIntegration: Integration = {
  name: 'memory',
  category: 'core',
  tools: memoryTools,

  async execute(toolName: string, toolInput: any, context: IntegrationContext): Promise<any> {
    const username = context.currentUser?.username;
    if (!username) return { error: 'Not logged in' };

    switch (toolName) {
      case 'search_memory':
        return executeMemorySearch(toolInput.query, toolInput.date_range, username);
      case 'get_conversations_for_date':
        return executeGetConversationsForDate(toolInput.date, username);
      case 'search_memory_between_dates':
        return executeSearchMemoryBetweenDates(
          toolInput.query,
          toolInput.start_date,
          toolInput.end_date,
          username
        );
      case 'list_memory_dates':
        return executeListMemoryDates(toolInput.limit, username);
      case 'get_conversation_summary':
        return executeGetConversationSummary(toolInput.date, username);
      default:
        return { error: `Unknown memory tool: ${toolName}` };
    }
  },

  async isAvailable(): Promise<boolean> {
    return true; // Memory tools are always available
  },
};
