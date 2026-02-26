/**
 * Tutorial Service
 *
 * Unified service for managing the onboarding tutorial flow.
 * Consolidates all tutorial-related logic previously scattered in main.js
 *
 * Responsibilities:
 * - Stage progression tracking
 * - Message processing during tutorial stages
 * - Advancement condition checking
 * - Tutorial mode determination
 * - Stage-specific welcome messages
 */

import { promises as fs } from 'fs';
import path from 'path';

// Import OnboardingStage type
import { OnboardingStage } from '../storage/profile';

// @ts-ignore - compiled service
import { ProfileService } from './profile';

export interface TutorialStageResult {
  shouldAdvance: boolean;
  nextStage?: string;
  response?: string;
  updatedFields?: Record<string, any>;
}

export interface TutorialProcessResult {
  useTutorialMode: boolean;
  response?: string;
  shouldAdvance?: boolean;
  nextStage?: string;
  updatedFields?: Record<string, any>;
}

export interface StageWelcomeMessage {
  message: string;
  needsApiSetup?: boolean;
  needsOnboarding?: boolean;
}

/**
 * Profile fields collected during onboarding
 */
const PROFILE_QUESTIONS = [
  {
    field: 'firstName',
    question: 'What should I call you? (Just your first name is fine!)',
    followUp: null,
  },
  { field: 'occupation', question: 'What do you do for work?', followUp: "That's interesting!" },
  { field: 'city', question: 'Where are you based?', followUp: 'Nice!' },
  {
    field: 'homeLife',
    question: 'Tell me about your household - roommates, family, pets?',
    followUp: 'Got it!',
  },
];

/**
 * TutorialService - Manages the multi-stage onboarding tutorial
 */
export class TutorialService {
  private static readonly STAGES = [
    'api_setup',
    'profile',
    'goals_intro',
    'task_demo',
    'skill_demo',
    'integrations',
    'completed',
  ];

  /**
   * Check if user is currently in an active onboarding stage
   */
  static isInOnboarding(profile: any): boolean {
    return !!(profile && profile.onboardingStage && profile.onboardingStage !== 'completed');
  }

  /**
   * Get the next stage in the sequence
   */
  static getNextStage(currentStage: string): string {
    const currentIndex = this.STAGES.indexOf(currentStage);
    if (currentIndex === -1 || currentIndex >= this.STAGES.length - 1) {
      return 'completed';
    }
    return this.STAGES[currentIndex + 1];
  }

  /**
   * Determine which profile field to ask about next
   */
  private static getNextProfileQuestion(profile: any) {
    for (const q of PROFILE_QUESTIONS) {
      const value = profile[q.field];
      if (!value || value === 'User' || value.trim() === '') {
        return q;
      }
    }
    return null;
  }

  /**
   * Check if profile collection is complete
   */
  static isProfileComplete(profile: any): boolean {
    const hasName =
      profile.firstName && profile.firstName !== 'User' && profile.firstName.trim() !== '';
    const hasContext = profile.occupation || profile.city || profile.homeLife;
    return hasName && hasContext;
  }

  /**
   * Process a message during the profile collection stage
   */
  static async processProfileStageMessage(
    userMessage: string,
    profile: any
  ): Promise<TutorialStageResult> {
    const currentQuestion = this.getNextProfileQuestion(profile);

    if (!currentQuestion) {
      return {
        shouldAdvance: true,
        updatedFields: {},
      };
    }

    const updatedFields: Record<string, any> = {};
    const fieldName = currentQuestion.field;

    let answer = userMessage.trim();

    // Special handling for firstName field
    if (fieldName === 'firstName') {
      const patterns = [
        /^(?:my name is|i'm|i am|call me|it's|its)\s+/i,
        /^(?:hi,?\s*)?(?:my name is|i'm|i am)\s+/i,
      ];
      for (const pattern of patterns) {
        answer = answer.replace(pattern, '');
      }

      const words = answer.split(/\s+/);
      if (words.length > 1 && words[0].length <= 15) {
        if (/^[A-Z][a-z]+$/.test(words[0]) || words[0].length <= 10) {
          answer = words[0];
        }
      }
      answer = answer.charAt(0).toUpperCase() + answer.slice(1).toLowerCase();
    }

    updatedFields[fieldName] = answer;

    const tempProfile = { ...profile, ...updatedFields };
    const nextQuestion = this.getNextProfileQuestion(tempProfile);

    let response;
    if (nextQuestion) {
      const followUp = currentQuestion.followUp ? `${currentQuestion.followUp} ` : '';
      response = `${followUp}${nextQuestion.question}`;
    } else {
      response = `Got it! I've saved your profile.\n\nBy the way, you can always tell me more about yourself anytime. Just share facts like your spouse's name, your pet's name, allergies, important dates, or preferences - and I'll ask if you want me to remember them.`;
    }

    return {
      response,
      shouldAdvance: !nextQuestion,
      updatedFields,
    };
  }

  /**
   * Get the welcome message for a specific stage
   */
  static getStageWelcomeMessage(
    stage: string,
    profile: any,
    timeOfDay?: string
  ): StageWelcomeMessage | null {
    const greeting =
      timeOfDay === 'morning'
        ? 'Good morning'
        : timeOfDay === 'afternoon'
          ? 'Good afternoon'
          : timeOfDay === 'evening'
            ? 'Good evening'
            : 'Hey there';

    switch (stage) {
      case 'api_setup':
        return {
          message: `Welcome to Wovly! I'm your AI assistant.\n\nTo get started, you'll need to connect me to an AI provider. Head to **Settings** and add an API key from Anthropic, OpenAI, or Google.\n\nOnce configured, I'll help you set up your profile and show you what I can do!`,
          needsApiSetup: true,
        };

      case 'profile':
        return {
          message: `${greeting}! Great, you're all set up! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)`,
          needsOnboarding: true,
        };

      case 'goals_intro':
        return {
          message: `Perfect! Now let me tell you about **Goals** - this is central to how Wovly works.\n\n**Goals help me:**\n- Extract insights from your messages that matter to YOU\n- Prioritize what's important in your communication\n- Surface relevant information at the right time\n\n**Examples of goals:**\n- "I want to prioritize my kids' events and pick-up times"\n- "I want to save money and track spending"\n- "I want to stay on top of work deadlines"\n- "I want to maintain relationships with friends and family"\n\nLet's create your first goal! Just say:\n**"Create a new goal: [your goal]"**\n\nFor example: *"Create a new goal: I want to prioritize my kids' events"*`,
          needsOnboarding: true,
        };

      case 'task_demo':
        return {
          message: `Now let's see Wovly in action! Try creating your first task.\n\nType something like: **"Remind me to eat lunch at 12pm tomorrow"**\n\nTasks run in the background and can monitor, remind, and take actions for you.`,
          needsOnboarding: true,
        };

      case 'skill_demo':
        return {
          message: `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`,
          needsOnboarding: true,
        };

      case 'integrations':
        return {
          message: `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.`,
          needsOnboarding: true,
        };

      default:
        return null;
    }
  }

  /**
   * Check if a message should trigger stage advancement
   */
  static async checkStageAdvancement(
    stage: string,
    userMessage: string,
    context: { lastResponse?: string }
  ): Promise<TutorialStageResult | null> {
    const msgLower = userMessage.toLowerCase().trim();

    switch (stage) {
      case 'integrations':
        if (
          msgLower === 'skip' ||
          msgLower === 'skip onboarding' ||
          msgLower === 'skip integrations'
        ) {
          return {
            shouldAdvance: true,
            nextStage: 'completed',
            response:
              "Great! You've completed the onboarding. Feel free to explore and ask me anything!\n\nRemember, you can always tell me facts about yourself and I'll help you save them to your profile. Just share things like birthdays, preferences, or important dates.",
          };
        }
        break;

      case 'skill_demo':
        if (
          msgLower.includes('marco') &&
          context.lastResponse &&
          context.lastResponse.toLowerCase().includes('polo')
        ) {
          return {
            shouldAdvance: true,
            nextStage: 'integrations',
          };
        }
        break;
    }

    return null;
  }

  /**
   * Determine if a message should be processed in tutorial mode
   * Tutorial mode bypasses task decomposition and other advanced features
   */
  static shouldUseTutorialMode(stage: string, userMessage: string): boolean {
    if (!stage || stage === 'completed') {
      return false;
    }

    if (stage === 'profile') {
      return true;
    }

    if (stage === 'goals_intro') {
      const msgLower = userMessage.toLowerCase();
      // Let goal creation flow through to normal processing
      if (msgLower.includes('goal') || msgLower.includes('create')) {
        return false;
      }
      return true;
    }

    if (stage === 'task_demo') {
      const msgLower = userMessage.toLowerCase();
      if (
        msgLower.includes('remind') ||
        msgLower.includes('task') ||
        msgLower.includes('alert') ||
        msgLower.includes('notify') ||
        msgLower.includes('check') ||
        msgLower.includes('monitor')
      ) {
        return false;
      }
      return true;
    }

    if (stage === 'skill_demo') {
      const msgLower = userMessage.toLowerCase();
      if (
        msgLower.includes('skill') ||
        msgLower.includes('create') ||
        msgLower.includes('teach') ||
        msgLower.includes('marco')
      ) {
        return false;
      }
      return true;
    }

    if (stage === 'integrations') {
      const msgLower = userMessage.toLowerCase().trim();
      if (msgLower === 'skip' || msgLower.includes('skip')) {
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Generate a tutorial-mode response
   */
  static generateTutorialResponse(stage: string, userMessage: string): string | null {
    switch (stage) {
      case 'goals_intro':
        return `Let's create your first goal! Goals help me understand what's important to you.\n\nJust say: **"Create a new goal: [your goal]"**\n\n**Examples:**\n- "Create a new goal: I want to prioritize my kids' events and pick-up times"\n- "Create a new goal: I want to save money and track spending"\n- "Create a new goal: I want to stay on top of work deadlines"`;

      case 'task_demo':
        return `I'm ready to help you create your first task! Try typing something like:\n\n**"Remind me to eat lunch at 12pm tomorrow"**\n\nor\n\n**"Check my email every hour and notify me of important messages"**`;

      case 'skill_demo':
        return `Let's create a skill together! Try typing:\n\n**"Create a skill where if I say marco you say polo"**\n\nSkills teach me custom procedures that I can follow whenever you need them.`;

      case 'integrations':
        if (userMessage.toLowerCase().includes('skip')) {
          return "Great! You've completed the onboarding.";
        }
        return `You can connect integrations from the **Integrations** page in the sidebar.\n\nOr say **"skip"** to finish onboarding and explore on your own.`;

      default:
        return null;
    }
  }

  /**
   * Check if skill demo was completed (Marco/Polo test)
   * Called after assistant response is generated
   */
  static async checkSkillDemoCompletion(
    userMessage: string,
    assistantResponse: string,
    username: string
  ): Promise<{ advanced: boolean; message?: string }> {
    try {
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return { advanced: false };
      }

      const profile = profileResult.profile;

      if (profile.onboardingStage === 'skill_demo') {
        const userSaidMarco = userMessage.toLowerCase().includes('marco');
        const responseSaidPolo = assistantResponse.toLowerCase().includes('polo');

        if (userSaidMarco && responseSaidPolo) {
          console.log('[Tutorial] Skill test passed (Marco/Polo), advancing to integrations');

          await ProfileService.updateProfile(username, {
            onboardingStage: 'integrations',
          });

          const welcomeMsg = this.getStageWelcomeMessage('integrations', profile);

          return {
            advanced: true,
            message: welcomeMsg?.message,
          };
        }
      }

      return { advanced: false };
    } catch (err) {
      console.error('[Tutorial] Error checking skill demo completion:', err);
      return { advanced: false };
    }
  }

  /**
   * Check if task creation should advance from task_demo stage
   */
  static async checkTaskCreationAdvancement(username: string): Promise<boolean> {
    try {
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return false;
      }

      const profile = profileResult.profile;

      if (profile.onboardingStage === 'task_demo') {
        console.log('[Tutorial] First task created, advancing to skill_demo');

        await ProfileService.updateProfile(username, {
          onboardingStage: 'skill_demo',
        });

        return true;
      }

      return false;
    } catch (err) {
      console.error('[Tutorial] Error checking task creation advancement:', err);
      return false;
    }
  }

  /**
   * Get the skill demo prompt message
   */
  static getSkillDemoPromptMessage(): string {
    return `Great job creating your first task! 🎉\n\nNow let's try something even more powerful - **Skills**. Skills teach me custom procedures that I can follow.\n\nTry typing: **"Create a skill where if I say marco you say polo"**`;
  }

  /**
   * Check if profile update should advance from profile stage
   */
  static async checkProfileUpdateAdvancement(username: string, profile: any): Promise<boolean> {
    try {
      if (profile.onboardingStage === 'profile') {
        const hasBasicInfo =
          profile.firstName && profile.firstName !== 'User' && profile.firstName !== '';
        const hasContextInfo = profile.occupation || profile.city || profile.homeLife;

        if (hasBasicInfo && hasContextInfo) {
          console.log('[Tutorial] Profile info collected, advancing to goals_intro');

          await ProfileService.updateProfile(username, {
            onboardingStage: 'goals_intro',
          });

          return true;
        }
      }

      return false;
    } catch (err) {
      console.error('[Tutorial] Error checking profile advancement:', err);
      return false;
    }
  }

  /**
   * Check if goal creation should advance from goals_intro stage
   */
  static async checkGoalCreationAdvancement(username: string): Promise<boolean> {
    try {
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return false;
      }

      const profile = profileResult.profile;

      if (profile.onboardingStage === 'goals_intro') {
        // Check if user has at least one goal
        const hasGoals = profile.goals && profile.goals.length > 0;

        if (hasGoals) {
          console.log('[Tutorial] First goal created, advancing to task_demo');

          await ProfileService.updateProfile(username, {
            onboardingStage: 'task_demo',
          });

          return true;
        }
      }

      return false;
    } catch (err) {
      console.error('[Tutorial] Error checking goal creation advancement:', err);
      return false;
    }
  }

  /**
   * Get the task demo prompt message after goal creation
   */
  static getTaskDemoPromptMessage(): string {
    return `Perfect! Your goal has been saved. 🎯\n\nNow let's explore **Tasks**. Tasks run in the background and can help you stay on top of things.\n\nTry creating a task:\n**"Remind me to eat lunch at 12pm tomorrow"**`;
  }

  /**
   * Check if skill creation should show prompt during skill_demo stage
   */
  static async checkSkillCreationMessage(username: string): Promise<string> {
    try {
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return '';
      }

      const profile = profileResult.profile;

      if (profile.onboardingStage === 'skill_demo') {
        console.log('[Tutorial] Skill created during skill_demo, prompting to test it');
        return `\n\nYour skill is ready! Now test it by saying **"Marco"** and see what happens.`;
      }

      return '';
    } catch (err) {
      console.error('[Tutorial] Error checking skill creation:', err);
      return '';
    }
  }

  /**
   * Process a message in tutorial mode
   * Returns tutorial response if applicable, or null to continue normal flow
   */
  static async processTutorialMessage(
    userMessage: string,
    username: string,
    lastResponse?: string
  ): Promise<TutorialProcessResult> {
    try {
      const profileResult = await ProfileService.getProfile(username);
      if (!profileResult.ok || !profileResult.profile) {
        return { useTutorialMode: false };
      }

      const profile = profileResult.profile;
      const currentStage = profile.onboardingStage || 'completed';
      const msgLower = userMessage.toLowerCase().trim();

      // Handle "skip tutorial" command
      if (msgLower === 'skip tutorial' || msgLower === 'skip onboarding' || msgLower === 'skip') {
        console.log('[Tutorial] User requested to skip tutorial');
        await ProfileService.updateProfile(username, {
          onboardingStage: 'completed',
        });

        return {
          useTutorialMode: true,
          response: 'Got it! Tutorial skipped. You can now use Wovly freely. Ask me anything!',
          shouldAdvance: true,
          nextStage: 'completed',
        };
      }

      // Handle "continue tutorial" command
      if (
        msgLower === 'continue tutorial' ||
        msgLower === 'continue' ||
        msgLower === 'yes continue' ||
        msgLower === 'yes'
      ) {
        console.log(`[Tutorial] User requested to continue tutorial from stage: ${currentStage}`);

        // Show the actual tutorial content for the current stage
        let tutorialContent = '';
        switch (currentStage) {
          case 'profile':
            tutorialContent =
              'Great! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)';
            break;
          case 'goals_intro':
            tutorialContent = `Perfect! Now let me tell you about **Goals** - this is central to how Wovly works.\n\n**Goals help me:**\n- Extract insights from your messages that matter to YOU\n- Prioritize what's important in your communication\n- Surface relevant information at the right time\n\n**Examples of goals:**\n- "I want to prioritize my kids' events and pick-up times"\n- "I want to save money and track spending"\n- "I want to stay on top of work deadlines"\n- "I want to maintain relationships with friends and family"\n\nLet's create your first goal! Just say:\n**"Create a new goal: [your goal]"**\n\nFor example: *"Create a new goal: I want to prioritize my kids' events"*`;
            break;
          case 'task_demo':
            tutorialContent = `Now let's see Wovly in action! Try creating your first task.\n\nType something like: **"Remind me to eat lunch at 12pm tomorrow"**\n\nTasks run in the background and can monitor, remind, and take actions for you.`;
            break;
          case 'skill_demo':
            tutorialContent = `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`;
            break;
          case 'integrations':
            tutorialContent = `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.`;
            break;
          default:
            tutorialContent = "Let's continue with the tutorial!";
        }

        return {
          useTutorialMode: true,
          response: tutorialContent,
        };
      }

      // Check if we should use tutorial mode
      const useTutorialMode = this.shouldUseTutorialMode(currentStage, userMessage);

      if (!useTutorialMode) {
        return { useTutorialMode: false };
      }

      console.log(`[Tutorial] Processing message in tutorial mode (stage: ${currentStage})`);

      // Check for stage advancement
      const advancement = await this.checkStageAdvancement(currentStage, userMessage, {
        lastResponse,
      });

      if (advancement && advancement.shouldAdvance) {
        console.log(`[Tutorial] Advancing from ${currentStage} to ${advancement.nextStage}`);

        await ProfileService.updateProfile(username, {
          onboardingStage: advancement.nextStage! as OnboardingStage,
        });

        if (advancement.response) {
          return {
            useTutorialMode: true,
            response: advancement.response,
            shouldAdvance: true,
            nextStage: advancement.nextStage,
          };
        }

        const welcomeMsg = this.getStageWelcomeMessage(advancement.nextStage!, profile);
        if (welcomeMsg) {
          return {
            useTutorialMode: true,
            response: welcomeMsg.message,
            shouldAdvance: true,
            nextStage: advancement.nextStage,
          };
        }
      }

      // Handle profile stage
      if (currentStage === 'profile') {
        console.log(`[Tutorial] Processing profile collection`);
        const result = await this.processProfileStageMessage(userMessage, profile);

        if (result.updatedFields && Object.keys(result.updatedFields).length > 0) {
          await ProfileService.updateProfile(username, result.updatedFields);

          if (result.shouldAdvance) {
            console.log(`[Tutorial] Profile complete, advancing to goals_intro`);
            await ProfileService.updateProfile(username, {
              onboardingStage: 'goals_intro',
            });

            // Show goals intro welcome after brief delay
            const goalsIntroWelcome = this.getStageWelcomeMessage('goals_intro', profile);
            const finalResponse = result.response
              ? `${result.response}\n\n${goalsIntroWelcome?.message || ''}`
              : goalsIntroWelcome?.message || '';

            return {
              useTutorialMode: true,
              response: finalResponse,
              shouldAdvance: true,
              nextStage: 'task_demo',
              updatedFields: result.updatedFields,
            };
          }

          return {
            useTutorialMode: true,
            response: result.response,
            updatedFields: result.updatedFields,
          };
        }
      }

      // For other stages, generate guidance response
      const tutorialResponse = this.generateTutorialResponse(currentStage, userMessage);
      if (tutorialResponse) {
        return {
          useTutorialMode: true,
          response: tutorialResponse,
        };
      }

      return { useTutorialMode: false };
    } catch (err) {
      console.error('[Tutorial] Error processing tutorial message:', err);
      return { useTutorialMode: false };
    }
  }
}
