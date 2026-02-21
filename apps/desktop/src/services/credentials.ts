/**
 * Credentials Service
 * Handles secure credential storage with encryption
 */

import {
  Credential,
  Credentials,
  loadCredentials,
  saveCredentials,
  getCredentialForDomain
} from '../storage/credentials';

/**
 * Masked credential for list display (no password)
 */
export interface MaskedCredential {
  domain: string;
  displayName: string;
  username: string;
  hasPassword: boolean;
  notes: string;
  lastUsed: string | null;
  created: string | null;
}

/**
 * Full credential with optional password (for get operations)
 */
export interface FullCredential {
  domain: string;
  displayName: string;
  username: string;
  password?: string;
  notes: string;
  lastUsed: string | null;
  created: string | null;
}

/**
 * Credentials service response
 */
export interface CredentialsResponse {
  ok: boolean;
  credentials?: MaskedCredential[];
  credential?: FullCredential;
  domain?: string;
  error?: string;
}

/**
 * CredentialsService - Manages encrypted credential storage
 */
export class CredentialsService {
  /**
   * Normalize domain name (remove protocol, trailing slash)
   * @param domain - Domain to normalize
   * @returns Normalized domain
   */
  private static normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  /**
   * List all credentials (with passwords masked)
   * @param username - The username
   * @returns Array of masked credentials
   */
  static async listCredentials(
    username: string | null | undefined
  ): Promise<CredentialsResponse> {
    try {
      if (!username) {
        return { ok: true, credentials: [] };
      }

      const credentials = await loadCredentials(username);

      // Return credentials with passwords masked for display
      const masked: MaskedCredential[] = Object.entries(credentials).map(([domain, cred]) => ({
        domain: cred.domain || domain,
        displayName: cred.displayName || domain,
        username: cred.username || '',
        hasPassword: !!cred.password,
        notes: cred.notes || '',
        lastUsed: cred.lastUsed || null,
        created: cred.created || null
      }));

      return { ok: true, credentials: masked };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CredentialsService] List error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get a specific credential
   * @param username - The username
   * @param domain - Domain to look up
   * @param includePassword - Whether to include the password in response
   * @returns Credential object (with or without password)
   */
  static async getCredential(
    username: string | null | undefined,
    domain: string,
    includePassword = false
  ): Promise<CredentialsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const credential = await getCredentialForDomain(domain, username);
      if (!credential) {
        return { ok: false, error: 'Credential not found' };
      }

      // Build result (optionally include password)
      const result: FullCredential = {
        domain: credential.domain || domain,
        displayName: credential.displayName || credential.domain || domain,
        username: credential.username || '',
        notes: credential.notes || '',
        lastUsed: credential.lastUsed || null,
        created: credential.created || null
      };

      if (includePassword) {
        result.password = credential.password || '';
      }

      return { ok: true, credential: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CredentialsService] Get error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Save or update a credential
   * @param username - The username
   * @param domain - Domain for the credential
   * @param displayName - Display name
   * @param credentialUsername - Username for the credential
   * @param password - Password (optional - keeps existing if not provided)
   * @param notes - Notes
   * @returns Success/error response with normalized domain
   */
  static async saveCredential(
    username: string | null | undefined,
    domain: string,
    displayName?: string,
    credentialUsername?: string,
    password?: string,
    notes?: string
  ): Promise<CredentialsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      if (!domain || domain.trim() === '') {
        return { ok: false, error: 'Domain is required' };
      }

      const credentials = await loadCredentials(username);
      const normalizedDomain = this.normalizeDomain(domain);

      const existingCred = credentials[normalizedDomain];

      // Create/update credential
      credentials[normalizedDomain] = {
        domain: normalizedDomain,
        displayName: displayName || normalizedDomain,
        username: credentialUsername || '',
        password: password || existingCred?.password || '', // Keep existing password if not provided
        notes: notes || '',
        lastUsed: existingCred?.lastUsed || undefined,
        created: existingCred?.created || new Date().toISOString()
      };

      await saveCredentials(credentials, username);

      console.log(`[CredentialsService] Saved credential for ${normalizedDomain}`);
      return { ok: true, domain: normalizedDomain };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CredentialsService] Save error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Delete a credential
   * @param username - The username
   * @param domain - Domain to delete
   * @returns Success/error response
   */
  static async deleteCredential(
    username: string | null | undefined,
    domain: string
  ): Promise<CredentialsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const credentials = await loadCredentials(username);
      const normalizedDomain = this.normalizeDomain(domain);

      if (!credentials[normalizedDomain]) {
        return { ok: false, error: 'Credential not found' };
      }

      delete credentials[normalizedDomain];
      await saveCredentials(credentials, username);

      console.log(`[CredentialsService] Deleted credential for ${normalizedDomain}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CredentialsService] Delete error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Update the lastUsed timestamp for a credential
   * @param username - The username
   * @param domain - Domain to update
   * @returns Success/error response
   */
  static async updateLastUsed(
    username: string | null | undefined,
    domain: string
  ): Promise<CredentialsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const credentials = await loadCredentials(username);
      const normalizedDomain = domain.toLowerCase();

      if (credentials[normalizedDomain]) {
        credentials[normalizedDomain].lastUsed = new Date().toISOString();
        await saveCredentials(credentials, username);
      }

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }
}
