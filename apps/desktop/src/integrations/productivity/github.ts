/**
 * GitHub Integration
 *
 * Provides tools for interacting with GitHub repositories:
 * - List repositories
 * - Get issues and PRs
 * - Create issues
 * - Search code
 * - Get notifications
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API Constants
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const githubTools: Tool[] = [
  {
    name: 'list_github_repos',
    description: 'List repositories for the authenticated user.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['all', 'owner', 'member'],
          description: 'Type of repos (default: all)',
        },
        sort: {
          type: 'string',
          enum: ['created', 'updated', 'pushed', 'full_name'],
          description: 'Sort by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_github_issues',
    description: 'Get issues from a repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Issue state (default: open)',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_github_issue',
    description: 'Create an issue in a repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body/description' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to add',
        },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'get_github_prs',
    description: 'Get pull requests from a repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'PR state (default: open)',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'search_github_code',
    description: 'Search for code on GitHub.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (can include qualifiers like repo:owner/name)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_github_notifications',
    description: 'Get notifications for the authenticated user.',
    input_schema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Show all notifications (default: false, shows only unread)',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeGitHubTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.github;

  if (!accessToken) {
    return {
      error: 'GitHub not connected. Please set up GitHub in the Integrations page.',
    };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };

  try {
    switch (toolName) {
      case 'list_github_repos': {
        const params = new URLSearchParams();
        if (toolInput.type) params.set('type', toolInput.type);
        if (toolInput.sort) params.set('sort', toolInput.sort);
        params.set('per_page', '30');

        const response = await fetch(`${GITHUB_API_BASE}/user/repos?${params}`, { headers });

        if (!response.ok) {
          return { error: 'Failed to list repos' };
        }

        const repos = (await response.json()) as any[];
        return {
          repos: repos.map((r) => ({
            name: r.full_name,
            description: r.description,
            private: r.private,
            stars: r.stargazers_count,
            language: r.language,
            updated_at: r.updated_at,
          })),
        };
      }

      case 'get_github_issues': {
        const state = toolInput.state || 'open';
        const response = await fetch(
          `${GITHUB_API_BASE}/repos/${toolInput.owner}/${toolInput.repo}/issues?state=${state}&per_page=30`,
          { headers }
        );

        if (!response.ok) {
          return { error: 'Failed to get issues' };
        }

        const issues = (await response.json()) as any[];
        return {
          issues: issues
            .filter((i) => !i.pull_request)
            .map((i) => ({
              number: i.number,
              title: i.title,
              state: i.state,
              author: i.user.login,
              labels: i.labels.map((l: any) => l.name),
              created_at: i.created_at,
            })),
        };
      }

      case 'create_github_issue': {
        const body: any = {
          title: toolInput.title,
          body: toolInput.body || '',
        };
        if (toolInput.labels) body.labels = toolInput.labels;

        const response = await fetch(
          `${GITHUB_API_BASE}/repos/${toolInput.owner}/${toolInput.repo}/issues`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const err = (await response.json()) as any;
          return { error: err.message || 'Failed to create issue' };
        }

        const issue = (await response.json()) as any;
        return {
          success: true,
          number: issue.number,
          url: issue.html_url,
        };
      }

      case 'get_github_prs': {
        const state = toolInput.state || 'open';
        const response = await fetch(
          `${GITHUB_API_BASE}/repos/${toolInput.owner}/${toolInput.repo}/pulls?state=${state}&per_page=30`,
          { headers }
        );

        if (!response.ok) {
          return { error: 'Failed to get PRs' };
        }

        const prs = (await response.json()) as any[];
        return {
          pull_requests: prs.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            author: pr.user.login,
            created_at: pr.created_at,
            merged: pr.merged_at !== null,
          })),
        };
      }

      case 'search_github_code': {
        const response = await fetch(
          `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(toolInput.query)}&per_page=20`,
          { headers }
        );

        if (!response.ok) {
          return { error: 'Failed to search code' };
        }

        const data = (await response.json()) as any;
        return {
          results: data.items.map((i: any) => ({
            name: i.name,
            path: i.path,
            repo: i.repository.full_name,
            url: i.html_url,
          })),
        };
      }

      case 'get_github_notifications': {
        const all = toolInput.all ? 'true' : 'false';
        const response = await fetch(`${GITHUB_API_BASE}/notifications?all=${all}&per_page=30`, {
          headers,
        });

        if (!response.ok) {
          return { error: 'Failed to get notifications' };
        }

        const notifications = (await response.json()) as any[];
        return {
          notifications: notifications.map((n) => ({
            id: n.id,
            reason: n.reason,
            unread: n.unread,
            title: n.subject.title,
            type: n.subject.type,
            repo: n.repository.full_name,
            updated_at: n.updated_at,
          })),
        };
      }

      default:
        return { error: `Unknown GitHub tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[GitHub] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const githubIntegration: Integration = {
  name: 'github',
  category: 'productivity',
  tools: githubTools,
  execute: executeGitHubTool,
  isAvailable: async (context) => !!context.accessTokens?.github,
};
