/**
 * Slack OAuth Service
 * Handles Slack OAuth authentication with user tokens
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

export interface SlackTokens {
  access_token: string;
  user_id: string;
  team: {
    id: string;
    name: string;
  };
  client_id: string;
  client_secret: string;
  is_user_token: boolean;
}

export interface SlackResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
  team?: {
    id: string;
    name: string;
  };
}

export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

export class SlackOAuthService {
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    tunnelUrl: string | null,
    shell: ElectronShell
  ): Promise<SlackResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      // Use tunnel URL if provided, otherwise fall back to localhost
      const redirectUri = tunnelUrl ? `${tunnelUrl}/oauth/callback` : 'http://localhost:18924/oauth/callback';

      // User scopes - these allow sending messages as the user (not as a bot)
      const userScopes = [
        'channels:history',
        'channels:read',
        'channels:write',
        'chat:write',
        'groups:history',
        'groups:read',
        'groups:write',
        'im:history',
        'im:read',
        'im:write',
        'mpim:history',
        'mpim:read',
        'users:read',
        'users:read.email'
      ].join(',');

      // Use user_scope instead of scope to get user token
      const authUrl =
        `https://slack.com/oauth/v2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&user_scope=${encodeURIComponent(userScopes)}`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:18924`);

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authorization Failed</h1><p>' + error + '</p><p>You can close this window.</p>');
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri
                })
              });

              const tokenData: any = await tokenResponse.json();
              console.log('[Slack] OAuth response:', tokenData.ok ? 'success' : tokenData.error);

              // Check for user token (authed_user.access_token) - this allows sending as the user
              const userToken = tokenData.authed_user?.access_token;
              const userId = tokenData.authed_user?.id;

              if (tokenData.ok && userToken) {
                const settingsPath = await getSettingsPath(username);
                let settings: any = {};
                try {
                  const settingsData = await fs.readFile(settingsPath, 'utf8');
                  settings = JSON.parse(settingsData);
                } catch {
                  // No existing settings
                }

                settings.slackTokens = {
                  access_token: userToken, // User token, not bot token
                  user_id: userId,
                  team: tokenData.team,
                  client_id: clientId,
                  client_secret: clientSecret,
                  is_user_token: true // Flag to indicate this is a user token
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(
                  `<h1>Slack Connected!</h1>` +
                    `<p>Workspace: ${tokenData.team?.name || 'Unknown'}</p>` +
                    `<p>Connected as user. Messages will be sent on your behalf.</p>` +
                    `<p>You can close this window and return to Wovly.</p>`
                );
                server.close();
                resolve({ ok: true, team: tokenData.team });
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authorization Failed</h1><p>' + (tokenData.error || 'Unknown error') + '</p>');
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

      server.listen(18924, () => {
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
    getAccessToken: (username: string | undefined) => Promise<string | null>,
    getSettingsPath: (username: string | undefined) => Promise<string>
  ): Promise<SlackResponse> {
    try {
      const accessToken = await getAccessToken(username || undefined);
      if (!accessToken) {
        return { ok: true, authorized: false };
      }

      const settingsPath = await getSettingsPath(username || undefined);
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);

      return {
        ok: true,
        authorized: true,
        team: settings.slackTokens?.team
      };
    } catch (err) {
      return { ok: true, authorized: false };
    }
  }

  static async disconnect(username: string | null | undefined): Promise<SlackResponse> {
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

      delete settings.slackTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Slack] Error disconnecting:', error);
      return { ok: false, error };
    }
  }
}
