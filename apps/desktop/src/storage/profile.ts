/**
 * User Profile Management
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getUserDataDir } from '../utils/helpers';

/**
 * Valid onboarding stages
 */
export type OnboardingStage = 'api_setup' | 'profile' | 'task_demo' | 'skill_demo' | 'integrations' | 'completed';

/**
 * Valid onboarding stages array
 */
export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  'api_setup',
  'profile',
  'task_demo',
  'skill_demo',
  'integrations',
  'completed'
];

/**
 * User profile structure
 */
export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  city: string;
  occupation: string;
  homeLife: string;
  userId: string;
  created: string;
  onboardingStage: OnboardingStage;
  onboardingSkippedAt: string | null;
  goals: string[];
  notes: string[];
}

/**
 * Get the path to the user's profile file
 * @param username - The username
 * @returns Path to profile markdown file
 */
export const getUserProfilePath = async (username: string): Promise<string> => {
  const dir = await getUserDataDir(username);
  const profilesDir = path.join(dir, 'profiles');
  await fs.mkdir(profilesDir, { recursive: true });

  // Look for existing profile or create one
  try {
    const files = await fs.readdir(profilesDir);
    const profileFile = files.find(f => f.endsWith('.md'));
    if (profileFile) {
      return path.join(profilesDir, profileFile);
    }
  } catch {
    // Directory doesn't exist yet
  }

  // Create a new profile
  const userId = crypto.randomUUID();
  const profilePath = path.join(profilesDir, `${userId}.md`);
  const defaultProfile = `# User Profile

## Basic Info
- **First Name**: User
- **Last Name**:
- **Email**:
- **Date of Birth**:
- **City**:

## Life Context
- **Occupation**:
- **Home Life**:

## Goals

## Personal Notes

## System
- **User ID**: ${userId}
- **Created**: ${new Date().toISOString()}
- **Onboarding Stage**: api_setup
- **Onboarding Skipped At**:
`;
  await fs.writeFile(profilePath, defaultProfile, 'utf8');
  return profilePath;
};

/**
 * Parse user profile from markdown
 * @param markdown - Profile markdown content
 * @returns Parsed profile object
 */
export const parseUserProfile = (markdown: string): UserProfile => {
  const profile: UserProfile = {
    firstName: '',
    lastName: '',
    email: '',
    dateOfBirth: '',
    city: '',
    occupation: '',
    homeLife: '',
    userId: '',
    created: '',
    onboardingStage: 'api_setup', // Default to api_setup for new users
    onboardingSkippedAt: null,
    goals: [], // User goals and priorities
    notes: [] // Custom facts and notes
  };

  const lines = markdown.split('\n');
  let inNotesSection = false;
  let inGoalsSection = false;

  for (const line of lines) {
    // Check if we're entering the Goals section
    if (line.match(/^##\s*Goals/i)) {
      inGoalsSection = true;
      inNotesSection = false;
      continue;
    }

    // Check if we're entering the Notes section
    if (line.match(/^##\s*Notes/i) || line.match(/^##\s*Personal Notes/i) || line.match(/^##\s*Custom Facts/i)) {
      inNotesSection = true;
      inGoalsSection = false;
      continue;
    }

    // Check if we're leaving sections (another ## header)
    if ((inNotesSection || inGoalsSection) && line.match(/^##\s/)) {
      inNotesSection = false;
      inGoalsSection = false;
    }

    // Parse goals as bullet points
    if (inGoalsSection) {
      const goalMatch = line.match(/^\s*-\s+(.+)$/);
      if (goalMatch) {
        profile.goals.push(goalMatch[1].trim());
      }
      continue;
    }

    // Parse notes as bullet points
    if (inNotesSection) {
      const noteMatch = line.match(/^\s*-\s+(.+)$/);
      if (noteMatch) {
        profile.notes.push(noteMatch[1].trim());
      }
      continue;
    }

    // Parse structured fields
    const match = line.match(/^\s*-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();

      switch (key) {
        case 'First Name':
          profile.firstName = value;
          break;
        case 'Last Name':
          profile.lastName = value;
          break;
        case 'Email':
          profile.email = value;
          break;
        case 'Date of Birth':
          profile.dateOfBirth = value;
          break;
        case 'City':
          profile.city = value;
          break;
        case 'Occupation':
          profile.occupation = value;
          break;
        case 'Home Life':
          profile.homeLife = value;
          break;
        case 'User ID':
          profile.userId = value;
          break;
        case 'Created':
          profile.created = value;
          break;
        // Legacy field - convert to new stage system
        case 'Onboarding Completed':
          if (value.toLowerCase() === 'true') {
            profile.onboardingStage = 'completed';
          }
          break;
        case 'Onboarding Stage':
          if (ONBOARDING_STAGES.includes(value as OnboardingStage)) {
            profile.onboardingStage = value as OnboardingStage;
          }
          break;
        case 'Onboarding Skipped At':
          profile.onboardingSkippedAt = value || null;
          break;
      }
    }
  }
  return profile;
};

/**
 * Serialize profile object to markdown
 * @param profile - Profile object to serialize
 * @returns Markdown string
 */
export const serializeUserProfile = (profile: UserProfile): string => {
  let markdown = `# User Profile

## Basic Info
- **First Name**: ${profile.firstName || ''}
- **Last Name**: ${profile.lastName || ''}
- **Email**: ${profile.email || ''}
- **Date of Birth**: ${profile.dateOfBirth || ''}
- **City**: ${profile.city || ''}

## Life Context
- **Occupation**: ${profile.occupation || ''}
- **Home Life**: ${profile.homeLife || ''}

## Goals
`;

  // Add goals
  if (profile.goals && profile.goals.length > 0) {
    for (const goal of profile.goals) {
      markdown += `- ${goal}\n`;
    }
  }

  markdown += `
## Personal Notes
`;

  // Add notes
  if (profile.notes && profile.notes.length > 0) {
    for (const note of profile.notes) {
      markdown += `- ${note}\n`;
    }
  }

  markdown += `
## System
- **User ID**: ${profile.userId || ''}
- **Created**: ${profile.created || ''}
- **Onboarding Stage**: ${profile.onboardingStage || 'api_setup'}
- **Onboarding Skipped At**: ${profile.onboardingSkippedAt || ''}
`;

  return markdown;
};
