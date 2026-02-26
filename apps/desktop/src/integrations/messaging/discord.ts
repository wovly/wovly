/**
 * Discord Integration
 *
 * Provides tools for interacting with Discord servers:
 * - List servers and channels
 * - Get messages from channels
 * - Send messages
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Discord API Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_API_BASE = 'https://discord.com/api/v10';

async function fetchDiscordServers(accessToken: string): Promise<any[]> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err: any = await response.json();
    throw new Error(err.message || 'Failed to list servers');
  }
  const guilds: any = await response.json();
  return guilds;
}

async function fetchDiscordChannels(accessToken: string, guildId: string): Promise<any[]> {
  const response = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err: any = await response.json();
    throw new Error(err.message || 'Failed to list channels');
  }
  const channels: any = await response.json();
  return channels;
}

async function fetchDiscordMessages(
  accessToken: string,
  channelId: string,
  limit: number = 20
): Promise<any[]> {
  const actualLimit = Math.min(limit, 100);
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${actualLimit}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!response.ok) {
    const err: any = await response.json();
    throw new Error(err.message || 'Failed to get messages');
  }
  const messages: any = await response.json();
  return messages;
}

async function sendDiscordMessage(
  accessToken: string,
  channelId: string,
  content: string
): Promise<any> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const err: any = await response.json();
    throw new Error(err.message || 'Failed to send message');
  }
  const data: any = await response.json();
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const discordTools: Tool[] = [
  {
    name: 'send_discord_message',
    description:
      'Send a message to a Discord channel or DM. Always confirm with user before sending.',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID or user ID for DM',
        },
        message: {
          type: 'string',
          description: 'Message content to send',
        },
      },
      required: ['channel_id', 'message'],
    },
  },
  {
    name: 'get_discord_messages',
    description: 'Get recent messages from a Discord channel.',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID',
        },
        limit: {
          type: 'number',
          description: 'Number of messages to fetch (default 20, max 100)',
        },
      },
      required: ['channel_id'],
    },
  },
  {
    name: 'list_discord_channels',
    description: 'List channels in a Discord server (guild).',
    input_schema: {
      type: 'object',
      properties: {
        guild_id: {
          type: 'string',
          description: 'Server/Guild ID',
        },
      },
      required: ['guild_id'],
    },
  },
  {
    name: 'list_discord_servers',
    description: 'List Discord servers (guilds) the bot/user has access to.',
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

async function executeDiscordTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.discord;

  if (!accessToken) {
    return { error: 'Discord not connected. Please set up Discord in the Integrations page.' };
  }

  try {
    switch (toolName) {
      case 'send_discord_message': {
        const data = await sendDiscordMessage(accessToken, toolInput.channel_id, toolInput.message);
        return {
          success: true,
          message: `Message sent`,
          message_id: data.id,
          channel_id: toolInput.channel_id, // Return channel_id for conversation tracking
        };
      }

      case 'get_discord_messages': {
        const limit = toolInput.limit || 20;
        const messages = await fetchDiscordMessages(accessToken, toolInput.channel_id, limit);
        return {
          messages: messages.map((m: any) => ({
            id: m.id,
            content: m.content,
            author: m.author.username,
            timestamp: m.timestamp,
          })),
        };
      }

      case 'list_discord_channels': {
        const channels = await fetchDiscordChannels(accessToken, toolInput.guild_id);
        return {
          channels: channels
            .filter((c: any) => c.type === 0 || c.type === 2)
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              type: c.type === 0 ? 'text' : 'voice',
            })),
        };
      }

      case 'list_discord_servers': {
        const guilds = await fetchDiscordServers(accessToken);
        return {
          servers: guilds.map((g: any) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
          })),
        };
      }

      default:
        return { error: `Unknown Discord tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Discord] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const discordIntegration: Integration = {
  name: 'discord',
  category: 'messaging',
  tools: discordTools,
  execute: executeDiscordTool,
  isAvailable: async (context) => !!context.accessTokens?.discord,
};
