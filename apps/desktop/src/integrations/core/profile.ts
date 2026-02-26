/**
 * Profile Integration
 *
 * Manages user profile information including:
 * - Personal details (name, occupation, city, etc.)
 * - Custom notes and facts
 * - User goals and priorities
 * - Onboarding progress
 *
 * Profile updates can trigger:
 * - Tutorial advancement (onboarding flow)
 * - Insights refresh (when goals change)
 */

import { promises as fs } from 'fs';
import { Integration, Tool, IntegrationContext } from '../base';
import {
  getUserProfilePath,
  parseUserProfile,
  serializeUserProfile,
  UserProfile,
} from '../../storage/profile';
import { TutorialService } from '../../services/TutorialService';

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions (imported from main.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a setting from user's settings file
 */
async function loadSetting(username: string, key: string, defaultValue: any = null): Promise<any> {
  try {
    const { getSettingsPath } = await import('../../utils/helpers');
    const settingsPath = await getSettingsPath(username);
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const keys = key.split('.');
    let value: any = settings;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }
    return value ?? defaultValue;
  } catch (err: any) {
    console.log(`[Settings] Failed to load setting ${key}:`, err.message);
    return defaultValue;
  }
}

/**
 * Trigger insights refresh (imported logic from main.js)
 * Note: This is a simplified version that just imports and calls the service
 */
async function triggerInsightsRefresh(username: string): Promise<void> {
  try {
    const limit = await loadSetting(username, 'insightsLimit', 5);

    // Import runInsightsCheck from main.js if available
    // For now, just log that we would trigger it
    console.log('[Profile] Goals changed, would trigger insights refresh with limit:', limit);

    // TODO: Once runInsightsCheck is extracted to a service, call it here
    // await InsightsService.runCheck(username, limit);
  } catch (err: any) {
    console.error('[Profile] Error triggering insights refresh:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const profileTools: Tool[] = [
  {
    name: 'get_user_profile',
    description: "Get the user's profile information.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_user_profile',
    description:
      "Update the user's profile with new information. Use this when the user shares ANY personal information - their job, family details, important dates (birthdays, anniversaries), preferences, goals, or any facts they want you to remember. Always confirm with user before updating. Use 'addNote' for custom facts. Use 'addGoal' when the user mentions a goal or priority (e.g., 'new goal: save more money', 'I want to learn Spanish', 'my goal is to buy a house').",
    input_schema: {
      type: 'object',
      properties: {
        occupation: {
          type: 'string',
          description: "User's job or profession",
        },
        city: {
          type: 'string',
          description: 'City where user lives',
        },
        homeLife: {
          type: 'string',
          description: 'Family situation - spouse, kids, pets',
        },
        dateOfBirth: {
          type: 'string',
          description: "User's birthday in any format",
        },
        onboardingCompleted: {
          type: 'boolean',
          description: 'Set true when basic info is collected',
        },
        addNote: {
          type: 'string',
          description:
            "Add a custom fact or note to remember. Use for ANY information the user wants saved: family birthdays, anniversaries, preferences, important dates, etc. Example: 'Wife\\'s birthday: November 29, 1985'",
        },
        removeNote: {
          type: 'string',
          description: 'Remove a note that contains this text',
        },
        addGoal: {
          type: 'string',
          description:
            "Add a new goal or priority. Use when user says things like 'new goal: ...', 'I want to...', 'my goal is...'. Example: 'Save more money', 'Learn Spanish', 'Buy a house by end of year'. Goals help prioritize insights from messages.",
        },
        removeGoal: {
          type: 'string',
          description: 'Remove a goal that contains this text',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeProfileTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  try {
    const username = context.currentUser?.username;
    if (!username) {
      return { error: 'Not logged in' };
    }

    const profilePath = await getUserProfilePath(username);
    const markdown = await fs.readFile(profilePath, 'utf8');
    let profile = parseUserProfile(markdown);

    // ─────────────────────────────────────────────────────────────────────────
    // Get User Profile
    // ─────────────────────────────────────────────────────────────────────────

    if (toolName === 'get_user_profile') {
      return profile;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Update User Profile
    // ─────────────────────────────────────────────────────────────────────────

    if (toolName === 'update_user_profile') {
      // Track if goals were changed
      let goalsChanged = false;
      let goalAdded = false;

      // Handle addNote
      if (toolInput.addNote) {
        if (!profile.notes) {
          profile.notes = [];
        }
        // Check if similar note already exists
        const existingIndex = profile.notes.findIndex((n) =>
          n.toLowerCase().includes(toolInput.addNote.toLowerCase().split(':')[0])
        );
        if (existingIndex >= 0) {
          // Update existing note
          profile.notes[existingIndex] = toolInput.addNote;
        } else {
          // Add new note
          profile.notes.push(toolInput.addNote);
        }
        delete toolInput.addNote;
      }

      // Handle removeNote
      if (toolInput.removeNote) {
        if (profile.notes) {
          profile.notes = profile.notes.filter(
            (n) => !n.toLowerCase().includes(toolInput.removeNote.toLowerCase())
          );
        }
        delete toolInput.removeNote;
      }

      // Handle addGoal
      if (toolInput.addGoal) {
        goalsChanged = true;
        goalAdded = true;
        if (!profile.goals) {
          profile.goals = [];
        }
        // Check if similar goal already exists
        const goalLower = toolInput.addGoal.toLowerCase();
        const existingGoal = profile.goals.find(
          (g) => g.toLowerCase().includes(goalLower) || goalLower.includes(g.toLowerCase())
        );
        if (!existingGoal) {
          // Add new goal
          profile.goals.push(toolInput.addGoal);
        }
        delete toolInput.addGoal;
      }

      // Handle removeGoal
      if (toolInput.removeGoal) {
        goalsChanged = true;
        if (profile.goals) {
          profile.goals = profile.goals.filter(
            (g) => !g.toLowerCase().includes(toolInput.removeGoal.toLowerCase())
          );
        }
        delete toolInput.removeGoal;
      }

      // Update other fields
      const { addNote, removeNote, addGoal, removeGoal, ...otherFields } = toolInput;
      Object.assign(profile, otherFields);

      // Check if we should advance onboarding from profile stage to goals_intro
      const didAdvance = await TutorialService.checkProfileUpdateAdvancement(username, profile);

      // If stage advanced, reload profile to get the updated onboardingStage
      if (didAdvance) {
        const updatedProfileText = await fs.readFile(profilePath, 'utf8');
        profile = parseUserProfile(updatedProfileText);
      }

      // Write updated profile
      const newMarkdown = serializeUserProfile(profile);
      await fs.writeFile(profilePath, newMarkdown, 'utf8');

      // Check if we should advance onboarding from goals_intro to task_demo
      let tutorialMessage = '';
      if (goalAdded) {
        const goalAdvanced = await TutorialService.checkGoalCreationAdvancement(username);
        if (goalAdvanced) {
          // Include tutorial advancement message in the tool result
          tutorialMessage = '\n\n' + TutorialService.getTaskDemoPromptMessage();
        }
      }

      // If goals were added or removed, trigger insights refresh
      // This will re-analyze recent messages with the new goal priorities
      if (goalsChanged) {
        console.log('[Profile] Goals changed, triggering insights refresh');
        // Run insights check in background
        setTimeout(async () => {
          await triggerInsightsRefresh(username);
        }, 1000);
      }

      return {
        success: true,
        profile,
        message: 'Profile updated successfully' + tutorialMessage,
      };
    }

    return { error: 'Unknown profile tool' };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const profileIntegration: Integration = {
  name: 'profile',
  category: 'core',
  tools: profileTools,
  execute: executeProfileTool,

  // Profile is always available (no authentication required)
  isAvailable: async () => true,
};
