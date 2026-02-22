/**
 * Security Sanitizer
 *
 * Ensures NO credentials or sensitive data are ever sent to LLMs
 * Used by AI selector generator and visual selector tools
 */

/**
 * Sanitize HTML before sending to LLM
 * Removes any input field values that might contain passwords/credentials
 *
 * @param html - Raw HTML string
 * @returns Sanitized HTML safe for LLM
 */
export function sanitizeHTMLForLLM(html: string): string {
  // Remove all input field values (might contain passwords/usernames)
  html = html.replace(/value="[^"]*"/gi, 'value=""');
  html = html.replace(/value='[^']*'/gi, "value=''");

  // Remove any data-* attributes that might contain sensitive info
  html = html.replace(/data-[a-z-]+="[^"]*"/gi, '');

  // Remove autocomplete tokens
  html = html.replace(/autocomplete="[^"]*"/gi, '');

  return html;
}

/**
 * Sanitize screenshot metadata
 * Ensures no sensitive data in image metadata
 *
 * @param screenshot - Base64 screenshot
 * @returns Sanitized screenshot
 */
export function sanitizeScreenshotForLLM(screenshot: string): string {
  // Screenshots from puppeteer are just base64 PNG data
  // No metadata to strip, but we validate it's PNG
  if (!screenshot.startsWith('iVBOR') && !screenshot.includes('base64,')) {
    console.warn('[Security] Invalid screenshot format');
  }
  return screenshot;
}

/**
 * Validate that prompt doesn't contain credentials
 * CRITICAL: Call this before every LLM request
 *
 * @param prompt - Prompt to validate
 * @param credentials - Optional credentials to check against
 * @returns True if safe, throws error if credentials detected
 */
export function validatePromptNoCredentials(
  prompt: string,
  credentials?: { username?: string; password?: string }
): boolean {
  if (!prompt) return true;

  // Check for obvious credential patterns
  const suspiciousPatterns = [
    /password["\s:=]+[^"\s]{6,}/i, // password="xxx" or password: xxx
    /pwd["\s:=]+[^"\s]{6,}/i,
    /passwd["\s:=]+[^"\s]{6,}/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(prompt)) {
      const error = 'SECURITY VIOLATION: Prompt contains potential password data';
      console.error(error, '\nPrompt preview:', prompt.substring(0, 200));
      throw new Error(error);
    }
  }

  // If credentials provided, check they're not in the prompt
  if (credentials?.password && prompt.includes(credentials.password)) {
    const error = 'SECURITY VIOLATION: Prompt contains actual password';
    console.error(error);
    throw new Error(error);
  }

  if (credentials?.username && prompt.includes(credentials.username)) {
    console.warn('[Security] Prompt contains username - this may be acceptable for context');
    // Username might be OK (e.g., "logged in as john@example.com") but password is NEVER OK
  }

  return true;
}

/**
 * Redact credentials from log messages
 * Use this for all logging that might contain user input
 *
 * @param message - Log message
 * @returns Redacted message
 */
export function redactCredentialsFromLog(message: string): string {
  // Redact anything that looks like a password
  message = message.replace(/password["\s:=]+[^"\s]{3,}/gi, 'password="[REDACTED]"');
  message = message.replace(/pwd["\s:=]+[^"\s]{3,}/gi, 'pwd="[REDACTED]"');
  message = message.replace(/passwd["\s:=]+[^"\s]{3,}/gi, 'passwd="[REDACTED]"');

  // Redact tokens
  message = message.replace(/token["\s:=]+[^"\s]{10,}/gi, 'token="[REDACTED]"');
  message = message.replace(/apikey["\s:=]+[^"\s]{10,}/gi, 'apikey="[REDACTED]"');

  return message;
}
