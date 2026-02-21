/**
 * Google OAuth Service
 * Handles Google OAuth authentication for Gmail, Calendar, and Drive
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
  client_secret: string;
}

export interface GoogleResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
}

export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

export class GoogleOAuthService {
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    shell: ElectronShell
  ): Promise<GoogleResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      const redirectUri = 'http://localhost:18923/oauth/callback';
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/drive.readonly'
      ].join(' ');

      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&access_type=offline` +
        `&prompt=consent`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:18923`);

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authorization Failed</h1><p>You can close this window.</p>');
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  grant_type: 'authorization_code'
                })
              });

              const tokenData: any = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(username);
                let settings: any = {};
                try {
                  const settingsData = await fs.readFile(settingsPath, 'utf8');
                  settings = JSON.parse(settingsData);
                } catch {
                  // No existing settings
                }

                settings.googleTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + tokenData.expires_in * 1000,
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>');
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Token Exchange Failed</h1><p>You can close this window.</p>');
                server.close();
                resolve({ ok: false, error: tokenData.error_description || 'Token exchange failed' });
              }
            } catch (err) {
              const error = err instanceof Error ? err.message : 'Unknown error';
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<h1>Error</h1><p>' + error + '</p>');
              server.close();
              resolve({ ok: false, error });
            }
          }
        }
      });

      server.listen(18923, () => {
        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Authorization timed out' });
      }, 300000);
    });
  }

  static async checkAuth(
    username: string | null | undefined,
    getAccessToken: (username: string | undefined) => Promise<string | null>
  ): Promise<GoogleResponse> {
    try {
      const accessToken = await getAccessToken(username || undefined);
      return { ok: true, authorized: !!accessToken };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Google] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  static async disconnect(username: string | null | undefined): Promise<GoogleResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const settingsPath = await getSettingsPath(username);
      let settings: any = {};
      try {
        const settingsData = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsData);
      } catch {
        // No settings
      }

      delete settings.googleTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Google] Error disconnecting:', error);
      return { ok: false, error };
    }
  }
}
