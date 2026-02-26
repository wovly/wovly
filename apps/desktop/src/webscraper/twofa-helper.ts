/**
 * 2FA Code Retrieval Helper
 *
 * Automatically fetches 2FA codes from iMessage for automated login
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Fetch 2FA code from iMessage
 * Searches for recent SMS messages containing verification codes
 *
 * @param searchTerm - Sender name to search for (e.g., "mychart", "MyChart")
 * @param apiKey - Anthropic API key for LLM code extraction
 * @param waitSeconds - How long to wait for message to arrive (default: 10 seconds)
 * @returns The extracted 2FA code or null if not found
 */
export async function fetch2FACodeFromIMessage(
  searchTerm: string,
  apiKey: string,
  waitSeconds: number = 10
): Promise<string | null> {
  try {
    console.log(`[2FA] Waiting ${waitSeconds} seconds for SMS to arrive...`);

    // Wait for SMS to arrive
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    console.log(`[2FA] Searching iMessage for messages containing: "${searchTerm}"`);

    // Open iMessage database (macOS only)
    const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
    const db = Database(dbPath, { readonly: true });

    // Get messages from last 5 minutes
    const fiveMinutesAgo = Math.floor(Date.now() / 1000000000) - 300; // Apple epoch (nanoseconds since 2001-01-01)

    const messages = db
      .prepare(
        `
      SELECT
        message.text,
        message.date,
        handle.id as sender
      FROM message
      LEFT JOIN handle ON message.handle_id = handle.ROWID
      WHERE message.date > ?
        AND message.is_from_me = 0
        AND message.text IS NOT NULL
      ORDER BY message.date DESC
      LIMIT 20
    `
      )
      .all(fiveMinutesAgo);

    db.close();

    console.log(`[2FA] Found ${messages.length} recent messages`);

    if (messages.length === 0) {
      console.log('[2FA] No recent SMS messages found');
      return null;
    }

    // Search for messages that might contain 2FA code
    for (const msg of messages as any[]) {
      const text = msg.text || '';
      const sender = msg.sender || '';

      console.log(`[2FA] Checking message from ${sender}: "${text.slice(0, 50)}..."`);

      // Check if message is from the expected sender or contains verification keywords
      const matchesSender = searchTerm && sender.toLowerCase().includes(searchTerm.toLowerCase());
      const containsVerificationKeywords =
        /code|verify|verification|authentication|login|otp|2fa/i.test(text);
      const containsNumbers = /\d{4,8}/.test(text);

      if ((matchesSender || containsVerificationKeywords) && containsNumbers) {
        console.log('[2FA] Found potential 2FA message, extracting code with LLM...');

        // Use LLM to extract the code
        const code = await extract2FACodeWithLLM(text, apiKey);

        if (code) {
          console.log(`[2FA] ✓ Successfully extracted code: ${code}`);
          return code;
        }
      }
    }

    console.log('[2FA] No 2FA code found in recent messages');
    return null;
  } catch (err: any) {
    console.error('[2FA] Error fetching code from iMessage:', err.message);
    return null;
  }
}

/**
 * Extract 2FA code from text using LLM
 */
async function extract2FACodeWithLLM(text: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Extract the verification code from this message. Return ONLY the numeric code (4-8 digits), nothing else. No explanation.

Message:
${text}`,
          },
        ],
      }),
    });

    const data: any = await response.json();
    const extractedCode = data.content?.[0]?.text?.trim() || '';

    // Validate: should be 4-8 digits
    if (/^\d{4,8}$/.test(extractedCode)) {
      return extractedCode;
    }

    console.log(`[2FA] LLM returned invalid code: "${extractedCode}"`);
    return null;
  } catch (err: any) {
    console.error('[2FA] LLM extraction error:', err.message);
    return null;
  }
}

/**
 * Fetch 2FA code from Gmail
 * Searches for recent emails containing verification codes
 *
 * @param accessToken - Google OAuth access token
 * @param searchTerm - Sender name/domain to search for (e.g., "mychart", "MyChart")
 * @param apiKey - Anthropic API key for LLM code extraction
 * @param waitSeconds - How long to wait for email to arrive (default: 10 seconds)
 * @returns The extracted 2FA code or null if not found
 */
export async function fetch2FACodeFromGmail(
  accessToken: string,
  searchTerm: string,
  apiKey: string,
  waitSeconds: number = 10
): Promise<string | null> {
  try {
    console.log(`[2FA] Waiting ${waitSeconds} seconds for email to arrive...`);

    // Wait for email to arrive
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    console.log(`[2FA] Searching Gmail for messages from: "${searchTerm}"`);

    // Search for recent emails (last 5 minutes) from sender
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    const query = `from:${searchTerm} after:${fiveMinutesAgo}`;

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('[2FA] Gmail API error:', response.status, response.statusText);
      return null;
    }

    const data: any = await response.json();

    if (!data.messages || data.messages.length === 0) {
      console.log('[2FA] No recent emails found from', searchTerm);
      return null;
    }

    console.log(`[2FA] Found ${data.messages.length} recent emails`);

    // Get full message content
    for (const message of data.messages) {
      const messageId = message.id;
      const msgResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!msgResponse.ok) continue;

      const fullMessage: any = await msgResponse.json();
      const emailBody = extractEmailBody(fullMessage);

      console.log(`[2FA] Checking email: "${emailBody.slice(0, 100)}..."`);

      // Check if email contains verification keywords
      const containsVerificationKeywords =
        /code|verify|verification|authentication|login|otp|2fa/i.test(emailBody);
      const containsNumbers = /\d{4,8}/.test(emailBody);

      if (containsVerificationKeywords && containsNumbers) {
        console.log('[2FA] Found potential 2FA email, extracting code with LLM...');

        // Use LLM to extract the code
        const code = await extract2FACodeWithLLM(emailBody, apiKey);

        if (code) {
          console.log(`[2FA] ✓ Successfully extracted code from email: ${code}`);
          return code;
        }
      }
    }

    console.log('[2FA] No 2FA code found in recent emails');
    return null;
  } catch (err: any) {
    console.error('[2FA] Error fetching code from Gmail:', err.message);
    return null;
  }
}

/**
 * Helper to extract email body from Gmail API response
 */
function extractEmailBody(message: any): string {
  const payload = message.payload;

  // Try plain text first
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  // Check multipart
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
    }

    // Fallback to HTML
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf8');
        // Strip HTML tags (basic)
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      }
    }
  }

  return '';
}
