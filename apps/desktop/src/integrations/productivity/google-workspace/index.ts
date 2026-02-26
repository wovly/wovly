/**
 * Google Workspace Integration
 *
 * Combines Gmail, Calendar, and Drive integrations into a single workspace integration.
 * This is the largest integration with 9 tools across multiple Google services.
 *
 * Services:
 * - Gmail: Email search, read, send, and LLM analysis
 * - Calendar: Event management (get, create, delete)
 * - Drive: File listing
 */

import { Integration, IntegrationContext } from '../../base';
import { gmailTools, executeGmailTool } from './gmail';
import { calendarTools, executeCalendarTool } from './calendar';
import { driveTools, executeDriveTool } from './drive';

// ─────────────────────────────────────────────────────────────────────────────
// Integration Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Google Workspace Integration
 *
 * Provides comprehensive Google Workspace functionality through Gmail, Calendar, and Drive APIs.
 */
export const googleWorkspaceIntegration: Integration = {
  name: 'google-workspace',
  category: 'productivity',

  // Combine all tools from sub-modules
  tools: [...gmailTools, ...calendarTools, ...driveTools],

  /**
   * Execute a tool from any Google Workspace service
   */
  async execute(toolName: string, toolInput: any, context: IntegrationContext): Promise<any> {
    // Route to appropriate sub-module based on tool name
    const gmailToolNames = gmailTools.map((t) => t.name);
    const calendarToolNames = calendarTools.map((t) => t.name);
    const driveToolNames = driveTools.map((t) => t.name);

    if (gmailToolNames.includes(toolName)) {
      return executeGmailTool(toolName, toolInput, context);
    }

    if (calendarToolNames.includes(toolName)) {
      return executeCalendarTool(toolName, toolInput, context);
    }

    if (driveToolNames.includes(toolName)) {
      return executeDriveTool(toolName, toolInput, context);
    }

    return { error: `Unknown Google Workspace tool: ${toolName}` };
  },

  /**
   * Check if Google Workspace is available
   * Requires Google OAuth access token
   */
  async isAvailable(context: IntegrationContext): Promise<boolean> {
    return !!context.accessTokens?.google;
  },
};

export default googleWorkspaceIntegration;
