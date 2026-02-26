/**
 * Insights Processor
 * Two-stage LLM pipeline for analyzing messages and generating insights
 */

import fs from 'fs/promises';
import { saveFactToDaily } from '../storage/memory';
import { loadRecentHistory } from '../storage/insights';
import { getUserProfilePath } from '../storage/profile';
import { SettingsService } from '../services/settings';

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
}

export interface AccessTokens {
  google?: string;
  slack?: string;
}

export interface Message {
  platform: string;
  from: string;
  subject: string;
  body: string;
  timestamp: string;
  snippet: string;
}

export interface ExtractedFact {
  content: string;
  timestamp: string;
  platform?: string;
}

export type ContactMappings = Record<string, string>;

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: string };
}

/**
 * Helper: Extract contact mappings from user profile
 * Looks for patterns like "Igor: +16034383242" or "email: igor@example.com"
 */
function extractContactMappings(profileMarkdown: string): ContactMappings {
  const mappings: ContactMappings = {};

  if (!profileMarkdown) return mappings;

  // Blacklist of common profile fields that are NOT contacts
  const blacklist = new Set([
    'date of birth',
    'dob',
    'birthday',
    'birthdate',
    'age',
    'zip code',
    'postal code',
    'zipcode',
    'address',
    'street',
    'city',
    'state',
    'country',
    'occupation',
    'job',
    'title',
    'company',
    'anniversary',
    'license',
    'ssn',
    'id',
    'height',
    'weight',
    'blood type',
    'emergency contact',
    'ice',
  ]);

  // Common patterns for contact information
  const patterns = [
    // "Name: phone/email" format
    /[-*]\s*\*\*([A-Za-z\s]+)\*\*:\s*([+\d\-().\s]+|[\w.+-]+@[\w.-]+\.\w+)/g,
    // "phone/email: Name" format
    /[-*]\s*([+\d\-().\s]+|[\w.+-]+@[\w.-]+\.\w+):\s*\*\*([A-Za-z\s]+)\*\*/g,
    // Plain "Name - phone/email" format
    /[-*]\s*([A-Za-z\s]+)\s*[-:]\s*([+\d\-().\s]+|[\w.+-]+@[\w.-]+\.\w+)/g,
    // "Name (phone/email)" format
    /[-*]\s*([A-Za-z\s]+)\s*\(([+\d\-().\s]+|[\w.+-]+@[\w.-]+\.\w+)\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(profileMarkdown)) !== null) {
      const [, first, second] = match;

      // Determine which is the name and which is the contact
      const isFirstContact = /^[+\d]/.test(first.trim()) || first.includes('@');
      const name = isFirstContact ? second.trim() : first.trim();
      const contact = isFirstContact ? first.trim() : second.trim();

      // Skip if name is in blacklist
      if (blacklist.has(name.toLowerCase())) {
        continue;
      }

      // Skip if contact doesn't look like a phone or email
      // Phone: should have at least 7 digits
      // Email: should have @ symbol
      const digitCount = (contact.match(/\d/g) || []).length;
      const hasEmail = contact.includes('@');
      if (!hasEmail && digitCount < 7) {
        continue;
      }

      if (name && contact) {
        // Normalize phone numbers (remove spaces, dashes, parentheses)
        const normalizedContact = contact.replace(/[\s\-()]/g, '');
        mappings[normalizedContact] = name;

        // Also store original format
        if (normalizedContact !== contact) {
          mappings[contact] = name;
        }
      }
    }
  }

  return mappings;
}

/**
 * Helper: Resolve a contact (phone/email) to a name using profile mappings
 */
function resolveContact(contact: string, contactMappings: ContactMappings): string {
  if (!contact || !contactMappings) return contact;

  // Try exact match first
  if (contactMappings[contact]) {
    return contactMappings[contact];
  }

  // Try normalized version (remove spaces, dashes, parentheses, +1 prefix)
  const normalized = contact.replace(/[\s\-()]/g, '').replace(/^\+1/, '');

  for (const [key, name] of Object.entries(contactMappings)) {
    const normalizedKey = key.replace(/[\s\-()]/g, '').replace(/^\+1/, '');
    if (
      normalized === normalizedKey ||
      normalized.includes(normalizedKey) ||
      normalizedKey.includes(normalized)
    ) {
      return name;
    }
  }

  return contact;
}

/**
 * Helper: Strip markdown code blocks and extract JSON from response
 */
function stripMarkdownCodeBlocks(text: string): string {
  if (!text) return '{}';

  // Remove ```json and ``` markers
  let cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  // If the response starts with non-JSON text, try to extract JSON
  // Look for the first { and last } to extract just the JSON part
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return cleaned.trim();
}

/**
 * Helper: Call LLM API with JSON response support and retry logic
 */
async function callLLM(
  messages: any[],
  apiKeys: ApiKeys,
  options: LLMOptions = {}
): Promise<{ content: string }> {
  const { temperature = 0.5, maxTokens = 4000, responseFormat } = options;
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try Anthropic first if available
      if (apiKeys.anthropic) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKeys.anthropic,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: maxTokens,
              temperature,
              messages,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const data: any = await response.json();
            return { content: data.content?.[0]?.text || '' };
          } else {
            const errorText = await response.text();
            console.error(`[Insights] Anthropic API error (${response.status}):`, errorText);
          }
        } catch (anthropicErr: any) {
          const isTimeout =
            anthropicErr.name === 'AbortError' || anthropicErr.message?.includes('aborted');
          if (isTimeout) {
            console.error(
              `[Insights] Anthropic API call timed out (attempt ${attempt + 1}/${maxRetries}) - request took > 90s`
            );
          } else {
            console.error(
              `[Insights] Anthropic API call failed (attempt ${attempt + 1}/${maxRetries}):`,
              anthropicErr.message
            );
          }
          // If this is the last attempt and we have OpenAI, try that instead
          if (attempt === maxRetries - 1 && !apiKeys.openai) {
            throw anthropicErr;
          }
        }
      }

      // Fallback to OpenAI
      if (apiKeys.openai) {
        try {
          const body: any = {
            model: 'gpt-4o',
            max_tokens: maxTokens,
            temperature,
            messages,
          };

          if (responseFormat?.type === 'json_object') {
            body.response_format = { type: 'json_object' };
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKeys.openai}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const data: any = await response.json();
            return { content: data.choices?.[0]?.message?.content || '' };
          } else {
            const errorText = await response.text();
            console.error(`[Insights] OpenAI API error (${response.status}):`, errorText);
          }
        } catch (openaiErr: any) {
          const isTimeout =
            openaiErr.name === 'AbortError' || openaiErr.message?.includes('aborted');
          if (isTimeout) {
            console.error(
              `[Insights] OpenAI API call timed out (attempt ${attempt + 1}/${maxRetries}) - request took > 90s`
            );
          } else {
            console.error(
              `[Insights] OpenAI API call failed (attempt ${attempt + 1}/${maxRetries}):`,
              openaiErr.message
            );
          }
          if (attempt === maxRetries - 1) {
            throw openaiErr;
          }
        }
      }

      // If we got here and haven't returned, both APIs failed - retry with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[Insights] Retrying LLM call in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (err: any) {
      if (attempt === maxRetries - 1) {
        console.error('[Insights] All LLM API attempts failed:', err.message);
        throw err;
      }
    }
  }

  throw new Error('No LLM API keys available or all API calls failed');
}

/**
 * Collect Gmail messages since a timestamp
 */
async function collectGmailMessages(
  accessToken: string,
  sinceTimestamp: string,
  contactMappings: ContactMappings = {}
): Promise<Message[]> {
  const messages: Message[] = [];

  try {
    // Convert timestamp to Gmail query format (Unix timestamp in seconds)
    const afterDate = Math.floor(new Date(sinceTimestamp).getTime() / 1000);
    const query = `after:${afterDate}`;

    const url = new globalThis.URL('https://www.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '50'); // Limit to 50 most recent

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(`[Insights] Gmail API error: ${response.status}`);
      return messages;
    }

    const data: any = await response.json();
    const messageIds = data.messages || [];

    // Fetch full message details
    for (const msg of messageIds) {
      try {
        const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (msgResponse.ok) {
          const msgData: any = await msgResponse.json();

          // Extract headers
          const headers = msgData.payload.headers;
          const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
          const date = headers.find((h: any) => h.name === 'Date')?.value || '';

          // Extract body
          let body = '';
          const payload = msgData.payload;

          if (payload.body?.data) {
            body = Buffer.from(payload.body.data, 'base64').toString('utf8');
          } else if (payload.parts) {
            const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
            }
          }

          // Clean body - remove quoted replies
          const cleanBody = body.split(/\n>|\nOn .* wrote:|\n--\s*\n/)[0].trim();

          // Resolve contact to name if possible
          const resolvedFrom = resolveContact(from, contactMappings);

          messages.push({
            platform: 'Gmail',
            from: resolvedFrom,
            subject,
            body: cleanBody.substring(0, 1000),
            timestamp: date || sinceTimestamp,
            snippet: cleanBody.substring(0, 200),
          });
        }
      } catch (msgErr: any) {
        console.error(`[Insights] Error fetching Gmail message:`, msgErr.message);
      }
    }
  } catch (err) {
    console.error('[Insights] Error collecting Gmail messages:', err);
  }

  return messages;
}

/**
 * Collect Slack messages since a timestamp
 */
async function collectSlackMessages(
  accessToken: string,
  sinceTimestamp: string,
  contactMappings: ContactMappings = {}
): Promise<Message[]> {
  const messages: Message[] = [];

  try {
    const afterTime = Math.floor(new Date(sinceTimestamp).getTime() / 1000);

    // Get list of conversations (channels + DMs)
    const convoResponse = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel,mpim,im&limit=100',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!convoResponse.ok) {
      console.error(`[Insights] Slack API error: ${convoResponse.status}`);
      return messages;
    }

    const convoData: any = await convoResponse.json();
    if (!convoData.ok || !convoData.channels) {
      return messages;
    }

    // Fetch messages from each conversation
    for (const channel of convoData.channels.slice(0, 20)) {
      // Limit to 20 most recent conversations
      try {
        const historyUrl = `https://slack.com/api/conversations.history?channel=${channel.id}&oldest=${afterTime}&limit=20`;
        const historyResponse = await fetch(historyUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (historyResponse.ok) {
          const historyData: any = await historyResponse.json();

          if (historyData.ok && historyData.messages) {
            for (const msg of historyData.messages) {
              if (msg.text && !msg.bot_id) {
                // Skip bot messages
                // Resolve contact to name if possible
                const resolvedFrom = resolveContact(msg.user || 'Unknown', contactMappings);

                messages.push({
                  platform: 'Slack',
                  from: resolvedFrom,
                  subject: channel.name || 'Direct Message',
                  body: msg.text,
                  timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
                  snippet: msg.text.substring(0, 200),
                });
              }
            }
          }
        }
      } catch (channelErr: any) {
        console.error(`[Insights] Error fetching Slack channel:`, channelErr.message);
      }
    }
  } catch (err) {
    console.error('[Insights] Error collecting Slack messages:', err);
  }

  return messages;
}

/**
 * Collect iMessages since a timestamp (macOS only)
 */
async function collectIMessages(
  sinceTimestamp: string,
  contactMappings: ContactMappings = {}
): Promise<Message[]> {
  const messages: Message[] = [];

  try {
    const { execSync } = require('child_process');
    const afterDate = Math.floor(new Date(sinceTimestamp).getTime() / 1000000000) + 978307200; // macOS epoch offset

    // Query iMessage database
    const query = `
      SELECT
        h.id as contact,
        m.text,
        datetime(m.date + 978307200, 'unixepoch') as timestamp
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.date > ${afterDate}
        AND m.text IS NOT NULL
        AND m.is_from_me = 0
      ORDER BY m.date DESC
      LIMIT 50
    `;

    const dbPath = `${process.env.HOME}/Library/Messages/chat.db`;
    const result = execSync(`sqlite3 "${dbPath}" "${query.replace(/\n/g, ' ')}"`, {
      encoding: 'utf8',
      timeout: 5000,
    });

    const lines = result.trim().split('\n');
    for (const line of lines) {
      const [contact, text, timestamp] = line.split('|');
      if (text && text.trim()) {
        // Resolve contact to name if possible
        const resolvedFrom = resolveContact(contact || 'Unknown', contactMappings);

        messages.push({
          platform: 'iMessage',
          from: resolvedFrom,
          subject: 'iMessage',
          body: text,
          timestamp: timestamp || sinceTimestamp,
          snippet: text.substring(0, 200),
        });
      }
    }
  } catch (err: any) {
    // iMessage collection may fail on non-macOS or if permissions aren't granted
    console.log('[Insights] iMessage collection not available:', err.message);
  }

  return messages;
}

/**
 * Collect messages from custom web integrations
 * @param {string} username - The username
 * @param {string} sinceTimestamp - ISO timestamp to collect messages since
 * @param {Object} contactMappings - Contact to name mappings from user profile
 * @returns {Promise<Array>} Array of message objects
 */
async function collectWebScraperMessages(
  username: string,
  sinceTimestamp: string,
  contactMappings: ContactMappings = {}
): Promise<Message[]> {
  const messages: Message[] = [];
  const expiredOAuthSites: any[] = []; // Track OAuth sites needing re-login

  try {
    const { WebScraper, config: configManager, errors } = require('../../dist/webscraper');
    const { getBrowserController } = require('../../dist/browser');
    const webMessages = require('../../dist/storage/webmessages');

    // Get enabled integrations
    const sites = await configManager.getEnabledIntegrations(username);

    if (sites.length === 0) {
      console.log('[Insights] No custom web integrations configured');
      return messages;
    }

    console.log(`[Insights] Checking ${sites.length} custom web integration(s)`);

    const browserController = await getBrowserController(username);
    const scraper = new WebScraper(browserController, username);

    for (const siteConfig of sites) {
      try {
        console.log(`[Insights] Scraping ${siteConfig.name}...`);
        const result = await scraper.scrapeMessages(siteConfig);

        if (result.success) {
          // ✅ SAVE TO PERSISTENT STORAGE
          await webMessages.saveMessages(username, siteConfig.id, result.messages);

          // Update analyzed markdown
          const today = new Date().toISOString().split('T')[0];
          await webMessages.appendToAnalyzedMarkdown(
            username,
            today,
            siteConfig.id,
            siteConfig.name,
            result.messages
          );

          // Filter messages since timestamp
          const newMessages = result.messages.filter(
            (m: any) => new Date(m.timestamp) > new Date(sinceTimestamp)
          );

          // Resolve contacts
          const resolvedMessages = newMessages.map((m: any) => ({
            ...m,
            from: resolveContact(m.from, contactMappings),
          }));

          messages.push(...resolvedMessages);
          console.log(
            `[Insights] Collected ${newMessages.length} messages from ${siteConfig.name}`
          );

          // Update success status
          await configManager.updateStatus(username, siteConfig.id, {
            lastSuccess: new Date().toISOString(),
            consecutiveFailures: 0,
          });
        } else {
          console.error(`[Insights] Failed to scrape ${siteConfig.name}:`, result.error);

          // Check if this is an OAuth session expiry
          if (result.error === 'oauth_session_expired' || result.requiresManualLogin) {
            console.log(`[Insights] OAuth session expired for ${siteConfig.name}`);
            expiredOAuthSites.push({
              siteId: siteConfig.id,
              siteName: siteConfig.name,
              authMethod: siteConfig.authMethod,
            });
          }

          // 🔄 FALL BACK TO CACHED MESSAGES
          const cached = await webMessages.loadMessagesSince(
            username,
            siteConfig.id,
            sinceTimestamp,
            7
          );

          if (cached.length > 0) {
            console.log(
              `[Insights] Using ${cached.length} cached messages from ${siteConfig.name}`
            );

            // Mark messages as cached
            const cachedMessages = cached.map((m: any) => ({
              ...m,
              from: resolveContact(m.from, contactMappings),
              _cached: true,
              _cacheAge: Date.now() - new Date(m.scrapedAt || m.timestamp).getTime(),
            }));

            messages.push(...cachedMessages);
          }

          // Update error status
          const consecutiveFailures = (siteConfig.status?.consecutiveFailures || 0) + 1;
          // Don't auto-pause OAuth sites on session expiry - notify user instead
          const shouldPause = result.requiresManualLogin
            ? false
            : errors.shouldAutoPause(result.errorType, consecutiveFailures);

          await configManager.updateStatus(username, siteConfig.id, {
            lastError: result.error,
            consecutiveFailures,
            paused: shouldPause,
          });

          if (shouldPause) {
            console.log(
              `[Insights] Auto-paused ${siteConfig.name} after ${consecutiveFailures} failures`
            );
          }
        }
      } catch (err: any) {
        console.error(`[Insights] Error scraping ${siteConfig.name}:`, err);

        // 🔄 ALWAYS ATTEMPT CACHE RECOVERY ON ERROR
        try {
          const cached = await webMessages.loadMessagesSince(
            username,
            siteConfig.id,
            sinceTimestamp,
            7
          );

          if (cached.length > 0) {
            console.log(
              `[Insights] Recovered ${cached.length} cached messages from ${siteConfig.name}`
            );
            const cachedMessages = cached.map((m: any) => ({
              ...m,
              from: resolveContact(m.from, contactMappings),
              _cached: true,
            }));
            messages.push(...cachedMessages);
          }
        } catch (cacheErr: any) {
          console.error(
            `[Insights] Could not load cache for ${siteConfig.name}:`,
            cacheErr.message
          );
        }

        // Update error status
        const consecutiveFailures = (siteConfig.status?.consecutiveFailures || 0) + 1;

        await configManager.updateStatus(username, siteConfig.id, {
          lastError: err.message,
          consecutiveFailures,
          paused: consecutiveFailures >= 3,
        });
      }
    }
  } catch (err) {
    console.error('[Insights] Error in web scraper collection:', err);
  }

  // Send notification for expired OAuth sessions
  if (expiredOAuthSites.length > 0) {
    try {
      const { BrowserWindow } = require('electron');
      const mainWindow = BrowserWindow.getAllWindows().find((w: any) => !w.isDestroyed());

      if (mainWindow) {
        mainWindow.webContents.send('webscraper:oauthExpired', {
          sites: expiredOAuthSites,
          message: `Session expired for ${expiredOAuthSites.length} OAuth integration(s). Please log in again.`,
        });
        console.log(
          `[Insights] Sent OAuth expiry notification for ${expiredOAuthSites.length} site(s)`
        );
      }
    } catch (notificationErr) {
      console.error('[Insights] Error sending OAuth expiry notification:', notificationErr);
    }
  }

  return messages;
}

/**
 * Collect upcoming calendar events from Google Calendar
 * @param accessToken - Google access token
 * @param daysAhead - Number of days to look ahead (default 14)
 * @returns Array of calendar event objects
 */
async function collectCalendarEvents(accessToken: string, daysAhead: number = 14): Promise<any[]> {
  try {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const url = new globalThis.URL(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    );
    url.searchParams.set('timeMin', startDate.toISOString());
    url.searchParams.set('timeMax', endDate.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '100');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(`[Insights] Calendar API error: ${response.status}`);
      return [];
    }

    const data: any = await response.json();
    const events = (data.items || []).map((event: any) => ({
      id: event.id,
      title: event.summary || '(No title)',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      location: event.location,
      description: event.description,
      htmlLink: event.htmlLink,
    }));

    console.log(`[Insights] Collected ${events.length} upcoming calendar events`);
    return events;
  } catch (err: any) {
    console.error('[Insights] Error collecting calendar events:', err.message);
    return [];
  }
}

/**
 * Collect new messages from all integrations since a given timestamp
 * @param {string} username - The username
 * @param {Object} accessTokens - Access tokens for integrations
 * @param {string} sinceTimestamp - ISO timestamp to collect messages since
 * @param {Object} contactMappings - Contact to name mappings from user profile
 * @returns {Promise<Array>} Array of message objects
 */
const collectNewMessages = async (
  username: string,
  accessTokens: AccessTokens,
  sinceTimestamp: string,
  contactMappings: ContactMappings = {}
): Promise<Message[]> => {
  console.log(`[Insights] Collecting messages since ${sinceTimestamp}`);
  const allMessages: Message[] = [];

  // Collect Gmail messages
  if (accessTokens.google) {
    try {
      const gmailMessages = await collectGmailMessages(
        accessTokens.google,
        sinceTimestamp,
        contactMappings
      );
      allMessages.push(...gmailMessages);
      console.log(`[Insights] Collected ${gmailMessages.length} Gmail messages`);
    } catch (err) {
      console.error('[Insights] Error collecting Gmail messages:', err);
    }
  }

  // Collect Slack messages
  if (accessTokens.slack) {
    try {
      const slackMessages = await collectSlackMessages(
        accessTokens.slack,
        sinceTimestamp,
        contactMappings
      );
      allMessages.push(...slackMessages);
      console.log(`[Insights] Collected ${slackMessages.length} Slack messages`);
    } catch (err) {
      console.error('[Insights] Error collecting Slack messages:', err);
    }
  }

  // Collect iMessages (only if enabled for this user)
  const iMessageEnabled = await SettingsService.getIMessageEnabled(username);
  if (iMessageEnabled) {
    try {
      const iMessages = await collectIMessages(sinceTimestamp, contactMappings);
      allMessages.push(...iMessages);
      console.log(`[Insights] Collected ${iMessages.length} iMessages`);
    } catch (err) {
      console.error('[Insights] Error collecting iMessages:', err);
    }
  } else {
    console.log('[Insights] iMessage integration disabled, skipping collection');
  }

  // Collect from custom web integrations
  try {
    const webMessages = await collectWebScraperMessages(username, sinceTimestamp, contactMappings);
    allMessages.push(...webMessages);
    console.log(`[Insights] Collected ${webMessages.length} custom web messages`);
  } catch (err) {
    console.error('[Insights] Error collecting web messages:', err);
  }

  // Sort by timestamp
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  console.log(`[Insights] Total messages collected: ${allMessages.length}`);
  return allMessages;
};

/**
 * Extract facts from messages using LLM with goal awareness
 * @param {Array} messages - Array of message objects
 * @param {Object} apiKeys - LLM API keys
 * @param {Array} userGoals - User's goals and priorities
 * @returns {Promise<Array>} Array of extracted facts
 */
const extractFactsFromMessages = async (
  messages: Message[],
  apiKeys: ApiKeys,
  userGoals: any[] = []
): Promise<ExtractedFact[]> => {
  if (messages.length === 0) {
    return [];
  }

  console.log(`[Insights] Extracting facts from ${messages.length} messages`);

  // Prepare messages for LLM
  const messagesText = messages
    .map(
      (m: Message) =>
        `[${m.platform}] From: ${m.from}\nSubject: ${m.subject}\nTime: ${m.timestamp}\n${m.body || m.snippet}`
    )
    .join('\n\n---\n\n');

  const goalsContext =
    userGoals.length > 0
      ? `\n\nUser's Current Goals and Priorities:\n${userGoals.map((g) => `- ${g}`).join('\n')}`
      : '';

  const prompt = `You are analyzing messages to extract important facts. Pay special attention to information related to the user's goals.${goalsContext}

Messages to analyze:

${messagesText}

Extract the following types of facts:
1. Appointments, meetings, events with specific dates/times
2. Cancellations or rescheduling
3. Follow-up requests or action items
4. Questions that need responses
5. Important facts (contact info, preferences, important dates)
6. Quantitative information (prices, numbers, metrics)
7. Issues or problems mentioned
8. Information related to the user's goals (prioritize these)

For each fact, provide:
- type: appointment|cancellation|follow_up|question|fact|quantitative|issue
- content: brief description
- platform: which platform (Gmail, Slack, iMessage)
- from: who sent the message (preserve the exact name/email/number from the From field)
- timestamp: when mentioned (use message timestamp)
- priority: 1-5 (5 = highest, especially for goal-related items)
- relatedGoal: if relevant to any user goal, mention which one

Return a JSON object with this structure:
{
  "facts": [
    {
      "type": "appointment",
      "content": "Meeting with John at 2pm Tuesday",
      "platform": "Gmail",
      "from": "john@example.com",
      "timestamp": "2024-01-15T14:00:00Z",
      "priority": 3,
      "relatedGoal": "Close house sale"
    }
  ]
}`;

  try {
    const response = await callLLM([{ role: 'user', content: prompt }], apiKeys, {
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
    });

    const cleanContent = stripMarkdownCodeBlocks(response.content);
    let facts;
    try {
      facts = JSON.parse(cleanContent);
    } catch (parseErr: any) {
      console.error('[Insights] Failed to parse fact extraction response as JSON');
      console.error('[Insights] Raw response:', response.content.substring(0, 500));
      console.error('[Insights] Cleaned content:', cleanContent.substring(0, 500));
      console.error('[Insights] Parse error:', parseErr.message);
      return [];
    }
    console.log(`[Insights] Extracted ${facts.facts?.length || 0} facts`);
    return facts.facts || [];
  } catch (err) {
    console.error('[Insights] Error extracting facts:', err);
    return [];
  }
};

/**
 * Cross-check extracted facts with recent history to find issues
 * NOTE: This function analyzes ALL facts against ALL context without limits.
 * The limit parameter only controls how many top insights are returned for display.
 * @param {Array} extractedFacts - Facts from recent messages
 * @param {string} username - The username
 * @param {Object} apiKeys - LLM API keys
 * @param {Array} userGoals - User's goals and priorities
 * @param {number} limit - Number of top insights to return for display (default 5, analysis is not limited)
 * @returns {Promise<Array>} Array of top N prioritized insights (from full analysis)
 */
const crossCheckWithHistory = async (
  extractedFacts: ExtractedFact[],
  username: string,
  apiKeys: ApiKeys,
  userGoals: any[] = [],
  limit = 5,
  calendarEvents: any[] = [] // NEW PARAMETER
) => {
  if (extractedFacts.length === 0) {
    return [];
  }

  console.log(
    `[Insights] Cross-checking facts with 7-day history (will select top ${limit} insights)`
  );

  // Load recent memory
  const recentMemories = await loadRecentHistory(username, 7);

  const factsText = extractedFacts
    .map(
      (f: any) =>
        `[${f.type}] ${f.content} (From: ${f.from || 'Unknown'} via ${f.platform || 'Unknown'}, Priority: ${f.priority}${f.relatedGoal ? ', Goal: ' + f.relatedGoal : ''})`
    )
    .join('\n');

  const memoriesText = recentMemories.map((m) => `--- ${m.date} ---\n${m.content}`).join('\n\n');

  const goalsContext =
    userGoals.length > 0
      ? `\n\nUser's Current Goals and Priorities:\n${userGoals.map((g) => `- ${g}`).join('\n')}`
      : '';

  const currentDateTime = new Date().toISOString();
  const currentDateFormatted = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const calendarText =
    calendarEvents.length > 0
      ? `\n\nUpcoming Calendar Events (next 14 days):\n${calendarEvents
          .map(
            (e) =>
              `- ${e.title} | ${new Date(e.start).toLocaleString()} to ${new Date(e.end).toLocaleString()}${
                e.location ? ` | Location: ${e.location}` : ''
              } | Event ID: ${e.id}`
          )
          .join('\n')}`
      : '';

  const prompt = `You are analyzing recent facts against historical context AND upcoming calendar events to identify important issues. Prioritize insights that relate to the user's goals.${goalsContext}

**CURRENT DATE AND TIME: ${currentDateFormatted} (${currentDateTime})**

CRITICAL TIME-RELEVANCE RULES:
- ONLY flag conflicts, appointments, or events that are in the FUTURE (after the current date/time above)
- IGNORE any conflicts, appointments, or issues about events that have already passed
- Past conflicts are NOT actionable - the user cannot change what already happened
- If an appointment or meeting was mentioned but the date/time has already passed, do NOT create an insight about it
- For follow-ups and action items, only flag them if they are still relevant (not already resolved or past their deadline)

CALENDAR-AWARENESS RULES (NEW):
- Cross-reference facts with upcoming calendar events
- Detect event cancellations mentioned in messages that match calendar events
- Detect rescheduling, time changes, or location changes
- Detect conflicts between new appointments in messages and existing calendar events
- If a message mentions canceling an event that exists in the calendar, suggest removing it
- If a message mentions rescheduling, suggest both removing old event and creating new one
- IMPORTANT: For calendar-related insights, include the event ID in the suggestedAction JSON

Recent Facts:
${factsText}

Historical Memory (past 7 days):
${memoriesText}${calendarText}

Analyze ALL the facts and context to identify ALL issues and insights (FUTURE-RELEVANT ONLY):
1. **Appointment conflicts** - same time slots, double-bookings (ONLY for future events)
2. **Miscommunication** - contradictory information between messages
3. **Conflicting facts** - person's role changed, address different, etc.
4. **Follow-ups gone idle** - no response in several days (still actionable)
5. **Urgent action items** - time-sensitive tasks (with future deadlines)
6. **Goal-related issues** - anything blocking or impacting user's stated goals (HIGH PRIORITY)
7. **Calendar-event conflicts (NEW)** - event cancellations, rescheduling, time/location changes mentioned in messages

CRITICAL: Return ALL insights you find, not just a limited number. The system will select the top ones to display.
Analyze everything thoroughly - don't limit your search or analysis.

Return a JSON object with ALL insights sorted by priority (highest priority first):
{
  "insights": [
    {
      "id": "insight-1",
      "type": "conflict",
      "title": "Double-booked next Tuesday 2pm",
      "description": "Meeting with John conflicts with dentist appointment on [specific future date]",
      "priority": 5,
      "relatedMessages": [
        {
          "platform": "Gmail",
          "from": "john@example.com",
          "snippet": "Let's meet Tuesday at 2pm",
          "timestamp": "2024-01-15T10:00:00Z"
        }
      ],
      "note": "IMPORTANT: Always include the 'from' field in relatedMessages with the actual sender name/email/phone from the facts",
      "suggestedAction": "Reschedule one of the appointments",
      "actionType": "chat_prompt",
      "actionData": {
        "prompt": "Can you help me reschedule my meeting with John?",
        "toolsNeeded": ["get_calendar_events", "send_email"]
      },
      "relatedGoal": "Close house sale"
    },
    {
      "id": "insight-2",
      "type": "action_needed",
      "title": "Calendar event canceled - remove from calendar",
      "description": "RSM Brookline math classes for Essa and Nova are canceled on Monday Feb 23. These events are still on your calendar.",
      "priority": 4,
      "relatedMessages": [
        {
          "platform": "Gmail",
          "from": "RSM Brookline",
          "snippet": "Both Essa and Nova's math classes are canceled Monday (Feb 23) due to the snowstorm",
          "timestamp": "2024-02-20T10:00:00Z"
        }
      ],
      "suggestedAction": "Remove canceled RSM classes from calendar",
      "actionType": "calendar_update",
      "actionData": {
        "action": "delete",
        "eventIds": ["abc123", "def456"],
        "prompt": "Remove Essa's and Nova's RSM classes from my calendar on Feb 23"
      }
    }
  ]
}

For calendar-related insights:
- Set actionType to "calendar_update" if it involves modifying calendar events
- Include eventIds in actionData for events to be deleted/modified
- Include a human-readable prompt in actionData.prompt that can be sent to chat
- The prompt should be specific enough for the assistant to execute the action

Remember: Return ALL insights you identify, sorted by priority. Don't limit your analysis!`;

  try {
    const response = await callLLM([{ role: 'user', content: prompt }], apiKeys, {
      temperature: 0.4,
      responseFormat: { type: 'json_object' },
    });

    const cleanContent = stripMarkdownCodeBlocks(response.content);
    let result;
    try {
      result = JSON.parse(cleanContent);
    } catch (parseErr: any) {
      console.error('[Insights] Failed to parse LLM response as JSON');
      console.error('[Insights] Raw response:', response.content.substring(0, 500));
      console.error('[Insights] Cleaned content:', cleanContent.substring(0, 500));
      throw new Error(`JSON parse error: ${parseErr.message}`);
    }
    const insights = result.insights || [];

    // Filter out insights about past events
    const futureRelevantInsights = insights.filter((insight: any) => {
      // Check if the title or description mentions a past date
      const text = `${insight.title} ${insight.description}`.toLowerCase();

      // Common past time indicators
      const pastIndicators = [
        'yesterday',
        'last week',
        'last month',
        'past',
        'previous',
        'already happened',
        'occurred',
        'was scheduled',
      ];

      // If it contains past indicators, it might be about a past event
      const hasPastIndicator = pastIndicators.some((indicator) => text.includes(indicator));

      if (hasPastIndicator) {
        console.log(`[Insights] Filtering out past event: ${insight.title}`);
        return false;
      }

      return true;
    });

    // Select only top N insights based on user's display preference
    const topInsights = futureRelevantInsights.slice(0, limit).map((insight: any) => ({
      ...insight,
      timestamp: new Date().toISOString(),
    }));

    console.log(
      `[Insights] Found ${insights.length} total insights, filtered ${insights.length - futureRelevantInsights.length} past events, returning top ${topInsights.length} of ${futureRelevantInsights.length}`
    );
    return topInsights;
  } catch (err) {
    console.error('[Insights] Error cross-checking:', err);
    return [];
  }
};

/**
 * Main processing function - orchestrates the entire insights pipeline
 * NOTE: Always analyzes ALL messages, facts, and context thoroughly.
 * The limit parameter only controls final output count, not analysis depth.
 * @param {string} username - The username
 * @param {Object} accessTokens - Access tokens for integrations
 * @param {Object} apiKeys - LLM API keys
 * @param {string} sinceTimestamp - ISO timestamp to process messages since
 * @param {Array} userGoals - User's goals and priorities
 * @param {number} limit - Number of top insights to return (default 5, does not limit analysis)
 * @returns {Promise<Array>} Array of top N insights from full analysis
 */
const processMessagesAndGenerateInsights = async (
  username: string,
  accessTokens: AccessTokens,
  apiKeys: ApiKeys,
  sinceTimestamp: string,
  userGoals: any[] = [],
  limit: number = 5
): Promise<any[]> => {
  console.log('[Insights] Starting insights generation pipeline');
  console.log(`[Insights] User has ${userGoals.length} goals, limit: ${limit}`);

  try {
    // Load user profile to extract contact mappings
    let contactMappings = {};
    try {
      const profilePath = await getUserProfilePath(username);
      const profileContent = await fs.readFile(profilePath, 'utf8');
      contactMappings = extractContactMappings(profileContent);
      console.log(
        `[Insights] Extracted ${Object.keys(contactMappings).length} contact mappings from profile`
      );
    } catch (profileErr: any) {
      console.log('[Insights] Could not load contact mappings:', profileErr.message);
    }

    // Stage 1: Collect messages with contact resolution
    const messages = await collectNewMessages(
      username,
      accessTokens,
      sinceTimestamp,
      contactMappings
    );

    // Stage 1.5: Collect upcoming calendar events (NEW)
    let calendarEvents: any[] = [];
    if (accessTokens.google) {
      try {
        calendarEvents = await collectCalendarEvents(accessTokens.google, 14);
      } catch (err: any) {
        console.error('[Insights] Error collecting calendar events:', err.message);
      }
    }

    if (messages.length === 0 && calendarEvents.length === 0) {
      console.log('[Insights] No new messages or calendar events to process');
      return [];
    }

    // Stage 2: Extract facts (goal-aware, calendar-aware)
    const facts = await extractFactsFromMessages(messages, apiKeys, userGoals);

    // Save facts to daily memory
    for (const fact of facts) {
      await saveFactToDaily(
        username,
        fact.content,
        messages.find((m) => m.timestamp === fact.timestamp)?.platform || 'message'
      );
    }

    // Stage 3: Cross-check with history AND calendar (enhanced)
    const insights = await crossCheckWithHistory(
      facts,
      username,
      apiKeys,
      userGoals,
      limit,
      calendarEvents
    );

    console.log('[Insights] Pipeline complete');
    return insights;
  } catch (err) {
    console.error('[Insights] Error in processing pipeline:', err);
    throw err;
  }
};

export {
  collectNewMessages,
  extractFactsFromMessages,
  crossCheckWithHistory,
  processMessagesAndGenerateInsights,
};
