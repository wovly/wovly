/**
 * Notion Service
 * Handles Notion OAuth authentication
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

export interface NotionTokens {
  access_token: string;
  workspace_name?: string;
  workspace_id?: string;
}

export interface NotionResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
  message?: string;
  workspace?: string;
}

export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

export class NotionService {
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    shell: ElectronShell
  ): Promise<NotionResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      const redirectUri = 'http://localhost:18923/oauth/callback';

      const authUrl =
        `https://api.notion.com/v1/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&owner=user`;

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
              const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
                },
                body: JSON.stringify({
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

                settings.notionTokens = {
                  access_token: tokenData.access_token,
                  workspace_name: tokenData.workspace_name,
                  workspace_id: tokenData.workspace_id
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>');
                server.close();
                resolve({ ok: true, workspace: tokenData.workspace_name });
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
  ): Promise<NotionResponse> {
    try {
      if (!username) {
        return { ok: true, authorized: false };
      }

      const token = await getAccessToken(username);
      return { ok: true, authorized: !!token };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Notion] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  static async disconnect(username: string | null | undefined): Promise<NotionResponse> {
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

      delete settings.notionTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Notion] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  static async test(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<NotionResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const token = await getAccessToken(username);
      if (!token) {
        return { ok: false, error: 'Notion not connected' };
      }

      const response = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28'
        }
      });
      const data: any = await response.json();

      if (data.name || data.id) {
        return { ok: true, message: `Connected to Notion` };
      }

      return { ok: false, error: 'Connection test failed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Notion] Error testing connection:', error);
      return { ok: false, error };
    }
  }
}
