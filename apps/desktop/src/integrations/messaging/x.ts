/**
 * X (Twitter) Integration
 *
 * Provides tools for interacting with X (Twitter):
 * - Post tweets
 * - Get timeline
 * - Get mentions
 * - Search tweets
 * - Send direct messages
 *
 * Includes OAuth token refresh logic to maintain authenticated sessions.
 */

import { Integration, Tool, IntegrationContext } from '../base';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../../utils/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Token Management Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * X token storage structure
 */
interface XTokens {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  expires_at?: number;
}

/**
 * Get X access token from settings, with automatic refresh if expired
 */
async function getXAccessToken(username?: string): Promise<string | null> {
  try {
    if (!username) {
      return null;
    }

    const settingsPath = await getSettingsPath(username);
    const settingsData = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(settingsData);

    if (!settings.xTokens) {
      return null;
    }

    // Check if token needs refresh (refresh 1 minute before expiry)
    if (settings.xTokens.expires_at && Date.now() > settings.xTokens.expires_at - 60000) {
      const refreshed = await refreshXToken(settings.xTokens);
      if (refreshed) {
        settings.xTokens = refreshed;
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        return refreshed.access_token;
      }
      return null;
    }

    return settings.xTokens.access_token;
  } catch {
    return null;
  }
}

/**
 * Refresh X OAuth token using refresh token
 */
async function refreshXToken(tokens: XTokens): Promise<XTokens | null> {
  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      }),
    });

    const data: any = await response.json();

    if (data.access_token) {
      return {
        ...tokens,
        access_token: data.access_token,
        refresh_token: data.refresh_token || tokens.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const xTools: Tool[] = [
  {
    name: 'post_tweet',
    description: 'Post a tweet to X (Twitter). Always confirm with user before posting.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Tweet text (max 280 characters)',
        },
        reply_to: {
          type: 'string',
          description: 'Tweet ID to reply to (optional)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_x_timeline',
    description: 'Get recent tweets from your home timeline.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of tweets to fetch (default 20, max 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_x_mentions',
    description: 'Get recent mentions of your account.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of mentions to fetch (default 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_x_tweets',
    description: 'Search for tweets on X.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Number of results (default 20, max 100)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_x_dm',
    description: 'Send a direct message on X. Always confirm with user before sending.',
    input_schema: {
      type: 'object',
      properties: {
        recipient_id: {
          type: 'string',
          description: 'User ID of the recipient',
        },
        message: {
          type: 'string',
          description: 'Message text',
        },
      },
      required: ['recipient_id', 'message'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeXTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  // Get access token (with auto-refresh if needed)
  const accessToken = await getXAccessToken(context.currentUser?.username);

  if (!accessToken) {
    return { error: 'X (Twitter) not connected. Please set up X in the Integrations page.' };
  }

  const baseUrl = 'https://api.twitter.com/2';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    switch (toolName) {
      case 'post_tweet': {
        const body: any = { text: toolInput.text };

        if (toolInput.reply_to) {
          body.reply = { in_reply_to_tweet_id: toolInput.reply_to };
        }

        const response = await fetch(`${baseUrl}/tweets`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err: any = await response.json();
          return { error: err.detail || err.title || 'Failed to post tweet' };
        }

        const data: any = await response.json();
        return {
          success: true,
          tweet_id: data.data.id,
          message: 'Tweet posted successfully',
        };
      }

      case 'get_x_timeline': {
        const limit = Math.min(toolInput.limit || 20, 100);
        const response = await fetch(
          `${baseUrl}/users/me/timelines/reverse_chronological?max_results=${limit}&tweet.fields=created_at,author_id,text`,
          { headers }
        );

        if (!response.ok) {
          const err: any = await response.json();
          return { error: err.detail || 'Failed to get timeline' };
        }

        const data: any = await response.json();
        return {
          tweets: (data.data || []).map((t: any) => ({
            id: t.id,
            text: t.text,
            created_at: t.created_at,
            author_id: t.author_id,
          })),
        };
      }

      case 'get_x_mentions': {
        // First get user ID
        const meResponse = await fetch(`${baseUrl}/users/me`, { headers });

        if (!meResponse.ok) {
          return { error: 'Failed to get user info' };
        }

        const meData: any = await meResponse.json();
        const userId = meData.data.id;

        const limit = Math.min(toolInput.limit || 20, 100);
        const response = await fetch(
          `${baseUrl}/users/${userId}/mentions?max_results=${limit}&tweet.fields=created_at,author_id,text`,
          { headers }
        );

        if (!response.ok) {
          const err: any = await response.json();
          return { error: err.detail || 'Failed to get mentions' };
        }

        const data: any = await response.json();
        return {
          mentions: (data.data || []).map((t: any) => ({
            id: t.id,
            text: t.text,
            created_at: t.created_at,
            author_id: t.author_id,
          })),
        };
      }

      case 'search_x_tweets': {
        const limit = Math.min(toolInput.limit || 20, 100);
        const response = await fetch(
          `${baseUrl}/tweets/search/recent?query=${encodeURIComponent(toolInput.query)}&max_results=${limit}&tweet.fields=created_at,author_id,text`,
          { headers }
        );

        if (!response.ok) {
          const err: any = await response.json();
          return { error: err.detail || 'Failed to search tweets' };
        }

        const data: any = await response.json();
        return {
          tweets: (data.data || []).map((t: any) => ({
            id: t.id,
            text: t.text,
            created_at: t.created_at,
            author_id: t.author_id,
          })),
        };
      }

      case 'send_x_dm': {
        const response = await fetch(
          `${baseUrl}/dm_conversations/with/${toolInput.recipient_id}/messages`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: toolInput.message }),
          }
        );

        if (!response.ok) {
          const err: any = await response.json();
          return { error: err.detail || 'Failed to send DM' };
        }

        const data: any = await response.json();
        return {
          success: true,
          message: 'DM sent successfully',
          dm_id: data.data?.dm_event_id,
        };
      }

      default:
        return { error: `Unknown X tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[X] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const xIntegration: Integration = {
  name: 'x',
  category: 'messaging',
  tools: xTools,
  execute: executeXTool as any,
  isAvailable: async (context) => {
    const accessToken = await getXAccessToken(context.currentUser?.username);
    return !!accessToken;
  },
};
