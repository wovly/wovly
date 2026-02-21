/**
 * X (Twitter) Service
 * Handles X OAuth authentication with PKCE
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

export interface XTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
  client_secret: string;
}

export interface XResponse {
  ok: boolean;
  error?: string;
  authorized?: boolean;
  message?: string;
}

export interface ElectronShell {
  openExternal: (url: string) => Promise<void>;
}

export class XService {
  static async startOAuth(
    username: string | null | undefined,
    clientId: string,
    clientSecret: string,
    shell: ElectronShell
  ): Promise<XResponse> {
    if (!username) {
      return { ok: false, error: 'Not logged in' };
    }

    return new Promise((resolve) => {
      const redirectUri = 'http://localhost:18923/oauth/callback';
      const scopes = 'tweet.read tweet.write users.read dm.read dm.write offline.access';
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      const authUrl =
        `https://twitter.com/i/oauth2/authorize?` +
        `response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=state` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;

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
              const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
                },
                body: new URLSearchParams({
                  code,
                  grant_type: 'authorization_code',
                  redirect_uri: redirectUri,
                  code_verifier: codeVerifier
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

                settings.xTokens = {
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
                res.end('<h1>Token Exchange Failed</h1><p>' + (tokenData.error_description || 'Unknown error') + '</p>');
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
    });
  }

  static async checkAuth(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<XResponse> {
    try {
      if (!username) {
        return { ok: true, authorized: false };
      }

      const token = await getAccessToken(username);
      return { ok: true, authorized: !!token };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[X] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  static async disconnect(username: string | null | undefined): Promise<XResponse> {
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

      delete settings.xTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[X] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  static async test(
    username: string | null | undefined,
    getAccessToken: (username: string) => Promise<string | null>
  ): Promise<XResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const token = await getAccessToken(username);
      if (!token) {
        return { ok: false, error: 'X not connected' };
      }

      const response = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: any = await response.json();

      if (data.data?.username) {
        return { ok: true, message: `Connected as @${data.data.username}` };
      }

      return { ok: false, error: 'Connection test failed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[X] Error testing connection:', error);
      return { ok: false, error };
    }
  }
}
