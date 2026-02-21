/**
 * Onboarding Service
 * Handles user onboarding flow, stage tracking, and completion status
 */

import { promises as fs } from 'fs';
import path from 'path';

// Import OnboardingStage type
import { OnboardingStage, ONBOARDING_STAGES } from '../storage/profile';

// @ts-ignore - compiled service
import { SettingsService } from './settings';

// @ts-ignore - compiled service
import { ProfileService } from './profile';

// Import utility functions
import { getTasksDir } from '../tasks';
import { getSkillsDir } from '../storage/skills';

/**
 * Onboarding status response
 */
export interface OnboardingStatus {
  stage: string;
  skippedAt: string | null;
  hasApiKeys: boolean;
  hasTask: boolean;
  hasSkill: boolean;
  hasIntegrations: boolean;
  profileComplete: boolean;
}

/**
 * Service response
 */
export interface OnboardingResponse {
  ok: boolean;
  status?: OnboardingStatus;
  stage?: string;
  error?: string;
}

/**
 * OnboardingService - Manages user onboarding flow
 */
export class OnboardingService {
  /**
   * Get comprehensive onboarding status for user
   * @param username - Current username
   * @returns Onboarding status with completion flags
   */
  static async getStatus(username: string | null | undefined): Promise<OnboardingResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Get settings to check API keys and integrations
      const settingsResult = await SettingsService.getSettings(username);
      const settings = settingsResult.settings || {};

      // Check for any LLM API keys
      const hasApiKeys = !!(
        settings.anthropicApiKey ||
        settings.openaiApiKey ||
        settings.googleApiKey ||
        settings.deepseekApiKey ||
        settings.ollamaEndpoint
      );

      // Check for integrations
      const hasIntegrations = !!(
        settings.googleAccessToken ||
        settings.slackAccessToken ||
        settings.weatherEnabled ||
        settings.browserEnabled ||
        settings.telegramToken ||
        settings.discordAccessToken ||
        settings.notionAccessToken ||
        settings.githubAccessToken
      );

      // Get profile to check onboarding stage
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return { ok: false, error: 'Failed to load profile' };
      }

      const profile = profileResult.profile;

      // Check if user has created any tasks
      const hasTask = await this.hasUserTasks(username);

      // Check if user has created any skills
      const hasSkill = await this.hasUserSkills(username);

      // Check if profile is complete
      const profileComplete = !!(
        profile.firstName &&
        profile.firstName !== 'User' &&
        profile.occupation
      );

      const status: OnboardingStatus = {
        stage: profile.onboardingStage || 'welcome',
        skippedAt: profile.onboardingSkippedAt || null,
        hasApiKeys,
        hasTask,
        hasSkill,
        hasIntegrations,
        profileComplete
      };

      console.log(
        `[Onboarding] Status: stage=${status.stage}, hasApiKeys=${hasApiKeys}, ` +
        `hasTask=${hasTask}, hasSkill=${hasSkill}, hasIntegrations=${hasIntegrations}`
      );

      return { ok: true, status };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Onboarding] Error getting status:', error);
      return { ok: false, error };
    }
  }

  /**
   * Set onboarding stage for user
   * @param username - Current username
   * @param stage - New stage to set
   * @returns Success/error response with stage
   */
  static async setStage(
    username: string | null | undefined,
    stage: OnboardingStage
  ): Promise<OnboardingResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Validate stage
      if (!ONBOARDING_STAGES.includes(stage)) {
        return {
          ok: false,
          error: `Invalid stage: ${stage}. Valid stages: ${ONBOARDING_STAGES.join(', ')}`
        };
      }

      // Get current profile
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return { ok: false, error: 'Failed to load profile' };
      }

      const currentStage = profileResult.profile.onboardingStage;

      // Update onboarding stage
      const updateResult = await ProfileService.updateProfile(username, {
        onboardingStage: stage,
        // Clear skipped status when advancing to a new stage
        ...(stage !== currentStage && { onboardingSkippedAt: null })
      });

      if (!updateResult.ok) {
        return { ok: false, error: updateResult.error || 'Failed to update profile' };
      }

      console.log(`[Onboarding] Set stage to: ${stage}`);

      return { ok: true, stage };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Onboarding] Error setting stage:', error);
      return { ok: false, error };
    }
  }

  /**
   * Skip onboarding and mark as completed
   * @param username - Current username
   * @returns Success/error response
   */
  static async skip(username: string | null | undefined): Promise<OnboardingResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Set stage to completed and record skip timestamp
      const updateResult = await ProfileService.updateProfile(username, {
        onboardingStage: 'completed',
        onboardingSkippedAt: new Date().toISOString()
      });

      if (!updateResult.ok) {
        return { ok: false, error: updateResult.error || 'Failed to update profile' };
      }

      console.log('[Onboarding] Skipped onboarding');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Onboarding] Error skipping:', error);
      return { ok: false, error };
    }
  }

  /**
   * Check if user has created any tasks
   * @param username - Username to check
   * @returns True if user has at least one task
   */
  private static async hasUserTasks(username: string): Promise<boolean> {
    try {
      const tasksDir = await getTasksDir(username);
      const files = await fs.readdir(tasksDir);
      return files.some(f => f.endsWith('.md'));
    } catch {
      return false;
    }
  }

  /**
   * Check if user has created any skills
   * @param username - Username to check
   * @returns True if user has at least one skill
   */
  private static async hasUserSkills(username: string): Promise<boolean> {
    try {
      const skillsDir = await getSkillsDir(username);
      const files = await fs.readdir(skillsDir);
      return files.some(f => f.endsWith('.md'));
    } catch {
      return false;
    }
  }
}
