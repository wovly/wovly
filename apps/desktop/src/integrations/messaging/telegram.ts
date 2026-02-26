/**
 * Telegram Integration
 *
 * Provides tools for interacting with Telegram via bot API:
 * - Send messages to chats/users
 * - Get recent updates/messages
 * - Get chat information
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Telegram API Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get Telegram bot token from user settings
 */
function getTelegramToken(context: IntegrationContext): string | null {
  return (context.settings as any)?.telegramBotToken || null;
}

/**
 * Send a message via Telegram bot
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
): Promise<any> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  const response = await fetch(`${baseUrl}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
  const data: any = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Failed to send message');
  }
  return data;
}

/**
 * Get recent updates from Telegram bot
 */
async function getTelegramUpdates(botToken: string, limit: number = 20): Promise<any> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  const actualLimit = Math.min(limit, 100);
  const response = await fetch(`${baseUrl}/getUpdates?limit=${actualLimit}`);
  const data: any = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Failed to get updates');
  }
  return data;
}

/**
 * Get information about a Telegram chat
 */
async function getTelegramChatInfo(botToken: string, chatId: string): Promise<any> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  const response = await fetch(`${baseUrl}/getChat?chat_id=${encodeURIComponent(chatId)}`);
  const data: any = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Failed to get chat info');
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const telegramTools: Tool[] = [
  {
    name: 'send_telegram_message',
    description: 'Send a message via Telegram bot. Always confirm with user before sending.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or username (e.g., @username or numeric chat ID)',
        },
        message: {
          type: 'string',
          description: 'Message text to send',
        },
      },
      required: ['chat_id', 'message'],
    },
  },
  {
    name: 'get_telegram_updates',
    description: 'Get recent messages received by the Telegram bot.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of updates to fetch (default 20, max 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_telegram_chat_info',
    description: 'Get information about a Telegram chat or user.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or username',
        },
      },
      required: ['chat_id'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeTelegramTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const botToken = getTelegramToken(context);

  if (!botToken) {
    return {
      error: 'Telegram not connected. Please set up Telegram in the Integrations page.',
    };
  }

  try {
    switch (toolName) {
      case 'send_telegram_message': {
        const result = await sendTelegramMessage(botToken, toolInput.chat_id, toolInput.message);
        return {
          success: true,
          message: `Message sent to ${toolInput.chat_id}`,
          message_id: result.result.message_id,
          chat_id: toolInput.chat_id,
        };
      }

      case 'get_telegram_updates': {
        const limit = toolInput.limit || 20;
        const data = await getTelegramUpdates(botToken, limit);
        return {
          updates: data.result
            .map((u: any) => ({
              update_id: u.update_id,
              message: u.message
                ? {
                    message_id: u.message.message_id,
                    from: u.message.from?.first_name || u.message.from?.username,
                    chat_id: u.message.chat.id,
                    chat_type: u.message.chat.type,
                    text: u.message.text,
                    date: new Date(u.message.date * 1000).toISOString(),
                  }
                : null,
            }))
            .filter((u: any) => u.message),
        };
      }

      case 'get_telegram_chat_info': {
        const data = await getTelegramChatInfo(botToken, toolInput.chat_id);
        return {
          chat: {
            id: data.result.id,
            type: data.result.type,
            title: data.result.title,
            username: data.result.username,
            first_name: data.result.first_name,
            last_name: data.result.last_name,
            description: data.result.description,
          },
        };
      }

      default:
        return { error: `Unknown Telegram tool: ${toolName}` };
    }
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const telegramIntegration: Integration = {
  name: 'telegram',
  category: 'messaging',
  tools: telegramTools,
  execute: executeTelegramTool,
  isAvailable: async (context) => !!getTelegramToken(context),
};
