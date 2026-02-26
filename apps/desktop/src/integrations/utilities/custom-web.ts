/**
 * Custom Web Integration
 *
 * Provides tools for interacting with custom web integrations (Brightwheel, tax sites, school portals, etc.):
 * - Search messages from custom web integrations
 * - Get recent messages from all or specific sites
 * - Get messages by date or date range
 * - List all configured custom web sites
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const customWebTools: Tool[] = [
  {
    name: 'search_custom_web_messages',
    description:
      'Search messages from custom web integrations like Brightwheel, tax sites, school portals. Use when user asks about messages from sites without native APIs.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for in message content',
        },
        site: {
          type: 'string',
          description: "Filter by site ID (e.g., 'brightwheel', 'turbotax')",
        },
        from: {
          type: 'string',
          description: 'Filter by sender name',
        },
        days_back: {
          type: 'number',
          description: 'How many days to search back (default 30)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_custom_web_messages',
    description:
      'Get recent messages from custom web integrations. Lists all messages from Brightwheel, tax sites, etc. in chronological order.',
    input_schema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Filter by site ID (optional)',
        },
        hours: {
          type: 'number',
          description: 'Hours back to look (default 24)',
        },
        limit: {
          type: 'number',
          description: 'Max messages (default 50)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_custom_web_messages_by_date',
    description: 'Get all messages from custom web integrations for a specific date or date range.',
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'Optional end date for range (YYYY-MM-DD)',
        },
        site: {
          type: 'string',
          description: 'Filter by site ID (optional)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'list_custom_web_sites',
    description:
      'List all configured custom web integrations with their status. Shows which sites are enabled, paused, or having issues.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a custom web tool
 */
async function executeCustomWebTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  try {
    // Import the custom web tool executor from compiled JavaScript
    const { executeCustomWebTool: execute } = require('../../dist/tools/customweb');

    // Execute the tool with the username from context
    return await execute(toolName, toolInput, context.currentUser?.username);
  } catch (err) {
    console.error(`[CustomWeb] Error executing ${toolName}:`, err);
    return {
      error: err instanceof Error ? err.message : 'Unknown error occurred',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom Web Integration
 *
 * Always available - no authentication required.
 * Accesses locally stored messages from custom web integrations.
 */
export const customWebIntegration: Integration = {
  name: 'custom-web',
  category: 'utilities',
  tools: customWebTools,
  execute: executeCustomWebTool,

  /**
   * Custom web integration is always available
   * (it works with locally stored data, no external auth needed)
   */
  isAvailable: async (_context: IntegrationContext) => {
    return true;
  },
};

export default customWebIntegration;
