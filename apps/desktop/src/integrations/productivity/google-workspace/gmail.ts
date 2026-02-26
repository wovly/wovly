/**
 * Gmail Integration Module
 *
 * Provides Gmail functionality: search, read, send emails, and LLM analysis.
 * Part of the Google Workspace integration.
 */

import { IntegrationContext } from '../../base';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const gmailTools = [
  {
    name: 'search_emails',
    description: 'Search for emails.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email_content',
    description: 'Get the content of a specific email.',
    input_schema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The email message ID' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'get_email_contents_batch',
    description:
      'Get the contents of multiple emails in batch. More efficient than calling get_email_content multiple times. Use this when you need to fetch content for multiple emails (e.g., to summarize a list of emails).',
    input_schema: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of email message IDs to fetch',
        },
        maxEmails: {
          type: 'number',
          description: 'Maximum number of emails to fetch (default: 50)',
          default: 50,
        },
      },
      required: ['messageIds'],
    },
  },
  {
    name: 'analyze_with_llm',
    description:
      'Use the LLM to analyze, summarize, or extract information from text content. Useful for generating summaries, answering questions about content, or performing analysis that requires understanding and reasoning.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The text content to analyze (can be a single text or JSON stringified array of items)',
        },
        instruction: {
          type: 'string',
          description:
            "What you want the LLM to do with the content (e.g., 'Summarize these emails', 'Extract key action items', 'List the main senders and topics')",
        },
        format: {
          type: 'string',
          description:
            "Desired output format: 'text' (plain text), 'markdown' (formatted markdown), or 'json' (structured data)",
          enum: ['text', 'markdown', 'json'],
          default: 'markdown',
        },
      },
      required: ['content', 'instruction'],
    },
  },
  {
    name: 'send_email',
    description:
      'Send an email or reply to an existing email thread. Always confirm with user before sending. When replying to an email, use threadId and replyToMessageId to keep the conversation in the same thread.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email' },
        subject: {
          type: 'string',
          description:
            "Email subject. For replies, keep the original subject (optionally with 'Re: ' prefix) to maintain the thread.",
        },
        body: { type: 'string', description: 'Email body' },
        cc: { type: 'string', description: 'CC recipients' },
        bcc: { type: 'string', description: 'BCC recipients' },
        threadId: {
          type: 'string',
          description:
            'Gmail thread ID to reply to. Use this when replying to an existing email conversation.',
        },
        replyToMessageId: {
          type: 'string',
          description:
            'Message-ID header of the email being replied to. Required for proper threading.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
] as any[];

// ─────────────────────────────────────────────────────────────────────────────
// Execute Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Gmail tool
 */
export async function executeGmailTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.google;
  if (!accessToken) {
    return { error: 'Google access token not available' };
  }

  try {
    switch (toolName) {
      case 'search_emails': {
        const { query, maxResults = 10 } = toolInput;

        const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
        url.searchParams.set('q', query);
        url.searchParams.set('maxResults', maxResults.toString());

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) throw new Error('Failed to search emails');
        const data = (await response.json()) as any;
        return { messages: data.messages || [], resultCount: data.resultSizeEstimate || 0 };
      }

      case 'get_email_content': {
        const { messageId } = toolInput;

        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!response.ok) throw new Error('Failed to get email');
        const email = (await response.json()) as any;

        const headers = email.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        let body = '';
        const extractBody = (part: any) => {
          if (part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8');
          }
          if (part.parts) {
            for (const p of part.parts) {
              if (p.mimeType === 'text/plain') extractBody(p);
            }
          }
        };
        extractBody(email.payload);

        return {
          id: email.id,
          threadId: email.threadId,
          messageId: getHeader('Message-ID'),
          subject: getHeader('Subject'),
          from: getHeader('From'),
          to: getHeader('To'),
          date: getHeader('Date'),
          body: body.substring(0, 2000),
        };
      }

      case 'get_email_contents_batch': {
        const { messageIds, maxEmails = 50 } = toolInput;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return { success: false, error: 'messageIds must be a non-empty array', emails: [] };
        }

        console.log(
          `[Gmail] Batch fetching ${messageIds.length} emails (sample IDs):`,
          messageIds.slice(0, 3)
        );

        // Extract IDs if messageIds contains objects instead of strings
        const idsToFetch = messageIds
          .slice(0, maxEmails)
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && item.id) return item.id;
            return null;
          })
          .filter((id: any) => id !== null);

        if (idsToFetch.length === 0) {
          return { success: false, error: 'No valid message IDs found', emails: [] };
        }

        console.log(
          `[Gmail] Extracted ${idsToFetch.length} valid IDs (sample):`,
          idsToFetch.slice(0, 3)
        );

        const emails: any[] = [];
        let fetchedCount = 0;
        let errorCount = 0;
        let firstError: string | null = null;

        // Fetch emails in parallel (batches of 10 to avoid overwhelming the API)
        const batchSize = 10;
        for (let i = 0; i < idsToFetch.length; i += batchSize) {
          const batch = idsToFetch.slice(i, i + batchSize);
          const batchPromises = batch.map(async (id: string) => {
            try {
              const response = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );

              if (!response.ok) {
                const errorText = await response.text();
                if (!firstError) {
                  firstError = `${response.status}: ${errorText.substring(0, 200)}`;
                }
                console.error(
                  `[Gmail] Error fetching email ${id}: ${response.status} ${errorText.substring(0, 100)}`
                );
                errorCount++;
                return null;
              }

              const email = (await response.json()) as any;
              const headers = email.payload?.headers || [];
              const getHeader = (name: string) =>
                headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

              let body = '';
              const extractBody = (part: any) => {
                if (part.body?.data) {
                  body = Buffer.from(part.body.data, 'base64').toString('utf8');
                }
                if (part.parts) {
                  for (const p of part.parts) {
                    if (p.mimeType === 'text/plain') extractBody(p);
                  }
                }
              };
              extractBody(email.payload);

              fetchedCount++;
              return {
                id: email.id,
                threadId: email.threadId,
                messageId: getHeader('Message-ID'),
                subject: getHeader('Subject'),
                from: getHeader('From'),
                to: getHeader('To'),
                date: getHeader('Date'),
                body: body.substring(0, 2000),
              };
            } catch (err: any) {
              if (!firstError) {
                firstError = err.message;
              }
              console.error(`[Gmail] Error fetching email ${id}:`, err.message);
              errorCount++;
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          emails.push(...batchResults.filter((e: any) => e !== null));
        }

        if (firstError) {
          console.error(`[Gmail] Batch fetch first error: ${firstError}`);
        }
        console.log(
          `[Gmail] Batch fetched ${emails.length} emails (${errorCount} errors out of ${idsToFetch.length})`
        );
        return {
          success: emails.length > 0 || errorCount === 0,
          emails,
          fetched: emails.length,
          errors: errorCount,
          total: messageIds.length,
          firstError: errorCount > 0 ? firstError : null,
        };
      }

      case 'analyze_with_llm': {
        const { content, instruction, format = 'markdown' } = toolInput;

        if (!content || !instruction) {
          return { success: false, error: 'content and instruction are required' };
        }

        const apiKeys = context.apiKeys;
        if (!apiKeys?.anthropic) {
          return {
            success: false,
            error: 'Anthropic API key not available',
          };
        }

        try {
          // Format content properly - handle arrays and objects
          let formattedContent = content;
          if (Array.isArray(content)) {
            if (content.length > 0 && typeof content[0] === 'object') {
              formattedContent = JSON.stringify(content, null, 2);
            } else {
              formattedContent = content.join('\n');
            }
          } else if (typeof content === 'object' && content !== null) {
            formattedContent = JSON.stringify(content, null, 2);
          } else if (typeof content !== 'string') {
            formattedContent = String(content);
          }

          console.log(
            `[LLM] Analyzing content: ${formattedContent.length} chars, type: ${Array.isArray(content) ? 'array' : typeof content}`
          );

          const analysisPrompt = `${instruction}\n\n${format === 'json' ? 'Respond with valid JSON only, no other text.' : ''}\n\nContent to analyze:\n${formattedContent}`;

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKeys.anthropic,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 4000,
              messages: [{ role: 'user', content: analysisPrompt }],
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} ${errorText}`);
          }

          const data = (await response.json()) as any;
          const analysis = data.content[0].text;

          console.log(`[LLM] Analysis completed (${analysis.length} chars)`);
          return {
            success: true,
            analysis,
            result: analysis,
            formatted: analysis,
            tokens_used: data.usage.input_tokens + data.usage.output_tokens,
          };
        } catch (err: any) {
          console.error(`[LLM] Analysis error:`, err.message);
          return {
            success: false,
            error: err.message,
          };
        }
      }

      case 'send_email': {
        const { to, subject, body, cc, bcc, threadId, replyToMessageId } = toolInput;

        let emailContent = `To: ${to}\r\n`;
        if (cc) emailContent += `Cc: ${cc}\r\n`;
        if (bcc) emailContent += `Bcc: ${bcc}\r\n`;

        if (replyToMessageId) {
          emailContent += `In-Reply-To: ${replyToMessageId}\r\n`;
          emailContent += `References: ${replyToMessageId}\r\n`;
        }

        emailContent += `Subject: ${subject}\r\n`;
        emailContent += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
        emailContent += body;

        const encodedEmail = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const requestBody: any = { raw: encodedEmail };
        if (threadId) {
          requestBody.threadId = threadId;
        }

        const response = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errData = await response.text();
          throw new Error(`Failed to send email: ${errData}`);
        }

        const result = (await response.json()) as any;
        return {
          success: true,
          message: `Email sent to ${to}`,
          messageId: result.id,
          threadId: result.threadId,
        };
      }

      default:
        return { error: `Unknown Gmail tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`[Gmail] Error executing ${toolName}:`, error);
    return { error: error.message || String(error) };
  }
}
