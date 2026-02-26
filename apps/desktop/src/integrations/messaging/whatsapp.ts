/**
 * WhatsApp Integration
 *
 * Provides tools for interacting with WhatsApp via Baileys:
 * - Send messages to contacts
 * - Check connection status
 * - Sync messages to self-chat
 *
 * Note: Requires WhatsApp connector from main process for socket access
 */

import { Integration, Tool, IntegrationContext } from '../base';
import { WhatsAppService, WhatsAppConnector } from '../../services/whatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const whatsappTools: Tool[] = [
  {
    name: 'send_whatsapp_message',
    description:
      "Send a message via WhatsApp. Recipient can be a phone number (e.g., '1234567890') or JID (e.g., '1234567890@s.whatsapp.net'). Always confirm with user before sending.",
    input_schema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Phone number or WhatsApp JID of the recipient',
        },
        message: {
          type: 'string',
          description: 'Message text to send',
        },
      },
      required: ['recipient', 'message'],
    },
  },
  {
    name: 'get_whatsapp_status',
    description:
      'Get current WhatsApp connection status. Returns connection state and QR code if available for setup.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'sync_to_whatsapp_self_chat',
    description:
      'Sync a message to WhatsApp self-chat for conversation continuity. Used internally to keep chat history in sync.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message text to sync',
        },
        is_from_user: {
          type: 'boolean',
          description: 'Whether the message is from the user (true) or AI (false)',
          default: false,
        },
      },
      required: ['message'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeWhatsAppTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  // Get WhatsApp connector from context
  // The connector is injected from main.js and provides access to the socket
  const connector = context.whatsappConnector as WhatsAppConnector | undefined;

  if (!connector) {
    return {
      error: 'WhatsApp connector not available. Please ensure WhatsApp is properly initialized.',
    };
  }

  try {
    switch (toolName) {
      case 'send_whatsapp_message': {
        const { recipient, message } = toolInput;

        if (!recipient || !message) {
          return { error: 'Missing required parameters: recipient and message' };
        }

        const result = await WhatsAppService.sendMessage(connector, recipient, message);

        if (!result.ok) {
          return { error: result.error || 'Failed to send WhatsApp message' };
        }

        return {
          success: true,
          message: `Message sent to ${recipient} via WhatsApp`,
          recipient,
        };
      }

      case 'get_whatsapp_status': {
        const result = await WhatsAppService.getStatus(connector);

        if (!result.ok) {
          return { error: result.error || 'Failed to get WhatsApp status' };
        }

        return {
          status: result.status,
          qr: result.qr,
          connected: result.status === 'connected',
          needs_setup: result.status === 'qr_ready' || result.status === 'disconnected',
        };
      }

      case 'sync_to_whatsapp_self_chat': {
        const { message, is_from_user = false } = toolInput;

        if (!message) {
          return { error: 'Missing required parameter: message' };
        }

        // Check if sync is ready first
        const readyCheck = await WhatsAppService.isSyncReady(connector);

        if (!readyCheck.ok || !readyCheck.ready) {
          return {
            error:
              "WhatsApp self-chat sync not ready. Ensure WhatsApp is connected and you've sent a message from the WhatsApp app first.",
          };
        }

        const result = await WhatsAppService.syncToSelfChat(connector, message, is_from_user);

        if (!result.ok) {
          return { error: result.error || 'Failed to sync to WhatsApp self-chat' };
        }

        return {
          success: true,
          message: 'Message synced to WhatsApp self-chat',
          synced: true,
        };
      }

      default:
        return { error: `Unknown WhatsApp tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[WhatsApp] Error executing ${toolName}:`, err.message);
    return { error: err.message || 'Unknown error occurred' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappIntegration: Integration = {
  name: 'whatsapp',
  category: 'messaging',
  tools: whatsappTools,
  execute: executeWhatsAppTool,
  isAvailable: async (context) => {
    // WhatsApp is available if:
    // 1. Connector is provided in context
    // 2. WhatsApp is connected
    const connector = context.whatsappConnector as WhatsAppConnector | undefined;

    if (!connector) {
      return false;
    }

    try {
      const status = connector.getStatus();
      return status === 'connected';
    } catch {
      return false;
    }
  },
};
