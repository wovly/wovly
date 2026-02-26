/**
 * Google OAuth Service
 * Handles one-click Google OAuth flow with localhost callback
 */

import { BrowserWindow, shell } from 'electron';
import http from 'http';
import { URL } from 'url';
import { getGoogleOAuthConfig, isGoogleOAuthConfigured } from '../config/google-oauth';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface OAuthResult {
  ok: boolean;
  tokens?: OAuthTokens;
  error?: string;
}

export class GoogleOAuthService {
  private callbackServer: http.Server | null = null;
  private readonly CALLBACK_PORT = 18923;

  /**
   * Launch one-click Google OAuth flow
   * Opens browser, waits for callback, exchanges code for tokens
   */
  async connectGoogle(): Promise<OAuthResult> {
    try {
      // Check if OAuth is configured
      if (!isGoogleOAuthConfigured()) {
        return {
          ok: false,
          error:
            'Google OAuth is not configured. Please set up your OAuth credentials in the config file.',
        };
      }

      const config = getGoogleOAuthConfig();

      // Start callback server
      const authCode = await this.startCallbackServerAndGetCode(config.redirectUri);

      if (!authCode) {
        return {
          ok: false,
          error: 'Authorization cancelled or timed out',
        };
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(authCode, config);

      if (!tokens) {
        return {
          ok: false,
          error: 'Failed to exchange authorization code for tokens',
        };
      }

      return {
        ok: true,
        tokens,
      };
    } catch (error) {
      const err = error as Error;
      console.error('[GoogleOAuth] Error during OAuth flow:', err);
      return {
        ok: false,
        error: err.message || 'OAuth flow failed',
      };
    }
  }

  /**
   * Start localhost callback server and open browser for authorization
   * @returns Authorization code from callback
   */
  private async startCallbackServerAndGetCode(redirectUri: string): Promise<string | null> {
    return new Promise((resolve) => {
      const config = getGoogleOAuthConfig();

      // Build OAuth URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', config.scopes.join(' '));
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      let resolved = false;

      // Create callback server
      this.callbackServer = http.createServer((req, res) => {
        if (resolved) return;

        const reqUrl = new URL(req.url || '', `http://localhost:${this.CALLBACK_PORT}`);

        // Check if this is the OAuth callback
        if (reqUrl.pathname === '/oauth/callback') {
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            console.error('[GoogleOAuth] Authorization error:', error);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #e53e3e;">❌ Authorization Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            resolved = true;
            this.stopCallbackServer();
            resolve(null);
            return;
          }

          if (code) {
            console.log('[GoogleOAuth] Received authorization code');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #48bb78;">✅ Authorization Successful!</h1>
                  <p>You can close this window and return to the app.</p>
                  <script>setTimeout(() => window.close(), 2000);</script>
                </body>
              </html>
            `);
            resolved = true;
            this.stopCallbackServer();
            resolve(code);
            return;
          }
        }

        // Default response
        res.writeHead(404);
        res.end('Not found');
      });

      // Start server
      this.callbackServer.listen(this.CALLBACK_PORT, () => {
        console.log(`[GoogleOAuth] Callback server listening on port ${this.CALLBACK_PORT}`);
      });

      // Open browser
      console.log('[GoogleOAuth] Opening browser for authorization...');
      shell.openExternal(authUrl.toString());

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!resolved) {
          console.warn('[GoogleOAuth] Authorization timeout');
          resolved = true;
          this.stopCallbackServer();
          resolve(null);
        }
      }, 300000);
    });
  }

  /**
   * Stop the callback server
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
      console.log('[GoogleOAuth] Callback server stopped');
    }
  }

  /**
   * Exchange authorization code for access/refresh tokens
   */
  private async exchangeCodeForTokens(
    code: string,
    config: ReturnType<typeof getGoogleOAuthConfig>
  ): Promise<OAuthTokens | null> {
    try {
      console.log('[GoogleOAuth] Exchanging code for tokens...');

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleOAuth] Token exchange failed:', response.status, errorText);
        return null;
      }

      const tokens = (await response.json()) as OAuthTokens;
      console.log('[GoogleOAuth] Successfully obtained tokens');

      return tokens;
    } catch (error) {
      const err = error as Error;
      console.error('[GoogleOAuth] Error exchanging code for tokens:', err);
      return null;
    }
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
    try {
      const config = getGoogleOAuthConfig();

      console.log('[GoogleOAuth] Refreshing access token...');

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleOAuth] Token refresh failed:', response.status, errorText);
        return null;
      }

      const tokens = (await response.json()) as OAuthTokens;
      console.log('[GoogleOAuth] Successfully refreshed token');

      return tokens;
    } catch (error) {
      const err = error as Error;
      console.error('[GoogleOAuth] Error refreshing token:', err);
      return null;
    }
  }
}

export default GoogleOAuthService;
