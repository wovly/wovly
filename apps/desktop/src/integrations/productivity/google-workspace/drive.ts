/**
 * Google Drive Integration Module
 *
 * Provides Google Drive functionality: file listing.
 * Part of the Google Workspace integration.
 */

import { IntegrationContext } from '../../base';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const driveTools = [
  {
    name: 'list_drive_files',
    description: 'List files in Google Drive.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },
] as any[];

// ─────────────────────────────────────────────────────────────────────────────
// Execute Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Google Drive tool
 */
export async function executeDriveTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.google;
  if (!accessToken) {
    return { error: 'Google access token not available' };
  }

  try {
    switch (toolName) {
      case 'list_drive_files': {
        const { query, maxResults = 10 } = toolInput;

        const url = new URL('https://www.googleapis.com/drive/v3/files');
        url.searchParams.set('pageSize', maxResults.toString());
        if (query) url.searchParams.set('q', `name contains '${query}'`);

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          throw new Error('Failed to list files');
        }

        const data = (await response.json()) as any;
        return { files: data.files || [] };
      }

      default:
        return { error: `Unknown Drive tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`[Drive] Error executing ${toolName}:`, error);
    return { error: error.message || String(error) };
  }
}
