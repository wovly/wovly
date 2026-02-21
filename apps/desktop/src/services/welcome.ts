/**
 * Welcome Service
 * Handles welcome message generation with personalized context
 */

import * as fs from "fs/promises";
import * as path from "path";

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
}

interface WelcomeDependencies {
  getUserProfilePath: (username: string) => string;
  parseUserProfile: (text: string) => any;
  getGoogleAccessToken: (username: string) => Promise<string | null>;
  getSettingsPath: (username: string) => Promise<string>;
  getAvailableCredentialDomains?: (username: string) => Promise<string[]>;
}

export class WelcomeService {
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
        return { ok: false, error: "Not logged in" };
      }

      // Get time of day
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

      let timeOfDay = "day";
      if (hour >= 5 && hour < 12) timeOfDay = "morning";
      else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
      else if (hour >= 17 && hour < 21) timeOfDay = "evening";
      else timeOfDay = "night";

      // Load user profile
      const profilePath = deps.getUserProfilePath(username);
      let profile: any = {};
      try {
        const profileText = await fs.readFile(profilePath, "utf8");
        profile = deps.parseUserProfile(profileText);
      } catch (err) {
        console.log("[Welcome] No profile found, using defaults");
      }

      // Check API keys
      const hasAnthropicKey = apiKeys.anthropic && apiKeys.anthropic.trim() !== "";
      const hasOpenAIKey = apiKeys.openai && apiKeys.openai.trim() !== "";
      const hasGoogleKey = apiKeys.google && apiKeys.google.trim() !== "";

      const hasAnyKey = hasAnthropicKey || hasOpenAIKey || hasGoogleKey;

      // Check if user needs onboarding
      let onboardingStage = null;
      try {
        const settingsPath = await deps.getSettingsPath(username);
        const settingsData = await fs.readFile(settingsPath, "utf8");
        const settings = JSON.parse(settingsData);
        onboardingStage = settings.onboardingStage;
      } catch (err) {
        // No settings yet
      }

      // If no API key, prompt to add one
      if (!hasAnyKey) {
        return {
          ok: true,
          message:
            "Welcome! To get started, please add an API key in Settings. You can use Anthropic Claude, OpenAI GPT, or Google Gemini.",
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek
        };
      }

      // Route by onboarding stage
      if (onboardingStage === "api_setup" || onboardingStage === "profile") {
        const greeting =
          timeOfDay === "morning"
            ? "Good morning"
            : timeOfDay === "afternoon"
            ? "Good afternoon"
            : timeOfDay === "evening"
            ? "Good evening"
            : "Hey there";

        return {
          ok: true,
          message: `${greeting}! Great, you're all set up! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile
        };
      }

      if (onboardingStage === "task_demo") {
        return {
          ok: true,
          message: `Now let's see Wovly in action! Try creating your first task.\n\nType something like: **"Remind me to eat lunch at 12pm tomorrow"**\n\nTasks run in the background and can monitor, remind, and take actions for you.`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile
        };
      }

      if (onboardingStage === "skill_demo") {
        return {
          ok: true,
          message: `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile
        };
      }

      if (onboardingStage === "integrations") {
        return {
          ok: true,
          message: `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.`,
          needsOnboarding: true,
          timeOfDay,
          hour,
          dayOfWeek,
          profile
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
              headers: { Authorization: `Bearer ${googleAccessToken}` }
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
              headers: { Authorization: `Bearer ${googleAccessToken}` }
            }
          );

          if (tomorrowResponse.ok) {
            const tomorrowData = (await tomorrowResponse.json()) as any;
            tomorrowEvents.push(...(tomorrowData.items || []));
          }
        } catch (err) {
          console.error("[Welcome] Error fetching calendar events:", err);
        }
      }

      // Construct LLM prompt with user context
      let userContext = `User: ${profile.name || username}\n`;
      userContext += `Time: ${timeOfDay} (${hour}:00), ${dayOfWeek}\n`;

      if (profile.role) userContext += `Role: ${profile.role}\n`;
      if (profile.interests && profile.interests.length > 0) {
        userContext += `Interests: ${profile.interests.join(", ")}\n`;
      }
      if (profile.goals && profile.goals.length > 0) {
        userContext += `Goals: ${profile.goals.join(", ")}\n`;
      }

      if (todayEvents.length > 0) {
        userContext += `\nToday's calendar:\n`;
        todayEvents.slice(0, 3).forEach((event: any) => {
          const start = event.start.dateTime || event.start.date;
          userContext += `- ${event.summary} at ${new Date(start).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
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
          userContext += `- ${event.summary} at ${new Date(start).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
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

      let welcomeMessage = "";

      // Try Anthropic Claude
      if (activeProvider === "anthropic" && hasAnthropicKey) {
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKeys.anthropic,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: models.anthropic || "claude-3-5-sonnet-20241022",
              max_tokens: 150,
              temperature: 0.7,
              messages: [{ role: "user", content: prompt }]
            })
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.content[0].text.trim();
          }
        } catch (err) {
          console.error("[Welcome] Anthropic error:", err);
        }
      }

      // Try OpenAI GPT
      if (!welcomeMessage && activeProvider === "openai" && hasOpenAIKey) {
        try {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKeys.openai}`
            },
            body: JSON.stringify({
              model: models.openai || "gpt-4o",
              max_tokens: 150,
              temperature: 0.7,
              messages: [{ role: "user", content: prompt }]
            })
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.choices[0].message.content.trim();
          }
        } catch (err) {
          console.error("[Welcome] OpenAI error:", err);
        }
      }

      // Try Google Gemini
      if (!welcomeMessage && activeProvider === "google" && hasGoogleKey) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${
              models.google || "gemini-1.5-pro-latest"
            }:generateContent?key=${apiKeys.google}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: 150,
                  temperature: 0.7
                }
              })
            }
          );

          if (response.ok) {
            const data = (await response.json()) as any;
            welcomeMessage = data.candidates[0].content.parts[0].text.trim();
          }
        } catch (err) {
          console.error("[Welcome] Google error:", err);
        }
      }

      // Fallback welcome message
      if (!welcomeMessage) {
        welcomeMessage = `Good ${timeOfDay}${profile.name ? ", " + profile.name : ""}! Ready to help you tackle the day.`;
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
        tomorrowEventCount: tomorrowEvents.length
      };
    } catch (err: any) {
      console.error("Welcome generation error:", err);
      return {
        ok: false,
        error: err.message,
        message: "Hello! I'm Wovly, your AI assistant. How can I help you today?"
      };
    }
  }
}
