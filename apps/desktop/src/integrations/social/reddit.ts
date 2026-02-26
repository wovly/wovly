/**
 * Reddit Integration
 *
 * Provides MCP tools for interacting with Reddit:
 * - Get home feed and subreddit posts
 * - Read comments
 * - Create posts and comments
 * - Access inbox messages
 *
 * All tools require Reddit OAuth connection.
 */

import { Integration, Tool, IntegrationContext } from '../base';

/**
 * Reddit MCP Tools
 */
const redditTools: Tool[] = [
  {
    name: 'get_reddit_feed',
    description: 'Get posts from Reddit home feed.',
    input_schema: {
      type: 'object',
      properties: {
        sort: {
          type: 'string',
          enum: ['hot', 'new', 'top', 'rising'],
          description: 'Sort order (default: hot)',
        },
        limit: {
          type: 'number',
          description: 'Number of posts (default 25, max 100)',
        },
      },
      required: [],
    } as any,
  },
  {
    name: 'get_subreddit_posts',
    description: 'Get posts from a specific subreddit.',
    input_schema: {
      type: 'object',
      properties: {
        subreddit: {
          type: 'string',
          description: 'Subreddit name (without r/)',
        },
        sort: {
          type: 'string',
          enum: ['hot', 'new', 'top', 'rising'],
          description: 'Sort order',
        },
        limit: {
          type: 'number',
          description: 'Number of posts (default 25)',
        },
      },
      required: ['subreddit'],
    } as any,
  },
  {
    name: 'get_reddit_comments',
    description: 'Get comments on a Reddit post.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID (the thing after t3_)',
        },
        subreddit: {
          type: 'string',
          description: 'Subreddit name',
        },
        limit: {
          type: 'number',
          description: 'Number of comments (default 25)',
        },
      },
      required: ['post_id', 'subreddit'],
    } as any,
  },
  {
    name: 'create_reddit_post',
    description: 'Create a post on Reddit. Always confirm with user before posting.',
    input_schema: {
      type: 'object',
      properties: {
        subreddit: {
          type: 'string',
          description: 'Subreddit to post to',
        },
        title: {
          type: 'string',
          description: 'Post title',
        },
        text: {
          type: 'string',
          description: 'Post text (for self posts)',
        },
        url: {
          type: 'string',
          description: 'URL to link (for link posts)',
        },
      },
      required: ['subreddit', 'title'],
    } as any,
  },
  {
    name: 'create_reddit_comment',
    description: 'Add a comment to a Reddit post. Always confirm with user before posting.',
    input_schema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description: 'Parent thing ID (t1_ for comment, t3_ for post)',
        },
        text: {
          type: 'string',
          description: 'Comment text',
        },
      },
      required: ['parent_id', 'text'],
    } as any,
  },
  {
    name: 'get_reddit_messages',
    description: 'Get Reddit inbox messages.',
    input_schema: {
      type: 'object',
      properties: {
        where: {
          type: 'string',
          enum: ['inbox', 'unread', 'sent'],
          description: 'Message location (default: inbox)',
        },
      },
      required: [],
    } as any,
  },
];

/**
 * Execute Reddit tool
 */
async function executeRedditTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.reddit;

  if (!accessToken) {
    return { error: 'Reddit not connected. Please set up Reddit in the Integrations page.' };
  }

  const baseUrl = 'https://oauth.reddit.com';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'Wovly/1.0',
  };

  try {
    switch (toolName) {
      case 'get_reddit_feed': {
        const sort = toolInput.sort || 'hot';
        const limit = Math.min(toolInput.limit || 25, 100);
        const response = await fetch(`${baseUrl}/${sort}?limit=${limit}`, { headers });
        if (!response.ok) {
          return { error: 'Failed to get feed' };
        }
        const data = (await response.json()) as any;
        return {
          posts: data.data.children.map((p: any) => ({
            id: p.data.id,
            title: p.data.title,
            subreddit: p.data.subreddit,
            author: p.data.author,
            score: p.data.score,
            num_comments: p.data.num_comments,
            url: p.data.url,
            selftext: p.data.selftext?.slice(0, 500),
          })),
        };
      }

      case 'get_subreddit_posts': {
        const sort = toolInput.sort || 'hot';
        const limit = Math.min(toolInput.limit || 25, 100);
        const response = await fetch(`${baseUrl}/r/${toolInput.subreddit}/${sort}?limit=${limit}`, {
          headers,
        });
        if (!response.ok) {
          return { error: 'Failed to get subreddit posts' };
        }
        const data = (await response.json()) as any;
        return {
          posts: data.data.children.map((p: any) => ({
            id: p.data.id,
            title: p.data.title,
            author: p.data.author,
            score: p.data.score,
            num_comments: p.data.num_comments,
            url: p.data.url,
            selftext: p.data.selftext?.slice(0, 500),
          })),
        };
      }

      case 'get_reddit_comments': {
        const limit = Math.min(toolInput.limit || 25, 100);
        const response = await fetch(
          `${baseUrl}/r/${toolInput.subreddit}/comments/${toolInput.post_id}?limit=${limit}`,
          { headers }
        );
        if (!response.ok) {
          return { error: 'Failed to get comments' };
        }
        const data = (await response.json()) as any;
        const comments = data[1]?.data?.children || [];
        return {
          comments: comments
            .filter((c: any) => c.kind === 't1')
            .map((c: any) => ({
              id: c.data.id,
              author: c.data.author,
              body: c.data.body?.slice(0, 500),
              score: c.data.score,
              created_utc: c.data.created_utc,
            })),
        };
      }

      case 'create_reddit_post': {
        const formData = new URLSearchParams();
        formData.append('sr', toolInput.subreddit);
        formData.append('title', toolInput.title);
        formData.append('kind', toolInput.url ? 'link' : 'self');
        if (toolInput.url) formData.append('url', toolInput.url);
        if (toolInput.text) formData.append('text', toolInput.text);

        const response = await fetch(`${baseUrl}/api/submit`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
        });
        if (!response.ok) {
          return { error: 'Failed to create post' };
        }
        const data = (await response.json()) as any;
        if (data.json?.errors?.length > 0) {
          return { error: data.json.errors[0][1] };
        }
        return {
          success: true,
          url: data.json?.data?.url,
          id: data.json?.data?.id,
        };
      }

      case 'create_reddit_comment': {
        const formData = new URLSearchParams();
        formData.append('thing_id', toolInput.parent_id);
        formData.append('text', toolInput.text);

        const response = await fetch(`${baseUrl}/api/comment`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
        });
        if (!response.ok) {
          return { error: 'Failed to create comment' };
        }
        const data = (await response.json()) as any;
        if (data.json?.errors?.length > 0) {
          return { error: data.json.errors[0][1] };
        }
        return { success: true, message: 'Comment posted' };
      }

      case 'get_reddit_messages': {
        const where = toolInput.where || 'inbox';
        const response = await fetch(`${baseUrl}/message/${where}`, { headers });
        if (!response.ok) {
          return { error: 'Failed to get messages' };
        }
        const data = (await response.json()) as any;
        return {
          messages: data.data.children.map((m: any) => ({
            id: m.data.id,
            subject: m.data.subject,
            author: m.data.author,
            body: m.data.body?.slice(0, 500),
            created_utc: m.data.created_utc,
            new: m.data.new,
          })),
        };
      }

      default:
        return { error: `Unknown Reddit tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Reddit] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const redditIntegration: Integration = {
  name: 'reddit',
  category: 'social',
  tools: redditTools,
  execute: executeRedditTool as any,
  isAvailable: async (context: IntegrationContext) => {
    return !!context.accessTokens?.reddit;
  },
};
