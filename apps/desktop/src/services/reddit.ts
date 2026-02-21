/**
 * Reddit Service
 * Handles Reddit OAuth authentication
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

export interface RedditTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
  client_secret: string;
}

export interface RedditResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
  message?: string;
}

export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

export class RedditService {
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    shell: ElectronShell
  ): Promise<RedditResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      const redirectUri = 'http://localhost:18923/oauth/callback';
      const scopes = 'identity read submit privatemessages history';
      const state = crypto.randomBytes(16).toString('hex');

      const authUrl =
        `https://www.reddit.com/api/v1/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&state=${state}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&duration=permanent` +
        `&scope=${encodeURIComponent(scopes)}`;

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
              const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
                },
                body: new URLSearchParams({
                  grant_type: 'authorization_code',
                  code,
                  redirect_uri: redirectUri
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

                settings.redditTokens = {
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
                resolve({ ok: false, error: tokenData.error || 'Token exchange failed' });
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
    });
  }

  static async checkAuth(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<RedditResponse> {
    try {
      if (!username) {
        return { ok: true, authorized: false };
      }

      const token = await getAccessToken(username);
      return { ok: true, authorized: !!token };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reddit] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  static async disconnect(username: string | null | undefined): Promise<RedditResponse> {
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

      delete settings.redditTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reddit] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  static async test(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<RedditResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const token = await getAccessToken(username);
      if (!token) {
        return { ok: false, error: 'Reddit not connected' };
      }

      const response = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Wovly/1.0'
        }
      });
      const data: any = await response.json();

      if (data.name) {
        return { ok: true, message: `Connected as u/${data.name}` };
      }

      return { ok: false, error: 'Connection test failed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reddit] Error testing connection:', error);
      return { ok: false, error };
    }
  }
}
