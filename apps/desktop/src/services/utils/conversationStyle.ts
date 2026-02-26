/**
 * Conversation Style Utilities
 * Retrieves user's previous messages and analyzes communication style
 */

import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { exec } from 'child_process';

export interface ConversationStyleOptions {
  limit?: number;
  accessToken?: string;
  slackUserId?: string;
}

export interface ConversationStyleResult {
  messages: string[];
  hasHistory: boolean;
  recipient: string;
  platform?: string;
}

export interface StyleGuideResult {
  styleGuide: string | null;
  formality: 'casual' | 'professional' | 'mixed';
}

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

/**
 * Get the user's previously sent messages to a specific recipient
 * Used to analyze communication style and mimic the user's voice when drafting
 */
export async function getConversationStyleContext(
  recipient: string,
  platform: 'email' | 'slack' | 'imessage',
  options: ConversationStyleOptions = {}
): Promise<ConversationStyleResult> {
  const { limit = 10, accessToken, slackUserId } = options;
  const messages: string[] = [];

  console.log(`[StyleContext] Retrieving sent messages to ${recipient} via ${platform}`);

  try {
    switch (platform) {
      case 'email': {
        if (!accessToken) {
          console.log('[StyleContext] No Google access token, skipping email history');
          return { messages: [], hasHistory: false, recipient };
        }

        // Search for emails sent TO this recipient
        const query = `to:${recipient} in:sent`;
        const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
        url.searchParams.set('q', query);
        url.searchParams.set('maxResults', String(limit));

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          console.error(`[StyleContext] Gmail API error: ${response.status}`);
          return { messages: [], hasHistory: false, recipient };
        }

        const data = (await response.json()) as any;
        const messageIds = data.messages || [];

        // Fetch message bodies
        for (const msg of messageIds.slice(0, limit)) {
          try {
            const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
            const msgResponse = await fetch(msgUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (msgResponse.ok) {
              const msgData = (await msgResponse.json()) as any;
              // Extract body from payload
              let body = '';
              const payload = msgData.payload;

              if (payload.body?.data) {
                body = Buffer.from(payload.body.data, 'base64').toString('utf8');
              } else if (payload.parts) {
                // Look for text/plain part
                const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
                if (textPart?.body?.data) {
                  body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
                }
              }

              if (body && body.trim()) {
                // Clean up the body - remove quoted replies, signatures
                const cleanBody = body.split(/\n>|\nOn .* wrote:|\n--\s*\n/)[0].trim();
                if (cleanBody.length > 20) {
                  // Only include substantial messages
                  messages.push(cleanBody.substring(0, 1000)); // Limit length
                }
              }
            }
          } catch (msgErr: any) {
            console.error(`[StyleContext] Error fetching email ${msg.id}:`, msgErr.message);
          }
        }
        break;
      }

      case 'slack': {
        if (!accessToken) {
          console.log('[StyleContext] No Slack access token, skipping Slack history');
          return { messages: [], hasHistory: false, recipient };
        }

        // First, resolve the recipient to a channel ID
        let channelId = recipient;

        // If it's a user ID (starts with U), open DM channel
        if (/^U[A-Z0-9]+$/i.test(recipient)) {
          const dmResponse = await fetch('https://slack.com/api/conversations.open', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ users: recipient }),
          });
          const dmData = (await dmResponse.json()) as any;
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
          }
        }
        // If it doesn't look like a channel ID, search for user by name
        else if (!/^[CDG][A-Z0-9]+$/i.test(recipient)) {
          const usersResponse = await fetch(`https://slack.com/api/users.list?limit=200`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const usersData = (await usersResponse.json()) as any;

          if (usersData.ok && usersData.members) {
            const user = usersData.members.find(
              (m: any) =>
                m.name?.toLowerCase().includes(recipient.toLowerCase()) ||
                m.real_name?.toLowerCase().includes(recipient.toLowerCase())
            );

            if (user) {
              const dmResponse = await fetch('https://slack.com/api/conversations.open', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ users: user.id }),
              });
              const dmData = (await dmResponse.json()) as any;
              if (dmData.ok && dmData.channel) {
                channelId = dmData.channel.id;
              }
            }
          }
        }

        // Fetch conversation history
        const historyResponse = await fetch(
          `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit * 3}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const historyData = (await historyResponse.json()) as any;

        if (historyData.ok && historyData.messages) {
          // Filter for messages FROM the current user (sent by user)
          const currentUserId = slackUserId;

          for (const msg of historyData.messages) {
            // Only include messages from the current user (sent messages)
            if (msg.user === currentUserId && msg.text && !msg.subtype) {
              const cleanText = msg.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // Remove mentions
              if (cleanText.length > 10) {
                messages.push(cleanText.substring(0, 500));
                if (messages.length >= limit) break;
              }
            }
          }
        }
        break;
      }

      case 'imessage': {
        const dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

        try {
          await fs.access(dbPath);
        } catch {
          console.log('[StyleContext] Cannot access Messages database');
          return { messages: [], hasHistory: false, recipient };
        }

        // Resolve contact name to phone if it contains letters
        let phoneFilter = recipient;
        if (/[a-zA-Z]/.test(recipient) && !/@/.test(recipient)) {
          // This is a name - we'll match against handle.id loosely
          phoneFilter = recipient.replace(/'/g, "''");
        }

        const digits = phoneFilter.replace(/\D/g, '');
        const lastDigits = digits.slice(-10);

        // Query for messages FROM ME to this contact (is_from_me = 1)
        const query = lastDigits
          ? `SELECT m.text, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date FROM message m JOIN handle h ON m.handle_id = h.ROWID WHERE h.id LIKE '%${lastDigits}%' AND m.is_from_me = 1 AND m.text IS NOT NULL AND m.text != '' ORDER BY m.date DESC LIMIT ${limit}`
          : `SELECT m.text, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date FROM message m JOIN handle h ON m.handle_id = h.ROWID WHERE (h.id LIKE '%${phoneFilter}%') AND m.is_from_me = 1 AND m.text IS NOT NULL AND m.text != '' ORDER BY m.date DESC LIMIT ${limit}`;

        const result: any[] = await new Promise((resolve) => {
          exec(
            `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`,
            { maxBuffer: 5 * 1024 * 1024 },
            (error, stdout) => {
              if (error) {
                console.error(`[StyleContext] iMessage query error: ${error.message}`);
                resolve([]);
                return;
              }
              try {
                const rows = stdout.trim() ? JSON.parse(stdout) : [];
                resolve(rows.map((r: any) => r.text).filter((t: string) => t && t.length > 10));
              } catch {
                resolve([]);
              }
            }
          );
        });

        messages.push(...result.slice(0, limit));
        break;
      }
    }

    console.log(
      `[StyleContext] Found ${messages.length} sent messages to ${recipient} via ${platform}`
    );
    return {
      messages,
      hasHistory: messages.length > 0,
      recipient,
      platform,
    };
  } catch (err: any) {
    console.error(`[StyleContext] Error retrieving messages: ${err.message}`);
    return { messages: [], hasHistory: false, recipient };
  }
}

/**
 * Generate a style guide by analyzing the user's previous messages
 * Uses a fast LLM call to summarize communication patterns
 */
export async function generateStyleGuide(
  messages: string[],
  recipient: string,
  apiKeys: ApiKeys,
  activeProvider?: string
): Promise<StyleGuideResult> {
  if (!messages || messages.length === 0) {
    return { styleGuide: null, formality: 'professional' };
  }

  console.log(`[StyleGuide] Analyzing ${messages.length} messages to generate style guide`);

  // Prepare sample messages for analysis (limit to avoid token overflow)
  const sampleMessages = messages
    .slice(0, 7)
    .map((m, i) => `Message ${i + 1}: "${m.substring(0, 300)}${m.length > 300 ? '...' : ''}"`)
    .join('\n\n');

  const analysisPrompt = `Analyze these messages I've sent to "${recipient}" and describe my communication style in 2-3 concise sentences. Focus on:
- Tone (casual, formal, friendly, direct, professional)
- Greeting and sign-off patterns (if any)
- Writing style (short/long sentences, emojis, exclamation points, bullet points)
- Any notable patterns or phrases I use

Messages:
${sampleMessages}

Respond with ONLY a brief style description (2-3 sentences max) that I can use as a guide for writing similar messages. Also indicate the formality level at the end as one word: casual, professional, or mixed.

Example format:
"Uses friendly, casual tone with short sentences. Often starts with 'Hey' and uses emojis. Tends to be direct and action-oriented. Formality: casual"`;

  try {
    let styleGuide = '';
    let formality: 'casual' | 'professional' | 'mixed' = 'professional';

    // Use a fast model for style analysis
    if (apiKeys.anthropic) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307', // Fast model for analysis
          max_tokens: 200,
          messages: [{ role: 'user', content: analysisPrompt }],
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as any;
        styleGuide = result.content?.[0]?.text || '';
      }
    } else if (apiKeys.openai) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKeys.openai}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Fast model for analysis
          max_tokens: 200,
          messages: [{ role: 'user', content: analysisPrompt }],
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as any;
        styleGuide = result.choices?.[0]?.message?.content || '';
      }
    } else if (apiKeys.google) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeys.google}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: analysisPrompt }] }],
            generationConfig: { maxOutputTokens: 200 },
          }),
        }
      );

      if (response.ok) {
        const result = (await response.json()) as any;
        styleGuide = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    // Extract formality from the response
    const formalityMatch = styleGuide
      .toLowerCase()
      .match(/formality:\s*(casual|professional|mixed)/);
    if (formalityMatch) {
      formality = formalityMatch[1] as 'casual' | 'professional' | 'mixed';
    }

    console.log(`[StyleGuide] Generated style guide (formality: ${formality})`);
    return { styleGuide: styleGuide.trim(), formality };
  } catch (err: any) {
    console.error(`[StyleGuide] Error generating style guide: ${err.message}`);
    return { styleGuide: null, formality: 'professional' };
  }
}
