/**
 * Documentation Integration
 *
 * Provides access to Wovly documentation to answer user questions
 * about features, integrations, and usage.
 *
 * Features:
 * - Fetch documentation by topic
 * - Search documentation index
 * - Topic mapping for common queries
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentationToolInput {
  topic: string;
}

interface DocumentationResponse {
  found: boolean;
  topic?: string;
  url?: string;
  content?: string;
  message?: string;
  index?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic Mapping
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_MAP: Record<string, string> = {
  skill: 'skills',
  task: 'tasks',
  integration: 'overview',
  google: 'google-workspace',
  gmail: 'google-workspace',
  calendar: 'google-workspace',
  slack: 'slack',
  imessage: 'imessage',
  text: 'imessage',
  sms: 'imessage',
  whatsapp: 'whatsapp',
  browser: 'browser-automation',
  credential: 'credentials',
  login: 'credentials',
  memory: 'memory',
  profile: 'memory',
  setting: 'settings',
  security: 'security',
  privacy: 'security',
  faq: 'faq',
  help: 'faq',
  troubleshoot: 'troubleshooting',
  error: 'troubleshooting',
  install: 'installation',
  setup: 'quickstart',
  start: 'quickstart',
  voice: 'voice-mimic',
  mimic: 'voice-mimic',
  style: 'voice-mimic',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const documentationTools: Tool[] = [
  {
    name: 'fetch_documentation',
    description:
      "Fetch Wovly documentation to answer user questions about how to use features. Use when user asks detailed questions about skills, tasks, integrations, settings, troubleshooting, or how to do something specific in Wovly. Examples: 'how do I create a custom skill?', 'explain how tasks work', 'how do I connect Slack?'",
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            'The topic to look up. Common topics: skills, tasks, integrations, chat, memory, settings, installation, troubleshooting, google-workspace, slack, imessage, whatsapp, browser-automation, credentials, security, faq',
        },
      },
      required: ['topic'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeDocumentationTool(
  toolName: string,
  toolInput: DocumentationToolInput,
  context: IntegrationContext
): Promise<DocumentationResponse> {
  console.log(`[Documentation] Executing ${toolName} with topic: ${toolInput.topic}`);

  if (toolName !== 'fetch_documentation') {
    return { found: false, error: `Unknown documentation tool: ${toolName}` };
  }

  try {
    const { topic } = toolInput;

    // Fetch the llms.txt index to find the right page
    const indexRes = await fetch('https://wovly.mintlify.app/llms.txt');
    if (!indexRes.ok) {
      return { found: false, error: 'Could not fetch documentation index' };
    }
    const index = await indexRes.text();

    // Normalize topic for matching
    const topicLower = topic.toLowerCase().trim();
    const lines = index.split('\n');

    // Find matching doc URLs based on topic
    const matches: string[] = [];
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      // Check if the line contains the topic and has a URL
      if (lineLower.includes(topicLower) && line.includes('https://')) {
        const urlMatch = line.match(/https:\/\/[^\s\)]+/);
        if (urlMatch) {
          matches.push(urlMatch[0]);
        }
      }
    }

    // If no direct match, try partial matches using topic map
    if (matches.length === 0) {
      for (const [key, value] of Object.entries(TOPIC_MAP)) {
        if (topicLower.includes(key)) {
          // Find the URL containing this value
          for (const line of lines) {
            if (line.toLowerCase().includes(value) && line.includes('https://')) {
              const urlMatch = line.match(/https:\/\/[^\s\)]+/);
              if (urlMatch) {
                matches.push(urlMatch[0]);
                break;
              }
            }
          }
          break;
        }
      }
    }

    if (matches.length === 0) {
      // Return the full index so the LLM can help the user
      return {
        found: false,
        message: `No specific documentation found for "${topic}". Available topics in the documentation:`,
        index,
      };
    }

    // Fetch the first matching doc page
    const docUrl = matches[0];
    const docRes = await fetch(docUrl);
    if (!docRes.ok) {
      return { found: false, error: `Could not fetch documentation page: ${docUrl}` };
    }
    const docContent = await docRes.text();

    return {
      found: true,
      topic,
      url: docUrl,
      content: docContent,
    };
  } catch (err: any) {
    console.error('[Documentation] Fetch error:', err.message);
    return { found: false, error: `Failed to fetch documentation: ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const documentationIntegration: Integration = {
  name: 'documentation',
  category: 'core',
  tools: documentationTools,
  execute: executeDocumentationTool,
  // Documentation is always available
  isAvailable: async () => true,
};
