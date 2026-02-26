/**
 * Notion Integration
 *
 * Provides tools for interacting with Notion workspace:
 * - Search pages and databases
 * - Get page content
 * - Create pages
 * - Query databases
 * - Create database items
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Notion API Constants
// ─────────────────────────────────────────────────────────────────────────────

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2022-06-28';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const notionTools: Tool[] = [
  {
    name: 'search_notion',
    description: 'Search for pages and databases in Notion.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        filter: {
          type: 'string',
          enum: ['page', 'database'],
          description: 'Filter by object type (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_notion_page',
    description: 'Get the content of a Notion page.',
    input_schema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The page ID',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'create_notion_page',
    description: 'Create a new page in Notion.',
    input_schema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description: 'Parent page or database ID',
        },
        title: {
          type: 'string',
          description: 'Page title',
        },
        content: {
          type: 'string',
          description: 'Page content (plain text)',
        },
      },
      required: ['parent_id', 'title'],
    },
  },
  {
    name: 'query_notion_database',
    description: 'Query a Notion database.',
    input_schema: {
      type: 'object',
      properties: {
        database_id: {
          type: 'string',
          description: 'Database ID',
        },
        filter: {
          type: 'object',
          description: 'Filter object (optional)',
        },
        sorts: {
          type: 'array',
          description: 'Sort array (optional)',
        },
      },
      required: ['database_id'],
    },
  },
  {
    name: 'create_notion_database_item',
    description: 'Add a new item to a Notion database.',
    input_schema: {
      type: 'object',
      properties: {
        database_id: {
          type: 'string',
          description: 'Database ID',
        },
        properties: {
          type: 'object',
          description: 'Property values for the new item',
        },
      },
      required: ['database_id', 'properties'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeNotionTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.notion;

  if (!accessToken) {
    return {
      error: 'Notion not connected. Please set up Notion in the Integrations page.',
    };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_API_VERSION,
  };

  try {
    switch (toolName) {
      case 'search_notion': {
        const body: any = {};
        if (toolInput.query) body.query = toolInput.query;
        if (toolInput.filter) {
          body.filter = {
            value: toolInput.filter,
            property: 'object',
          };
        }

        const response = await fetch(`${NOTION_API_BASE}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = (await response.json()) as any;
          return { error: err.message || 'Search failed' };
        }

        const data = (await response.json()) as any;
        return {
          results: data.results.slice(0, 20).map((r: any) => ({
            id: r.id,
            type: r.object,
            title:
              r.properties?.title?.title?.[0]?.plain_text ||
              r.properties?.Name?.title?.[0]?.plain_text ||
              'Untitled',
            url: r.url,
          })),
        };
      }

      case 'get_notion_page': {
        // Get page metadata
        const pageResponse = await fetch(`${NOTION_API_BASE}/pages/${toolInput.page_id}`, {
          headers,
        });

        if (!pageResponse.ok) {
          const err = (await pageResponse.json()) as any;
          return { error: err.message || 'Failed to get page' };
        }

        const page = (await pageResponse.json()) as any;

        // Get page content (blocks)
        const blocksResponse = await fetch(
          `${NOTION_API_BASE}/blocks/${toolInput.page_id}/children?page_size=100`,
          { headers }
        );

        const blocks = blocksResponse.ok ? ((await blocksResponse.json()) as any) : { results: [] };

        return {
          page: {
            id: page.id,
            title: page.properties?.title?.title?.[0]?.plain_text || 'Untitled',
            url: page.url,
            created_time: page.created_time,
            last_edited_time: page.last_edited_time,
          },
          content: blocks.results
            .map((b: any) => ({
              type: b.type,
              text: b[b.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '',
            }))
            .filter((b: any) => b.text),
        };
      }

      case 'create_notion_page': {
        const body: any = {
          parent: { page_id: toolInput.parent_id },
          properties: {
            title: {
              title: [{ text: { content: toolInput.title } }],
            },
          },
        };

        if (toolInput.content) {
          body.children = [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: { content: toolInput.content },
                  },
                ],
              },
            },
          ];
        }

        const response = await fetch(`${NOTION_API_BASE}/pages`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = (await response.json()) as any;
          return { error: err.message || 'Failed to create page' };
        }

        const data = (await response.json()) as any;
        return {
          success: true,
          page_id: data.id,
          url: data.url,
        };
      }

      case 'query_notion_database': {
        const body: any = {};
        if (toolInput.filter) body.filter = toolInput.filter;
        if (toolInput.sorts) body.sorts = toolInput.sorts;

        const response = await fetch(
          `${NOTION_API_BASE}/databases/${toolInput.database_id}/query`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const err = (await response.json()) as any;
          return { error: err.message || 'Query failed' };
        }

        const data = (await response.json()) as any;
        return {
          results: data.results.slice(0, 50).map((r: any) => ({
            id: r.id,
            properties: Object.fromEntries(
              Object.entries(r.properties).map(([key, val]: [string, any]) => [
                key,
                val.title?.[0]?.plain_text ||
                  val.rich_text?.[0]?.plain_text ||
                  val.number ||
                  val.select?.name ||
                  val.date?.start ||
                  val.checkbox ||
                  JSON.stringify(val),
              ])
            ),
          })),
        };
      }

      case 'create_notion_database_item': {
        const response = await fetch(`${NOTION_API_BASE}/pages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: toolInput.database_id },
            properties: toolInput.properties,
          }),
        });

        if (!response.ok) {
          const err = (await response.json()) as any;
          return { error: err.message || 'Failed to create item' };
        }

        const data = (await response.json()) as any;
        return {
          success: true,
          id: data.id,
          url: data.url,
        };
      }

      default:
        return { error: `Unknown Notion tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Notion] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const notionIntegration: Integration = {
  name: 'notion',
  category: 'productivity',
  tools: notionTools,
  execute: executeNotionTool,
  isAvailable: async (context) => !!context.accessTokens?.notion,
};
