/**
 * Discord Service
 * Handles Discord OAuth authentication and connection management
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

/**
 * Discord tokens interface
 */
export interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
  client_secret: string;
}

/**
 * Service response interface
 */
export interface DiscordResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
  message?: string;
}

/**
 * Electron shell interface (for opening external URLs)
 */
export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

/**
 * DiscordService - Manages Discord OAuth integration
 */
export class DiscordService {
  /**
   * Start Discord OAuth flow
   * @param username - Current username
   * @param clientId - Discord client ID
   * @param clientSecret - Discord client secret
   * @param shell - Electron shell for opening URLs
   * @returns Success/error response
   */
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    shell: ElectronShell
  ): Promise<DiscordResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      const redirectUri = 'http://localhost:18923/oauth/callback';
      const scopes = 'identify guilds guilds.members.read messages.read bot';

      const authUrl =
        `https://discord.com/api/oauth2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
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
              const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
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

                settings.discordTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + tokenData.expires_in * 1000,
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(
                  '<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>'
                );
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Token Exchange Failed</h1><p>You can close this window.</p>');
                server.close();
                resolve({
                  ok: false,
                  error: tokenData.error_description || 'Token exchange failed'
                });
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

  /**
   * Check if Discord is authenticated
   * @param username - Current username
   * @param getAccessToken - Function to get access token
   * @returns Authorization status
   */
  static async checkAuth(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<DiscordResponse> {
    try {
      if (!username) {
        return { ok: true, authorized: false };
      }

      const token = await getAccessToken(username);
      return { ok: true, authorized: !!token };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Discord] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  /**
   * Disconnect Discord by removing tokens
   * @param username - Current username
   * @returns Success/error response
   */
  static async disconnect(
    username: string | null | undefined
  ): Promise<DiscordResponse> {
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

      delete settings.discordTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Discord] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  /**
   * Test Discord connection
   * @param username - Current username
   * @param getAccessToken - Function to get access token
   * @returns Success/error response with connection message
   */
  static async test(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<DiscordResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const token = await getAccessToken(username);
      if (!token) {
        return { ok: false, error: 'Discord not connected' };
      }

      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: any = await response.json();

      if (data.username) {
        return {
          ok: true,
          message: `Connected as ${data.username}`
        };
      }

      return { ok: false, error: 'Connection test failed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Discord] Error testing connection:', error);
      return { ok: false, error };
    }
  }
}
