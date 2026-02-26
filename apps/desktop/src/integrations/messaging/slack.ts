/**
 * Slack Integration
 *
 * Provides tools for interacting with Slack workspaces:
 * - List channels and DMs
 * - Get messages from channels/DMs
 * - Send messages
 * - Search users
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Slack API Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSlackChannels(accessToken: string): Promise<any[]> {
  const response = await fetch(
    'https://slack.com/api/conversations.list?types=public_channel,private_channel,im,mpim&limit=100',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data: any = await response.json();
  if (!data.ok) throw new Error(data.error);
  return data.channels || [];
}

async function fetchSlackMessages(
  accessToken: string,
  channelId: string,
  limit: number = 20
): Promise<any[]> {
  const response = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data: any = await response.json();
  if (!data.ok) throw new Error(data.error);
  return data.messages || [];
}

async function sendSlackMessage(
  accessToken: string,
  channelId: string,
  text: string
): Promise<any> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const data: any = await response.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

async function fetchSlackUsers(accessToken: string): Promise<any[]> {
  const response = await fetch('https://slack.com/api/users.list?limit=200', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data: any = await response.json();
  if (!data.ok) throw new Error(data.error);
  return data.members || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const slackTools: Tool[] = [
  {
    name: 'list_slack_channels',
    description: 'List Slack channels and direct messages in the connected workspace.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_slack_messages',
    description:
      "Get recent messages from a Slack channel or DM. For DMs, you can pass a person's name and it will find their DM channel automatically.",
    input_schema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description:
            "Channel name (e.g., #general), channel ID, user ID (e.g., U12345), or person's name (e.g., 'Chris Gorog') to get their DMs",
        },
        limit: {
          type: 'number',
          description: 'Number of messages to fetch (default 20)',
        },
      },
      required: ['channel'],
    },
  },
  {
    name: 'send_slack_message',
    description:
      'Send a message to a Slack channel or user. Always confirm with user before sending.',
    input_schema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description:
            "Channel name (e.g., #general), channel ID, user ID, or person's name (e.g., 'Jeff Chou') to send them a DM",
        },
        message: {
          type: 'string',
          description: 'Message text to send',
        },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'search_slack_users',
    description: 'Search for Slack users in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (name or email)',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeSlackTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.slack;

  if (!accessToken) {
    return { error: 'Slack not connected. Please authenticate in Settings.' };
  }

  try {
    switch (toolName) {
      case 'list_slack_channels': {
        const channels = await fetchSlackChannels(accessToken);
        return {
          channels: channels
            .map((c) => ({
              id: c.id,
              name: c.name || c.user,
              type: c.is_channel ? 'channel' : c.is_group ? 'private' : c.is_im ? 'dm' : 'group_dm',
              is_member: c.is_member,
              num_members: c.num_members,
            }))
            .slice(0, 50),
        };
      }

      case 'get_slack_messages': {
        let channelId = toolInput.channel;
        const limit = toolInput.limit || 20;

        // If channel starts with #, find the channel ID
        if (channelId.startsWith('#')) {
          const channels = await fetchSlackChannels(accessToken);
          const channel = channels.find((c) => c.name === channelId.slice(1));
          if (!channel) {
            return { error: `Channel ${channelId} not found` };
          }
          channelId = channel.id;
        }
        // If it's a user ID (starts with U), open DM channel
        else if (channelId.startsWith('U')) {
          console.log(`[Slack] Opening DM channel with user ID: ${channelId}`);
          const dmResponse = await fetch('https://slack.com/api/conversations.open', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ users: channelId }),
          });
          const dmData: any = await dmResponse.json();
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
            console.log(`[Slack] DM channel ID: ${channelId}`);
          } else {
            return { error: `Failed to open DM with user: ${dmData.error}` };
          }
        }
        // If it doesn't look like a channel/DM ID (C/D/G prefix), treat as user name search
        else if (!channelId.match(/^[CDG][A-Z0-9]+$/)) {
          console.log(`[Slack] Searching for user: ${channelId}`);
          const users = await fetchSlackUsers(accessToken);
          const query = channelId.toLowerCase();
          const matchedUser = users.find(
            (u) =>
              !u.deleted &&
              !u.is_bot &&
              ((u.real_name || '').toLowerCase().includes(query) ||
                (u.name || '').toLowerCase().includes(query))
          );

          if (!matchedUser) {
            return { error: `User "${channelId}" not found in Slack workspace` };
          }

          console.log(
            `[Slack] Found user: ${matchedUser.real_name || matchedUser.name} (${matchedUser.id})`
          );

          // Open DM channel with the user
          const dmResponse = await fetch('https://slack.com/api/conversations.open', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ users: matchedUser.id }),
          });
          const dmData: any = await dmResponse.json();
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
            console.log(`[Slack] DM channel ID: ${channelId}`);
          } else {
            return {
              error: `Failed to open DM with ${matchedUser.real_name || matchedUser.name}: ${dmData.error}`,
            };
          }
        }

        const messages = await fetchSlackMessages(accessToken, channelId, limit);

        // Get user info for names
        const users = await fetchSlackUsers(accessToken);
        const userMap = new Map(users.map((u) => [u.id, u.real_name || u.name]));

        return {
          messages: messages.map((m) => ({
            user: userMap.get(m.user) || m.user,
            text: m.text,
            timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
          })),
        };
      }

      case 'send_slack_message': {
        let channelId = toolInput.channel;
        const message = toolInput.message;

        // If channel starts with #, find the channel ID
        if (channelId.startsWith('#')) {
          const channels = await fetchSlackChannels(accessToken);
          const channel = channels.find((c) => c.name === channelId.slice(1));
          if (!channel) {
            return { error: `Channel ${channelId} not found` };
          }
          channelId = channel.id;
        }
        // If it's a user ID (starts with U), open DM channel
        else if (channelId.startsWith('U')) {
          console.log(`[Slack] Opening DM channel with user ID: ${channelId}`);
          const dmResponse = await fetch('https://slack.com/api/conversations.open', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ users: channelId }),
          });
          const dmData: any = await dmResponse.json();
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
            console.log(`[Slack] DM channel ID: ${channelId}`);
          } else {
            return { error: `Failed to open DM with user: ${dmData.error}` };
          }
        }
        // If it doesn't look like a channel/DM ID (C/D/G prefix), treat as user name search
        else if (!channelId.match(/^[CDG][A-Z0-9]+$/)) {
          console.log(`[Slack] Searching for user: ${channelId}`);
          const users = await fetchSlackUsers(accessToken);
          const query = channelId.toLowerCase();
          const matchedUser = users.find(
            (u) =>
              !u.deleted &&
              !u.is_bot &&
              ((u.real_name || '').toLowerCase().includes(query) ||
                (u.name || '').toLowerCase().includes(query))
          );

          if (!matchedUser) {
            return { error: `User "${channelId}" not found in Slack workspace` };
          }

          console.log(
            `[Slack] Found user: ${matchedUser.real_name || matchedUser.name} (${matchedUser.id})`
          );

          // Open DM channel with the user
          const dmResponse = await fetch('https://slack.com/api/conversations.open', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ users: matchedUser.id }),
          });
          const dmData: any = await dmResponse.json();
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
            console.log(`[Slack] DM channel ID: ${channelId}`);
          } else {
            return {
              error: `Failed to open DM with ${matchedUser.real_name || matchedUser.name}: ${dmData.error}`,
            };
          }
        }

        const sendResult = await sendSlackMessage(accessToken, channelId, message);
        return {
          success: true,
          message: `Message sent to ${toolInput.channel}`,
          channel: channelId, // Return the resolved channel ID for conversation tracking
          ts: sendResult?.ts, // Slack message timestamp (can be used for thread replies)
        };
      }

      case 'search_slack_users': {
        const users = await fetchSlackUsers(accessToken);
        const query = (toolInput.query || '').toLowerCase();

        let filtered = users.filter((u) => !u.deleted && !u.is_bot);
        if (query) {
          filtered = filtered.filter(
            (u) =>
              (u.real_name || '').toLowerCase().includes(query) ||
              (u.name || '').toLowerCase().includes(query) ||
              (u.profile?.email || '').toLowerCase().includes(query)
          );
        }

        return {
          users: filtered.slice(0, 20).map((u) => ({
            id: u.id,
            name: u.real_name || u.name,
            username: u.name,
            email: u.profile?.email,
            title: u.profile?.title,
          })),
        };
      }

      default:
        return { error: `Unknown Slack tool: ${toolName}` };
    }
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const slackIntegration: Integration = {
  name: 'slack',
  category: 'messaging',
  tools: slackTools,
  execute: executeSlackTool,
  isAvailable: async (context) => !!context.accessTokens?.slack,
};
