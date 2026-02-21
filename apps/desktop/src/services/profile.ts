/**
 * Profile Service
 * Handles user profile operations including CRUD, onboarding, and fact management
 */

import { promises as fs } from 'fs';
import {
  UserProfile,
  getUserProfilePath,
  parseUserProfile,
  serializeUserProfile
} from '../storage/profile';

/**
 * Profile service response
 */
export interface ProfileResponse {
  ok: boolean;
  profile?: UserProfile;
  error?: string;
  needsOnboarding?: boolean;
  markdown?: string;
}

/**
 * Fact to be added to profile
 */
export interface ProfileFact {
  summary: string;
  confidence?: number;
}

/**
 * Conflict resolution for duplicate facts
 */
export interface ConflictResolution {
  existingNote: string;
  newFact: string;
  keepNew: boolean; // If true, remove existing and add new; if false, keep existing
}

/**
 * ProfileService - Manages user profiles
 */
export class ProfileService {
  /**
   * Get user profile
   * @param username - The username to get profile for
   * @returns Profile object or error
   */
  static async getProfile(username: string | null | undefined): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const profilePath = await getUserProfilePath(username);
      const markdown = await fs.readFile(profilePath, 'utf8');
      const profile = parseUserProfile(markdown);

      return { ok: true, profile };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Update user profile (merge updates)
   * @param username - The username
   * @param updates - Partial profile updates to merge
   * @returns Updated profile or error
   */
  static async updateProfile(
    username: string | null | undefined,
    updates: Partial<UserProfile>
  ): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const profilePath = await getUserProfilePath(username);
      const markdown = await fs.readFile(profilePath, 'utf8');
      const profile = parseUserProfile(markdown);

      // Merge updates
      Object.assign(profile, updates);

      // Serialize and save
      const newMarkdown = serializeUserProfile(profile);
      await fs.writeFile(profilePath, newMarkdown, 'utf8');

      return { ok: true, profile };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Check if user needs onboarding
   * @param username - The username
   * @returns Whether user needs onboarding and their profile
   */
  static async needsOnboarding(username: string | null | undefined): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: true, needsOnboarding: false };
      }

      const profilePath = await getUserProfilePath(username);
      const markdown = await fs.readFile(profilePath, 'utf8');
      const profile = parseUserProfile(markdown);

      // Use the onboardingStage field
      const needsOnboarding = profile.onboardingStage !== 'completed';

      return { ok: true, needsOnboarding, profile };
    } catch {
      // If profile doesn't exist or error reading, assume no onboarding needed
      return { ok: true, needsOnboarding: false };
    }
  }

  /**
   * Add facts to profile with conflict resolution
   * @param username - The username
   * @param facts - Facts to add
   * @param conflictResolutions - How to resolve conflicts with existing notes
   * @returns Success/error response
   */
  static async addFacts(
    username: string | null | undefined,
    facts: ProfileFact[],
    conflictResolutions?: ConflictResolution[]
  ): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const profilePath = await getUserProfilePath(username);
      const markdown = await fs.readFile(profilePath, 'utf8');
      const profile = parseUserProfile(markdown);

      // Initialize notes array if needed
      profile.notes = profile.notes || [];

      // Handle conflict resolutions (remove old notes that are being replaced)
      if (conflictResolutions && conflictResolutions.length > 0) {
        for (const resolution of conflictResolutions) {
          if (resolution.keepNew) {
            // Remove the old conflicting note
            const existingIndex = profile.notes.findIndex(n => n === resolution.existingNote);
            if (existingIndex > -1) {
              console.log(`[ProfileService] Removing conflicting note: "${resolution.existingNote}"`);
              profile.notes.splice(existingIndex, 1);
            }
          }
        }
      }

      // Add facts (skip those where user chose to keep existing)
      for (const fact of facts) {
        const conflictRes = conflictResolutions?.find(r => r.newFact === fact.summary);
        if (conflictRes && !conflictRes.keepNew) {
          console.log(`[ProfileService] Skipping fact (user kept existing): "${fact.summary}"`);
          continue; // User chose to keep existing, don't add new
        }
        console.log(`[ProfileService] Adding fact: "${fact.summary}"`);
        profile.notes.push(fact.summary);
      }

      // Save updated profile
      await fs.writeFile(profilePath, serializeUserProfile(profile), 'utf8');
      console.log(`[ProfileService] Saved profile with ${profile.notes.length} notes`);

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ProfileService] Error adding facts:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get raw profile markdown
   * @param username - The username
   * @returns Raw markdown content
   */
  static async getMarkdown(username: string | null | undefined): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const profilePath = await getUserProfilePath(username);
      const markdown = await fs.readFile(profilePath, 'utf8');

      return { ok: true, markdown };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ProfileService] Error reading markdown:', error);
      return { ok: false, error };
    }
  }

  /**
   * Save raw profile markdown
   * @param username - The username
   * @param markdown - Raw markdown to save
   * @returns Success/error response
   */
  static async saveMarkdown(
    username: string | null | undefined,
    markdown: string
  ): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const profilePath = await getUserProfilePath(username);
      await fs.writeFile(profilePath, markdown, 'utf8');
      console.log('[ProfileService] Saved profile markdown');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ProfileService] Error saving markdown:', error);
      return { ok: false, error };
    }
  }

  /**
   * Update a specific field in the profile
   * @param username - The username
   * @param field - Field name to update
   * @param value - New value
   * @returns Updated profile or error
   */
  static async updateField(
    username: string | null | undefined,
    field: keyof UserProfile,
    value: unknown
  ): Promise<ProfileResponse> {
    return this.updateProfile(username, { [field]: value } as Partial<UserProfile>);
  }
}
