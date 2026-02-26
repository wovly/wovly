/**
 * Shared Google OAuth Configuration
 *
 * This allows all users to connect Google with one click instead of
 * creating their own OAuth applications.
 *
 * SETUP INSTRUCTIONS (One-time for you as the developer):
 * 1. Go to https://console.cloud.google.com
 * 2. Create a new project: "Wovly Desktop App"
 * 3. Enable these APIs:
 *    - Gmail API
 *    - Google Calendar API
 *    - Google Drive API
 * 4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
 * 5. Application type: "Desktop app" (no client secret needed)
 *    OR "Web application" with redirect URI: http://localhost:18923/oauth/callback
 * 6. Copy the Client ID (and Client Secret if Web app) below
 * 7. Optionally use environment variables for security
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  flowType: 'authorization_code' | 'device';
}

/**
 * Get Google OAuth configuration
 * Uses Desktop App OAuth type - no client secret needed (uses PKCE instead)
 *
 * The client ID is safe to bundle publicly in desktop apps.
 * See: https://developers.google.com/identity/protocols/oauth2/native-app
 */
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    // Desktop App Client ID (safe to bundle publicly - like VS Code does)
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      '150582525788-vle1h3jtf04odf5dh8b3pnmo5l7re4vk.apps.googleusercontent.com',

    // Client secret not needed for Desktop app type (PKCE provides security)
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

    // Localhost redirect for OAuth callback
    redirectUri: 'http://localhost:18923/oauth/callback',

    // Requested permissions
    scopes: [
      // Gmail
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',

      // Calendar
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',

      // Drive (for file attachments)
      'https://www.googleapis.com/auth/drive.file',

      // User info (for profile display)
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],

    // OAuth flow type
    flowType: 'authorization_code',
  };
}

/**
 * Check if OAuth config is properly set up
 */
export function isGoogleOAuthConfigured(): boolean {
  const config = getGoogleOAuthConfig();
  return (
    config.clientId !== '' && config.clientId !== 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com'
  );
}

/**
 * Get user-friendly error message if config is not set up
 */
export function getGoogleOAuthSetupError(): string {
  if (!isGoogleOAuthConfigured()) {
    return 'Google OAuth is not configured. Please set up your OAuth credentials in the config file or contact support.';
  }
  return '';
}
