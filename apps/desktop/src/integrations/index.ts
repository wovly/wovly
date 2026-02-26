/**
 * Integration Registry
 *
 * Central export point for all integrations.
 * Provides helper functions for tool discovery and execution.
 */

import { Integration, Tool, IntegrationContext, IntegrationResponse } from './base';

// Messaging integrations
import { slackIntegration } from './messaging/slack';
import { discordIntegration } from './messaging/discord';
import { telegramIntegration } from './messaging/telegram';
import { xIntegration } from './messaging/x';
import { iMessageIntegration } from './messaging/imessage';
import { whatsappIntegration } from './messaging/whatsapp';

// Productivity integrations
import { googleWorkspaceIntegration } from './productivity/google-workspace';
import { asanaIntegration } from './productivity/asana';
import { notionIntegration } from './productivity/notion';
import { githubIntegration } from './productivity/github';

// Social integrations
import { redditIntegration } from './social/reddit';
import { spotifyIntegration } from './social/spotify';

// Utility integrations
import { weatherIntegration } from './utilities/weather';
import { browserIntegration } from './utilities/browser';
import { customWebIntegration } from './utilities/custom-web';

// Core integrations
import { profileIntegration } from './core/profile';
import { memoryIntegration } from './core/memory';
import { tasksIntegration } from './core/tasks';
import { skillsIntegration } from './core/skills';
import { timeIntegration } from './core/time';
import { documentationIntegration } from './core/documentation';

// Export base types
export type { Integration, Tool, IntegrationContext, IntegrationResponse };

/**
 * All registered integrations
 *
 * Total: 21 integrations organized by category
 */
export const ALL_INTEGRATIONS: Integration[] = [
  // Messaging (6 integrations)
  slackIntegration,
  discordIntegration,
  telegramIntegration,
  xIntegration,
  iMessageIntegration,
  whatsappIntegration,

  // Productivity (4 integrations)
  googleWorkspaceIntegration,
  asanaIntegration,
  notionIntegration,
  githubIntegration,

  // Social (2 integrations)
  redditIntegration,
  spotifyIntegration,

  // Utilities (3 integrations)
  weatherIntegration,
  browserIntegration,
  customWebIntegration,

  // Core (6 integrations)
  profileIntegration,
  memoryIntegration,
  tasksIntegration,
  skillsIntegration,
  timeIntegration,
  documentationIntegration,
];

/**
 * Get all tools from all available integrations
 *
 * @param context - Runtime context for checking integration availability
 * @returns Array of all available tools
 */
export async function getAllTools(context: IntegrationContext): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const integration of ALL_INTEGRATIONS) {
    // Check if integration is available for this context
    const isAvailable = integration.isAvailable ? await integration.isAvailable(context) : true;

    if (isAvailable) {
      tools.push(...integration.tools);
    }
  }

  return tools;
}

/**
 * Execute a tool by name across all integrations
 *
 * @param toolName - Name of the tool to execute
 * @param toolInput - Input parameters for the tool
 * @param context - Runtime context
 * @returns Tool execution result
 */
export async function executeTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  // Find the integration that provides this tool
  for (const integration of ALL_INTEGRATIONS) {
    const tool = integration.tools.find((t) => t.name === toolName);
    if (tool) {
      return await integration.execute(toolName, toolInput, context);
    }
  }

  // Tool not found
  return {
    error: `Unknown tool: ${toolName}. Tool not found in any registered integration.`,
  };
}

/**
 * Get integration by name
 *
 * @param name - Integration name (e.g., "slack", "github")
 * @returns Integration object or undefined if not found
 */
export function getIntegration(name: string): Integration | undefined {
  return ALL_INTEGRATIONS.find((i) => i.name === name);
}

/**
 * Get integrations by category
 *
 * @param category - Integration category
 * @returns Array of integrations in that category
 */
export function getIntegrationsByCategory(category: Integration['category']): Integration[] {
  return ALL_INTEGRATIONS.filter((i) => i.category === category);
}

/**
 * Get all tool names across all integrations
 *
 * Useful for debugging and verification
 */
export function getAllToolNames(): string[] {
  return ALL_INTEGRATIONS.flatMap((integration) => integration.tools.map((tool) => tool.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Integration Exports (for direct access)
// ─────────────────────────────────────────────────────────────────────────────

// Messaging
export { slackIntegration } from './messaging/slack';
export { discordIntegration } from './messaging/discord';
export { telegramIntegration } from './messaging/telegram';
export { xIntegration } from './messaging/x';
export { iMessageIntegration } from './messaging/imessage';
export { whatsappIntegration } from './messaging/whatsapp';

// Productivity
export { googleWorkspaceIntegration } from './productivity/google-workspace';
export { asanaIntegration } from './productivity/asana';
export { notionIntegration } from './productivity/notion';
export { githubIntegration } from './productivity/github';

// Social
export { redditIntegration } from './social/reddit';
export { spotifyIntegration } from './social/spotify';

// Utilities
export { weatherIntegration } from './utilities/weather';
export { browserIntegration } from './utilities/browser';
export { customWebIntegration } from './utilities/custom-web';

// Core
export { profileIntegration } from './core/profile';
export { memoryIntegration } from './core/memory';
export { tasksIntegration } from './core/tasks';
export { skillsIntegration } from './core/skills';
export { timeIntegration } from './core/time';
export { documentationIntegration } from './core/documentation';
