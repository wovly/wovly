/**
 * AI Selector Generator
 *
 * Uses LLM with vision capabilities to analyze web pages and generate
 * CSS selectors for login fields, navigation steps, and message extraction.
 */

import type { Page } from 'puppeteer-core';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
}

export interface GeneratedSelectors {
  confidence: 'high' | 'medium' | 'low';
  authMethod?: 'oauth' | 'form';
  needsLoginButtonClick?: boolean;
  loginButtonSelector?: string | null;
  oauth?: {
    oauthProvider?: 'google' | 'microsoft' | 'facebook' | 'generic';
    loginDetectionSelector?: string | null;
    successDetectionSelector?: string | null;
  };
  login?: {
    usernameField: string | null;
    passwordField: string | null;
    submitButton: string | null;
    successIndicator: string | null;
  };
  navigation?: Array<{
    step: number;
    action: string;
    selector: string;
    waitFor?: string;
    description?: string;
    delay?: number;
    value?: string;
  }>;
  messages?: {
    container: string | null;
    messageItem: string | null;
    sender: string | null;
    content: string | null;
    timestamp: string | null;
  };
}

export interface SelectorValidationResult {
  valid: boolean;
  selector?: string;
  found?: boolean;
  reason?: string;
  error?: string;
}

export interface StepValidationResult {
  step: number;
  valid: boolean;
  selector: string;
  found?: boolean;
  error?: string;
}

export interface ValidationResults {
  login: Record<string, SelectorValidationResult>;
  navigation: StepValidationResult[];
  messages: Record<string, SelectorValidationResult>;
}

interface AnthropicMessage {
  role: string;
  content: Array<{
    type: string;
    text?: string;
    source?: {
      type: string;
      media_type: string;
      data: string;
    };
  }>;
}

interface AnthropicResponse {
  content?: Array<{
    text?: string;
  }>;
}

interface AnthropicErrorResponse {
  error?: {
    message?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main Functions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate selectors using AI analysis
 * @param page - Puppeteer page instance
 * @param siteType - Type of site (e.g., 'daycare', 'school', 'tax')
 * @param apiKeys - API keys for LLM
 * @returns Generated selectors with confidence
 */
export async function generateSelectorsWithAI(
  page: Page,
  siteType: string | null = null,
  apiKeys: ApiKeys = {}
): Promise<GeneratedSelectors> {
  try {
    console.warn(`[AI Selector Generator] Analyzing page for ${siteType || 'unknown'} site`);

    // Take screenshot
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: false, // Just visible portion
      type: 'png',
    });

    // Extract simplified HTML (browser context code)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html = (await page.evaluate(() => {
      // @ts-expect-error - document available in browser context
      const clone = document.documentElement.cloneNode(true);

      // Remove scripts, styles, and other non-essential elements
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clone.querySelectorAll('script, style, noscript, svg, img').forEach((el: any) => el.remove());

      // Simplify by removing most attributes except important ones
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clone.querySelectorAll('*').forEach((el: any) => {
        const importantAttrs = [
          'id',
          'class',
          'name',
          'type',
          'role',
          'placeholder',
          'aria-label',
        ];
        const attrs = Array.from(el.attributes);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attrs.forEach((attr: any) => {
          if (!importantAttrs.includes(attr.name)) {
            el.removeAttribute(attr.name);
          }
        });
      });

      return clone.outerHTML.substring(0, 50000); // Limit to 50k chars for token budget
    })) as string;

    // Get page URL for context
    const url = page.url();

    // Build prompt for LLM
    const prompt = buildAnalysisPrompt(url, siteType, html);

    // Call LLM with vision
    const response = await callLLMWithVision(prompt, screenshot as string, apiKeys);

    // Parse and validate response
    const selectors = parseAndValidateSelectors(response);

    console.warn(
      `[AI Selector Generator] Generated selectors with confidence: ${selectors.confidence}`
    );

    return selectors;
  } catch (error) {
    const err = error as Error;
    console.error(`[AI Selector Generator] Error generating selectors:`, err);
    throw err;
  }
}

/**
 * Validate selectors on the page
 * @param page - Puppeteer page instance
 * @param selectors - Generated selectors
 * @returns Validation results
 */
export async function validateSelectors(
  page: Page,
  selectors: GeneratedSelectors
): Promise<ValidationResults> {
  const results: ValidationResults = {
    login: {},
    navigation: [],
    messages: {},
  };

  // Validate login selectors
  if (selectors.login) {
    for (const [key, selector] of Object.entries(selectors.login)) {
      if (!selector) {
        results.login[key] = { valid: false, reason: 'No selector provided' };
        continue;
      }

      try {
        const element = await page.$(selector);
        results.login[key] = {
          valid: element !== null,
          selector,
          found: element !== null,
        };
      } catch (error) {
        const err = error as Error;
        results.login[key] = {
          valid: false,
          selector,
          error: err.message,
        };
      }
    }
  }

  // Validate navigation selectors
  if (selectors.navigation && Array.isArray(selectors.navigation)) {
    for (const step of selectors.navigation) {
      try {
        const element = await page.$(step.selector);
        results.navigation.push({
          step: step.step,
          valid: element !== null,
          selector: step.selector,
          found: element !== null,
        });
      } catch (error) {
        const err = error as Error;
        results.navigation.push({
          step: step.step,
          valid: false,
          selector: step.selector,
          error: err.message,
        });
      }
    }
  }

  // Validate message selectors
  if (selectors.messages) {
    for (const [key, selector] of Object.entries(selectors.messages)) {
      if (!selector) {
        results.messages[key] = { valid: false, reason: 'No selector provided' };
        continue;
      }

      try {
        const element = await page.$(selector);
        results.messages[key] = {
          valid: element !== null,
          selector,
          found: element !== null,
        };
      } catch (error) {
        const err = error as Error;
        results.messages[key] = {
          valid: false,
          selector,
          error: err.message,
        };
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the analysis prompt for the LLM
 */
function buildAnalysisPrompt(url: string, siteType: string | null, html: string): string {
  const siteContext = siteType ? ` This appears to be a ${siteType} website.` : '';

  return `You are analyzing a webpage to generate CSS selectors for web scraping.${siteContext}

URL: ${url}

I need you to identify CSS selectors for the following elements:

1. **Authentication Method Detection** - CRITICAL FIRST STEP:
   - Look for OAuth/SSO buttons like "Sign in with Google", "Continue with Microsoft", "Login with Facebook", etc.
   - If you see OAuth buttons → set "authMethod": "oauth"
   - If you see traditional username/password fields → set "authMethod": "form"
   - If unclear, default to "form"

2. **Login Flow** - Depends on authMethod:

   **For OAuth (authMethod: "oauth"):**
   - Identify OAuth provider: "google", "microsoft", "facebook", or "generic"
   - loginDetectionSelector: an element that only appears when NOT logged in (like "Sign in" button)
   - successDetectionSelector: an element that only appears when logged in (like user menu, dashboard)

   **For Form-based (authMethod: "form"):**
   - If you see a "Login" or "Sign In" button but NO password field → provide a navigation step to click it first
   - If you see username/email and password fields → provide selectors for them
   - Username/email input field
   - Password input field
   - Submit button
   - Success indicator (element that appears after successful login, like a dashboard or user menu)

2. **Navigation Steps** (sequence to reach messages/content):
   - Start from AFTER login (assume user is already logged in)
   - List the steps to navigate from the logged-in page to where messages/content are displayed
   - For each step, provide: selector, action type (click/type/select), description, and what to wait for after the action
   - Example: If messages are in a "Messages" tab, include a step to click that tab

3. **Message/Content Extraction**:
   - Container that holds the list of messages/items
   - Individual message/item selector
   - Sender/author element within each message
   - Content/body element within each message
   - Timestamp/date element within each message

**Important Guidelines:**
- Use robust selectors that are likely to be stable (prefer IDs, then semantic class names, avoid generic classes like 'btn' or 'container')
- For forms, look for input[type="email"], input[type="password"], input[name="..."]
- For buttons, look for button[type="submit"] or specific text content
- Test your selectors mentally - would they still work if the page layout changed slightly?
- Provide a confidence level: "high", "medium", or "low" based on how clear the page structure is

HTML (simplified):
\`\`\`html
${html}
\`\`\`

Please respond ONLY with a valid JSON object in this exact format:

**For OAuth-based authentication:**
\`\`\`json
{
  "confidence": "high|medium|low",
  "authMethod": "oauth",
  "oauth": {
    "oauthProvider": "google|microsoft|facebook|generic",
    "loginDetectionSelector": "button:contains('Sign in')",
    "successDetectionSelector": ".user-menu"
  },
  "navigation": [...],
  "messages": {...}
}
\`\`\`

**For form-based authentication:**
\`\`\`json
{
  "confidence": "high|medium|low",
  "authMethod": "form",
  "needsLoginButtonClick": false,
  "loginButtonSelector": null,
  "login": {
    "usernameField": "input[name='email']",
    "passwordField": "input[type='password']",
    "submitButton": "button[type='submit']",
    "successIndicator": ".dashboard"
  },
  "navigation": [
    {
      "step": 1,
      "action": "click",
      "selector": "a[href*='/messages']",
      "waitFor": ".messages-container",
      "description": "Click Messages tab"
    }
  ],
  "messages": {
    "container": ".messages-list",
    "messageItem": ".message-card",
    "sender": ".message-author",
    "content": ".message-body",
    "timestamp": ".message-date"
  }
}
\`\`\`

**CRITICAL:**
- ALWAYS set "authMethod": "oauth" OR "form" based on what you see
- For OAuth: Look for buttons like "Sign in with Google", "Continue with Microsoft", etc.
- For form-based traditional login:
  - If you see a "Login" or "Sign In" button but NO password field visible on current page:
    - Set "needsLoginButtonClick": true
    - Provide "loginButtonSelector": "selector for the login button"
    - Leave login.usernameField and login.passwordField as null
  - If you see username and password fields already visible:
    - Set "needsLoginButtonClick": false
    - Provide all login selectors
- If you cannot find certain elements, use null for those fields. Do not make up selectors.`;
}

/**
 * Call LLM with vision support
 */
async function callLLMWithVision(
  prompt: string,
  screenshot: string,
  apiKeys: ApiKeys
): Promise<string> {
  try {
    // Use Anthropic API directly for vision support
    if (!apiKeys.anthropic) {
      throw new Error('Anthropic API key required for AI selector generation');
    }

    // Retry logic for network errors
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.warn(`[AI Selector Generator] API call attempt ${attempt}/3`);

        const message: AnthropicMessage = {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: screenshot,
              },
            },
          ],
        };

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
            messages: [message],
          }),
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as AnthropicErrorResponse;
          throw new Error(
            `API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`
          );
        }

        const data = (await response.json()) as AnthropicResponse;
        return data.content?.[0]?.text || '';
      } catch (error) {
        const err = error as Error & { code?: string };
        lastError = err;
        console.error(`[AI Selector Generator] Attempt ${attempt} failed:`, err.message);

        // Only retry on network errors
        if (err.code === 'ECONNRESET' || err.message.includes('fetch failed')) {
          if (attempt < 3) {
            const delay = attempt * 1000; // 1s, 2s backoff
            console.warn(`[AI Selector Generator] Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
        // Don't retry on other errors
        throw err;
      }
    }

    throw lastError;
  } catch (error) {
    const err = error as Error;
    console.error('[AI Selector Generator] LLM call failed after retries:', err);
    throw new Error(`Failed to analyze page with AI: ${err.message}`);
  }
}

/**
 * Parse and validate LLM response
 */
function parseAndValidateSelectors(response: string): GeneratedSelectors {
  try {
    // Extract JSON from response (handle code blocks)
    let jsonStr = response;

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Parse JSON
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(jsonStr) as any;

    // Validate structure
    const validated: GeneratedSelectors = {
      confidence: parsed.confidence || 'low',
      authMethod: parsed.authMethod,
      needsLoginButtonClick: parsed.needsLoginButtonClick || false,
      loginButtonSelector: parsed.loginButtonSelector || null,
      oauth: parsed.oauth
        ? {
            oauthProvider: parsed.oauth.oauthProvider,
            loginDetectionSelector: parsed.oauth.loginDetectionSelector || null,
            successDetectionSelector: parsed.oauth.successDetectionSelector || null,
          }
        : undefined,
      login: {
        usernameField: parsed.login?.usernameField || null,
        passwordField: parsed.login?.passwordField || null,
        submitButton: parsed.login?.submitButton || null,
        successIndicator: parsed.login?.successIndicator || null,
      },
      navigation: Array.isArray(parsed.navigation) ? parsed.navigation : [],
      messages: {
        container: parsed.messages?.container || null,
        messageItem: parsed.messages?.messageItem || null,
        sender: parsed.messages?.sender || null,
        content: parsed.messages?.content || null,
        timestamp: parsed.messages?.timestamp || null,
      },
    };

    return validated;
  } catch (error) {
    const err = error as Error;
    console.error('[AI Selector Generator] Failed to parse LLM response:', err);
    console.error('Response was:', response);

    // Return empty selectors on parse failure
    return {
      confidence: 'low',
      needsLoginButtonClick: false,
      loginButtonSelector: null,
      login: {
        usernameField: null,
        passwordField: null,
        submitButton: null,
        successIndicator: null,
      },
      navigation: [],
      messages: {
        container: null,
        messageItem: null,
        sender: null,
        content: null,
        timestamp: null,
      },
    };
  }
}
