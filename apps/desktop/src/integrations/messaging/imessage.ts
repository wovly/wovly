/**
 * iMessage Integration
 *
 * Provides tools for interacting with iMessage/SMS:
 * - Get recent messages
 * - Search messages
 * - Look up contacts
 * - Send messages
 *
 * Note: This integration is macOS-only and requires:
 * - Full Disk Access for reading Messages database
 * - Automation permission for Contacts access
 */

import { Integration, Tool, IntegrationContext } from '../base';
import { exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import {
  lookupContactNames,
  findContactsByName,
  findPhoneByName,
  Contact,
} from './imessage-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Message {
  text: string;
  from: string;
  phone: string | null;
  date: string;
  direction: 'sent' | 'received';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const iMessageTools: Tool[] = [
  {
    name: 'get_recent_messages',
    description:
      'Get recent text messages (iMessage/SMS) with sender names resolved from contacts. Use this when the user asks about their texts or messages they received.',
    input_schema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Hours back to look (default 24)' },
        contact: {
          type: 'string',
          description: "Filter by contact name or phone number (e.g., 'Adaira' or '+1234567890')",
        },
        limit: { type: 'number', description: 'Max messages (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'search_messages',
    description:
      'Search through text messages with sender names resolved. Use to find specific messages or conversations.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term to find in message content' },
        contact: { type: 'string', description: 'Filter by contact name or phone number' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_contact',
    description:
      "Look up a contact's phone number from Apple Contacts by name. Returns the contact's name and phone numbers. Use this FIRST when you need to text someone by name to get their phone number.",
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Contact name to search for (first name, last name, or full name)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'send_imessage',
    description:
      'Send a text message via iMessage or SMS. The recipient can be a contact name (will auto-lookup phone number) or a phone number directly. Always confirm with user first before sending.',
    input_schema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description:
            "Contact name (e.g., 'Adaira', 'John Smith') or phone number (e.g., '+15551234567')",
        },
        message: { type: 'string', description: 'The message content to send' },
      },
      required: ['recipient', 'message'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Execute Function
// ─────────────────────────────────────────────────────────────────────────────

async function executeIMessageTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

  // Import getIMessageChatId from src (for capturing chat_id after sending)
  let getIMessageChatId: ((recipient: string) => Promise<number | null>) | undefined;
  try {
    const srcModule = require('../../index');
    getIMessageChatId = srcModule.getIMessageChatId;
  } catch (error) {
    console.warn('[iMessage] Could not load getIMessageChatId from src');
  }

  try {
    switch (toolName) {
      case 'get_recent_messages': {
        const hours = toolInput.hours || 24;
        const contactFilter = toolInput.contact || null;
        const limit = toolInput.limit || 50;

        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - hours);
        const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime();
        const cutoffTimestamp = (cutoffDate.getTime() - appleEpoch) * 1000000;

        let whereClause = `m.date > ${cutoffTimestamp}`;

        // If contact filter provided, try to resolve it to phone numbers
        let contactPhones: string[] = [];
        if (contactFilter) {
          // Check if it's a name (contains letters) or a phone number
          if (/[a-zA-Z]/.test(contactFilter)) {
            contactPhones = await findPhoneByName(contactFilter);
          }

          if (contactPhones.length > 0) {
            // Match any of the found phone numbers
            const phoneConditions = contactPhones
              .map((phone) => {
                const digits = phone.replace(/\D/g, '');
                return `h.id LIKE '%${digits.slice(-10)}%'`;
              })
              .join(' OR ');
            whereClause += ` AND (${phoneConditions})`;
          } else {
            // Fall back to direct matching
            const cleanContact = contactFilter.replace(/'/g, "''").replace(/\D/g, '');
            whereClause += ` AND (h.id LIKE '%${cleanContact}%' OR h.id LIKE '%${contactFilter.replace(/'/g, "''")}%')`;
          }
        }

        const query = `SELECT m.text, m.is_from_me, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date, h.id as contact FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE ${whereClause} ORDER BY m.date DESC LIMIT ${limit};`;

        return new Promise((resolve) => {
          exec(
            `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024 },
            async (error, stdout) => {
              if (error) {
                resolve({ error: `Query failed: ${error.message}` });
                return;
              }
              try {
                const rows = stdout.trim() ? JSON.parse(stdout) : [];

                // Get unique contact identifiers and resolve names
                const contactIds = rows
                  .filter((r: any) => !r.is_from_me && r.contact)
                  .map((r: any) => r.contact);
                const contactNames = await lookupContactNames(contactIds);

                const messages: Message[] = rows.map((row: any) => {
                  const contactName = row.contact ? contactNames.get(row.contact) : null;
                  return {
                    text: row.text || '(attachment)',
                    from: row.is_from_me ? 'Me' : contactName || row.contact || 'Unknown',
                    phone: row.is_from_me ? null : row.contact,
                    date: row.date,
                    direction: row.is_from_me ? 'sent' : 'received',
                  };
                });
                resolve({ messages, count: messages.length });
              } catch (e: any) {
                resolve({ error: 'Failed to parse results: ' + e.message });
              }
            }
          );
        });
      }

      case 'search_messages': {
        const searchQuery = toolInput.query.replace(/'/g, "''");
        const contactFilter = toolInput.contact || null;
        const limit = toolInput.limit || 20;

        let whereClause = `m.text LIKE '%${searchQuery}%'`;

        // Handle contact filter
        if (contactFilter) {
          let contactPhones: string[] = [];
          if (/[a-zA-Z]/.test(contactFilter)) {
            contactPhones = await findPhoneByName(contactFilter);
          }

          if (contactPhones.length > 0) {
            const phoneConditions = contactPhones
              .map((phone) => {
                const digits = phone.replace(/\D/g, '');
                return `h.id LIKE '%${digits.slice(-10)}%'`;
              })
              .join(' OR ');
            whereClause += ` AND (${phoneConditions})`;
          } else {
            const cleanContact = contactFilter.replace(/'/g, "''").replace(/\D/g, '');
            whereClause += ` AND (h.id LIKE '%${cleanContact}%')`;
          }
        }

        const query = `SELECT m.text, m.is_from_me, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date, h.id as contact FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE ${whereClause} ORDER BY m.date DESC LIMIT ${limit};`;

        return new Promise((resolve) => {
          exec(
            `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024 },
            async (error, stdout) => {
              if (error) {
                resolve({ error: `Search failed: ${error.message}` });
                return;
              }
              try {
                const rows = stdout.trim() ? JSON.parse(stdout) : [];

                // Resolve contact names
                const contactIds = rows
                  .filter((r: any) => !r.is_from_me && r.contact)
                  .map((r: any) => r.contact);
                const contactNames = await lookupContactNames(contactIds);

                const messages: Message[] = rows.map((row: any) => {
                  const contactName = row.contact ? contactNames.get(row.contact) : null;
                  return {
                    text: row.text,
                    from: row.is_from_me ? 'Me' : contactName || row.contact || 'Unknown',
                    phone: row.is_from_me ? null : row.contact,
                    date: row.date,
                    direction: row.is_from_me ? 'sent' : 'received',
                  };
                });
                resolve({ messages, count: messages.length, searchQuery: toolInput.query });
              } catch (e: any) {
                resolve({ error: 'Failed to parse results: ' + e.message });
              }
            }
          );
        });
      }

      case 'lookup_contact': {
        const { name } = toolInput;
        console.log(`[iMessage] lookup_contact called for: ${name}`);

        const contacts = await findContactsByName(name);

        if (contacts.length === 0) {
          return {
            found: false,
            message: `No contacts found matching "${name}"`,
            suggestion: 'Try a different spelling or partial name',
          };
        }

        return {
          found: true,
          searchedFor: name,
          contacts: contacts.map((c) => ({
            name: c.name,
            phones: c.phones,
          })),
          hint: 'Use the phone number to send a message with send_imessage',
        };
      }

      case 'send_imessage': {
        let { recipient, message } = toolInput;
        const originalRecipient = recipient;

        console.log(
          `[iMessage] send_imessage called - recipient: ${recipient}, message: ${message}`
        );

        // If recipient looks like a name (has letters and no @ or +), try to find their phone number
        if (/[a-zA-Z]/.test(recipient) && !/[@+]/.test(recipient)) {
          console.log(`[iMessage] Recipient looks like a name, looking up contact...`);
          const contacts = await findContactsByName(recipient);

          if (contacts.length > 0 && contacts[0].phones.length > 0) {
            // Use the first phone number found (prefer mobile)
            const mobilePhone = contacts[0].phones.find(
              (p) =>
                p.label.toLowerCase().includes('mobile') ||
                p.label.toLowerCase().includes('iphone') ||
                p.label.toLowerCase().includes('cell')
            );
            recipient = mobilePhone ? mobilePhone.number : contacts[0].phones[0].number;
            console.log(
              `[iMessage] Resolved "${originalRecipient}" to ${recipient} (${contacts[0].name})`
            );
          } else {
            console.log(`[iMessage] Could not find phone number for "${recipient}"`);
            return {
              error: `Could not find a phone number for "${recipient}". Please use lookup_contact first to find their number.`,
              suggestion: 'Try using lookup_contact to find the correct contact and phone number',
            };
          }
        }

        // Clean up phone number - remove spaces, dashes, parentheses
        if (/^\+?\d/.test(recipient)) {
          recipient = recipient.replace(/[\s()-]/g, '');
        }

        return new Promise((resolve) => {
          const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const escapedRecipient = recipient.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

          // Try multiple approaches for sending
          const appleScript = `
            tell application "Messages"
              -- Try to find existing conversation first
              set targetBuddy to null
              try
                set targetService to 1st service whose service type = iMessage
                set targetBuddy to buddy "${escapedRecipient}" of targetService
              on error
                -- Try SMS service if iMessage fails
                try
                  set targetService to 1st service whose service type = SMS
                  set targetBuddy to buddy "${escapedRecipient}" of targetService
                end try
              end try
              
              if targetBuddy is not null then
                send "${escapedMessage}" to targetBuddy
                return "sent"
              else
                return "no buddy found"
              end if
            end tell
          `;

          exec(
            `osascript -e '${appleScript.replace(/'/g, "'\\''")}'`,
            { timeout: 15000 },
            async (error, stdout) => {
              if (error) {
                console.error(`[iMessage] Send failed: ${error.message}`);
                resolve({ error: `Failed to send message: ${error.message}` });
              } else if (stdout.trim() === 'no buddy found') {
                resolve({
                  error: `Could not find a conversation with "${recipient}". They may not be in your Messages contacts.`,
                });
              } else {
                console.log(`[iMessage] Message sent successfully to ${recipient}`);

                // Capture the chat_id for this conversation so we can track replies in THIS thread only
                let chatId: number | null = null;
                if (getIMessageChatId) {
                  chatId = await getIMessageChatId(recipient);
                  if (chatId) {
                    console.log(
                      `[iMessage] Captured chat_id ${chatId} for conversation with ${recipient}`
                    );
                  }
                }

                resolve({
                  success: true,
                  message: `Message sent to ${originalRecipient}${originalRecipient !== recipient ? ` (${recipient})` : ''}`,
                  sentTo: recipient,
                  chatId: chatId, // Include chat_id for thread-specific reply tracking
                });
              }
            }
          );
        });
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const iMessageIntegration: Integration = {
  name: 'imessage',
  category: 'messaging',
  tools: iMessageTools,
  execute: executeIMessageTool,
  isAvailable: (context: IntegrationContext) => {
    // iMessage is macOS-only
    if (process.platform !== 'darwin') {
      return false;
    }

    // Check if enabled in settings (default: true on macOS)
    const iMessageEnabled = context.settings?.integrations?.imessage?.enabled ?? true;
    return iMessageEnabled;
  },
};

export default iMessageIntegration;
