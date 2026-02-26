/**
 * Welcome Service
 * Handles welcome message generation with personalized context
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface WelcomeResponse {
  ok: boolean;
  error?: string;
  message?: string;
  needsOnboarding?: boolean;
  timeOfDay?: string;
  hour?: number;
  dayOfWeek?: string;
  profile?: any;
  todayEventCount?: number;
  tomorrowEventCount?: number;
  profileQuestion?: {
    question: string;
    context: string;
    category: 'contact' | 'activity' | 'goal' | 'preference' | 'location' | 'relationship';
  };
}

interface WelcomeDependencies {
  getUserProfilePath: (username: string) => string;
  parseUserProfile: (text: string) => any;
  getGoogleAccessToken: (username: string) => Promise<string | null>;
  getSettingsPath: (username: string) => Promise<string>;
  getAvailableCredentialDomains?: (username: string) => Promise<string[]>;
  getUserDataDir: (username: string) => Promise<string>;
}

export class WelcomeService {
  /**
   * Generate a contextual question to extract user facts
   */
  private static async generateProfileQuestion(
    username: string,
    profile: any,
    apiKeys: any,
    activeProvider: string,
    models: any,
    deps: WelcomeDependencies
  ): Promise<{
    question: string;
    context: string;
    category: 'contact' | 'activity' | 'goal' | 'preference' | 'location' | 'relationship';
  } | null> {
    try {
      // Load recent chat history (last 7 days)
      const userDataDir = await deps.getUserDataDir(username);
      const memoryDir = path.join(userDataDir, 'memory', 'daily');

      let recentContext = '';
      const today = new Date();

      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const memoryPath = path.join(memoryDir, `${dateStr}.md`);

        try {
          const content = await fs.readFile(memoryPath, 'utf8');
          // Extract just the facts/events, skip summary sections
          const facts = content
            .split('\n')
            .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('**Summary'))
            .slice(0, 50) // Limit to prevent token overflow
            .join('\n');
          recentContext += `\n${dateStr}:\n${facts}`;
        } catch (err) {
          // Skip missing files
        }
      }

      if (!recentContext.trim()) {
        // No recent activity to analyze
        return null;
      }

      // Build prompt for question generation
      const questionPrompt = `You are analyzing a user's recent activity to help build their personal profile.

**User Profile:**
Name: ${profile.name || username}
${profile.role ? `Role: ${profile.role}` : ''}
${profile.goals && profile.goals.length > 0 ? `Goals: ${profile.goals.join(', ')}` : 'No goals set'}
${profile.interests && profile.interests.length > 0 ? `Interests: ${profile.interests.join(', ')}` : ''}

**Recent Activity (last 7 days):**
${recentContext.slice(0, 3000)}

**Your Task:**
Analyze the recent activity and generate ONE smart question to extract or confirm a personal fact. The question should:
1. Be natural and conversational (not interrogative)
2. Help fill gaps in their profile (contacts, activities, preferences, goals, locations)
3. Be based on concrete evidence from their activity
4. Be easy to answer with a yes/no or short response

**Question Types (pick the most relevant):**
- **Contact verification**: "Based on your messages, is [phone/email] your [relationship] [name]?"
- **Activity clarification**: "I see you have [event] every [frequency]. What is this for?"
- **Goal linkage**: "You've been messaging about [topic] a lot. Is this related to one of your goals?"
- **Preference extraction**: "I noticed you often [action]. Is this a regular preference?"
- **Relationship clarification**: "You message [name] frequently. What's your relationship with them?"

**IMPORTANT:**
- If there's not enough concrete data to ask a smart question, return "SKIP"
- Don't ask about obvious things already in their profile
- Don't make assumptions - only ask about things you have evidence for
- Keep the question under 25 words

Return ONLY your response in this exact format:
CATEGORY: [contact|activity|goal|preference|location|relationship|SKIP]
QUESTION: [your question]
CONTEXT: [brief explanation of what you observed]`;

      // Call LLM to generate question
      let llmResponse = '';

      if (activeProvider === 'anthropic' && apiKeys.anthropic) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKeys.anthropic,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: models.anthropic || 'claude-3-5-sonnet-20241022',
            max_tokens: 200,
            temperature: 0.7,
            messages: [{ role: 'user', content: questionPrompt }],
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          llmResponse = data.content[0].text.trim();
        }
      } else if (activeProvider === 'openai' && apiKeys.openai) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKeys.openai}`,
          },
          body: JSON.stringify({
            model: models.openai || 'gpt-4o',
            max_tokens: 200,
            temperature: 0.7,
            messages: [{ role: 'user', content: questionPrompt }],
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          llmResponse = data.choices[0].message.content.trim();
        }
      }

      // Parse response
      if (!llmResponse || llmResponse.includes('SKIP')) {
        return null;
      }

      const categoryMatch = llmResponse.match(/CATEGORY:\s*(.+)/i);
      const questionMatch = llmResponse.match(/QUESTION:\s*(.+)/i);
      const contextMatch = llmResponse.match(/CONTEXT:\s*(.+)/i);

      if (!categoryMatch || !questionMatch) {
        return null;
      }

      const category = categoryMatch[1].trim().toLowerCase();
      if (category === 'skip') {
        return null;
      }

      return {
        question: questionMatch[1].trim(),
        context: contextMatch ? contextMatch[1].trim() : '',
        category: category as any,
      };
    } catch (err) {
      console.error('[Welcome] Error generating profile question:', err);
      return null;
    }
  }

  /**
   * Generate personalized welcome message based on user profile and time of day
   */
  static async generate(
    username: string | undefined,
    apiKeys: any,
    models: any,
    activeProvider: string,
    deps: WelcomeDependencies
  ): Promise<WelcomeResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Get time of day
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

      let timeOfDay = 'day';
      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
      else timeOfDay = 'night';

      // Load user profile
      const profilePath = await deps.getUserProfilePath(username);
      let profile: any = {};
      try {
        const profileText = await fs.readFile(profilePath, 'utf8');
        profile = deps.parseUserProfile(profileText);
      } catch (err) {
        console.log('[Welcome] No profile found, using defaults');
      }

      // Check API keys
      const hasAnthropicKey = apiKeys.anthropic && apiKeys.anthropic.trim() !== '';
      const hasOpenAIKey = apiKeys.openai && apiKeys.openai.trim() !== '';
      const hasGoogleKey = apiKeys.google && apiKeys.google.trim() !== '';

      const hasAnyKey = hasAnthropicKey || hasOpenAIKey || hasGoogleKey;

      // Check onboarding stage from profile
      const onboardingStage = profile.onboardingStage || null;

      // If no API key, prompt to add one
      if (!hasAnyKey) {
        return {
          ok: true,
          message:
            'Welcome! To get started, please add an API key in Settings. You can use Anthropic Claude, OpenAI GPT, or Google Gemini.',
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
        };
      }

      // Route by onboarding stage
      if (onboardingStage === 'api_setup' || onboardingStage === 'profile') {
        const greeting =
          timeOfDay === 'morning'
            ? 'Good morning'
            : timeOfDay === 'afternoon'
              ? 'Good afternoon'
              : timeOfDay === 'evening'
                ? 'Good evening'
                : 'Hey there';

        // Check if this is their first login (no firstName yet means brand new user)
        const isNewUser = !profile.firstName || profile.firstName === 'User';

        if (isNewUser) {
          return {
            ok: true,
            message: `${greeting}! Great, you're all set up! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)`,
            needsOnboarding: true,
            timeOfDay,
            hour,
            dayOfWeek,
            profile,
          };
        } else {
          return {
            ok: true,
            message: `${greeting}! You haven't completed the tutorial yet.\n\n**Would you like to continue?**\n- Say **"continue tutorial"** to pick up where you left off\n- Say **"skip tutorial"** to skip onboarding and start using Wovly\n\nYou're currently on the profile setup step.`,
            needsOnboarding: true,
            timeOfDay,
            hour,
            dayOfWeek,
            profile,
          };
        }
      }

      if (onboardingStage === 'goals_intro') {
        return {
          ok: true,
          message: `Welcome back! You haven't completed the tutorial yet.\n\n**Would you like to continue?**\n- Say **"continue tutorial"** to learn about Goals and continue onboarding\n- Say **"skip tutorial"** to skip onboarding and start using Wovly\n\n**Next step:** Learn about Goals - how Wovly prioritizes what matters to you.`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile,
        };
      }

      if (onboardingStage === 'task_demo') {
        return {
          ok: true,
          message: `Welcome back! You're almost done with the tutorial.\n\n**Would you like to continue?**\n- Say **"continue tutorial"** to try creating your first task\n- Say **"skip tutorial"** to skip onboarding and start using Wovly\n\n**Next step:** Create a task - try saying "Remind me to eat lunch at 12pm tomorrow"`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile,
        };
      }

      if (onboardingStage === 'skill_demo') {
        return {
          ok: true,
          message: `Welcome back! You're almost done with the tutorial.\n\n**Would you like to continue?**\n- Say **"continue tutorial"** to try creating your first skill\n- Say **"skip tutorial"** to skip onboarding and start using Wovly\n\n**Next step:** Create a skill - try saying "Create a skill where if I say marco you say polo"`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile,
        };
      }

      if (onboardingStage === 'integrations') {
        return {
          ok: true,
          message: `Welcome back! You're on the final step of the tutorial.\n\n**Would you like to continue?**\n- Say **"continue tutorial"** to learn about integrations\n- Say **"skip tutorial"** to finish onboarding\n\n**Final step:** Connect integrations like Google Workspace, Slack, iMessage, and more to unlock Wovly's full potential.`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile,
        };
      }

      // Onboarding completed - generate personalized welcome
      // Fetch calendar events for today and tomorrow (if Google connected)
      const todayEvents: any[] = [];
      const tomorrowEvents: any[] = [];

      const googleAccessToken = await deps.getGoogleAccessToken(username);
      if (googleAccessToken) {
        try {
          // Today's events
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);

          const todayResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
              `timeMin=${todayStart.toISOString()}&timeMax=${todayEnd.toISOString()}&` +
              `singleEvents=true&orderBy=startTime`,
            {
              headers: { Authorization: `Bearer ${googleAccessToken}` },
            }
          );

          if (todayResponse.ok) {
            const todayData = (await todayResponse.json()) as any;
            todayEvents.push(...(todayData.items || []));
          }

          // Tomorrow's events
          const tomorrowStart = new Date();
          tomorrowStart.setDate(tomorrowStart.getDate() + 1);
          tomorrowStart.setHours(0, 0, 0, 0);
          const tomorrowEnd = new Date();
          tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
          tomorrowEnd.setHours(23, 59, 59, 999);

          const tomorrowResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
              `timeMin=${tomorrowStart.toISOString()}&timeMax=${tomorrowEnd.toISOString()}&` +
              `singleEvents=true&orderBy=startTime`,
            {
              headers: { Authorization: `Bearer ${googleAccessToken}` },
            }
          );

          if (tomorrowResponse.ok) {
            const tomorrowData = (await tomorrowResponse.json()) as any;
            tomorrowEvents.push(...(tomorrowData.items || []));
          }
        } catch (err) {
          console.error('[Welcome] Error fetching calendar events:', err);
        }
      }

      // Construct LLM prompt with user context
      let userContext = `User: ${profile.name || username}\n`;
      userContext += `Time: ${timeOfDay} (${hour}:00), ${dayOfWeek}\n`;

      if (profile.role) userContext += `Role: ${profile.role}\n`;
      if (profile.interests && profile.interests.length > 0) {
        userContext += `Interests: ${profile.interests.join(', ')}\n`;
      }
      if (profile.goals && profile.goals.length > 0) {
        userContext += `Goals: ${profile.goals.join(', ')}\n`;
      }

      if (todayEvents.length > 0) {
        userContext += `\nToday's calendar:\n`;
        todayEvents.slice(0, 3).forEach((event: any) => {
          const start = event.start.dateTime || event.start.date;
          userContext += `- ${event.summary} at ${new Date(start).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}\n`;
        });
        if (todayEvents.length > 3) {
          userContext += `...and ${todayEvents.length - 3} more\n`;
        }
      }

      if (tomorrowEvents.length > 0) {
        userContext += `\nTomorrow's calendar:\n`;
        tomorrowEvents.slice(0, 2).forEach((event: any) => {
          const start = event.start.dateTime || event.start.date;
          userContext += `- ${event.summary} at ${new Date(start).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}\n`;
        });
        if (tomorrowEvents.length > 2) {
          userContext += `...and ${tomorrowEvents.length - 2} more\n`;
        }
      }

      const prompt = `You are Wovly, a personal AI assistant. Generate a warm, concise welcome message for the user.

${userContext}

Guidelines:
- Be friendly and natural (like a helpful colleague, not overly formal)
- Keep it 1-2 sentences max
- Reference their context if relevant (time of day, calendar, goals)
- Don't ask what you can help with - just greet them warmly
- Use their name if available

Welcome message:`;

      let welcomeMessage = '';

      // Try Anthropic Claude
      if (activeProvider === 'anthropic' && hasAnthropicKey) {
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKeys.anthropic,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: models.anthropic || 'claude-3-5-sonnet-20241022',
              max_tokens: 150,
              temperature: 0.7,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.content[0].text.trim();
          }
        } catch (err) {
          console.error('[Welcome] Anthropic error:', err);
        }
      }

      // Try OpenAI GPT
      if (!welcomeMessage && activeProvider === 'openai' && hasOpenAIKey) {
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKeys.openai}`,
            },
            body: JSON.stringify({
              model: models.openai || 'gpt-4o',
              max_tokens: 150,
              temperature: 0.7,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.choices[0].message.content.trim();
          }
        } catch (err) {
          console.error('[Welcome] OpenAI error:', err);
        }
      }

      // Try Google Gemini
      if (!welcomeMessage && activeProvider === 'google' && hasGoogleKey) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${
              models.google || 'gemini-1.5-pro-latest'
            }:generateContent?key=${apiKeys.google}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: 150,
                  temperature: 0.7,
                },
              }),
            }
          );

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.candidates[0].content.parts[0].text.trim();
          }
        } catch (err) {
          console.error('[Welcome] Google error:', err);
        }
      }

      // Fallback welcome message
      if (!welcomeMessage) {
        welcomeMessage = `Good ${timeOfDay}${profile.name ? ', ' + profile.name : ''}! Ready to help you tackle the day.`;
      }

      // Generate contextual profile question
      let profileQuestion = null;
      try {
        profileQuestion = await this.generateProfileQuestion(
          username,
          profile,
          apiKeys,
          activeProvider,
          models,
          deps
        );

        // Append question to welcome message if available
        if (profileQuestion) {
          welcomeMessage += `\n\n**Quick question:** ${profileQuestion.question}`;
        }
      } catch (err) {
        console.error('[Welcome] Error adding profile question:', err);
      }

      return {
        ok: true,
        message: welcomeMessage,
        needsOnboarding: false,
        timeOfDay,
        hour,
        dayOfWeek,
        profile,
        todayEventCount: todayEvents.length,
        tomorrowEventCount: tomorrowEvents.length,
        profileQuestion: profileQuestion || undefined,
      };
    } catch (err: any) {
      console.error('Welcome generation error:', err);
      return {
        ok: false,
        error: err.message,
        message: "Hello! I'm Wovly, your AI assistant. How can I help you today?",
      };
    }
  }
}
