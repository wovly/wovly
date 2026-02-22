/**
 * Chat Service
 * Handles unified chat message processing for both streaming and non-streaming modes
 *
 * This service consolidates the chat:send and chat:sendStream handlers from main.js,
 * deduplicating ~80% shared logic including:
 * - Tutorial mode handling
 * - Memory saving (saveToDaily)
 * - Skill demo completion checking
 * - Task decomposition decision logic
 * - User profile parsing
 * - Context building (profile, memory, skills, system prompt)
 */

import type { BrowserWindow } from 'electron';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  skipDecomposition?: boolean;
  stepContext?: any;
  workflowContext?: any;
  stream?: boolean;
}

export interface ChatContext {
  // Window reference for streaming
  win: BrowserWindow | null;

  // User context
  currentUser: { username: string } | null;

  // Functions from main.js
  processChatQuery: (messages: any[], options: any) => Promise<any>;
  saveToDaily: (username: string, userMsg: string, assistantResp: string) => Promise<void>;
  getUserProfilePath: (username: string) => Promise<string>;
  parseUserProfile: (markdown: string) => any;
  serializeUserProfile: (profile: any) => string;
  getSettingsPath: (username: string) => Promise<string>;
  buildToolsAndExecutor: (options: any) => any;
  getGoogleAccessToken: (username: string) => Promise<string | null>;
  getSlackAccessToken: (username: string) => Promise<string | null>;
  getAvailableCredentialDomains: () => Promise<string[]>;
  checkSkillDemoCompletionShared: (userMsg: string, assistantResp: string, username: string | undefined, win: BrowserWindow | null) => Promise<void>;

  // Tutorial functions
  shouldUseTutorialMode: (stage: string, message: string) => boolean;
  checkStageAdvancement: (stage: string, message: string, context: any) => Promise<any>;
  processProfileStageMessage: (message: string, profile: any, context: any) => Promise<any>;
  generateTutorialResponse: (stage: string, message: string, profile: any) => string | null;
  getStageWelcomeMessage: (stage: string, profile: any, timeOfDay: string) => { message: string };

  // Streaming functions
  streamAnthropicResponse: (config: any, onDelta: any, onToolUse: any, onComplete: any) => Promise<void>;
  streamOpenAIResponse: (config: any, onDelta: any, onToolCall: any, onComplete: any) => Promise<void>;

  // Tool arrays
  profileTools: any[];
  taskTools: any[];
  memoryTools: any[];
  timeTools: any[];
  googleWorkspaceTools: any[];
  iMessageTools: any[];
  weatherTools: any[];
  slackTools: any[];
  cdpBrowserTools: any[];

  // Node modules
  fs: typeof import('fs/promises');
  fetch: typeof fetch;

  // Response cache
  responseCache: {
    cacheResponse: (query: string, username: string | undefined, response: string) => void;
  };

  // Performance tracker
  PerformanceTracker: any;
}

export interface ChatResponse {
  ok: boolean;
  error?: string;
  response?: string;
  streaming?: boolean;
  [key: string]: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatService
// ─────────────────────────────────────────────────────────────────────────────

export class ChatService {
  /**
   * Unified message processing for both streaming and non-streaming modes.
   * Deduplicates shared logic (tutorial, profile, memory, context building).
   */
  static async processMessage(
    messages: ChatMessage[],
    options: ChatOptions,
    context: ChatContext
  ): Promise<ChatResponse> {
    const { skipDecomposition = false, stepContext = null, workflowContext = null, stream = false } = options;

    // Helper to save conversation to daily memory (SHARED LOGIC)
    const saveConversationToMemory = async (userMsg: string, assistantResp: string) => {
      try {
        if (context.currentUser?.username && userMsg && assistantResp) {
          await context.saveToDaily(context.currentUser.username, userMsg, assistantResp);
        }
      } catch (err: any) {
        console.error("[Memory] Failed to save conversation:", err.message);
      }
    };

    // Helper to check for skill demo completion (SHARED LOGIC)
    const checkSkillDemoCompletion = async (userMsg: string, assistantResp: string) => {
      await context.checkSkillDemoCompletionShared(userMsg, assistantResp, context.currentUser?.username, context.win);
    };

    // Extract user's message for memory saving
    const userMessage = messages[messages.length - 1]?.content || "";

    try {
      // Check if user is logged in
      if (!context.currentUser?.username) {
        return { ok: false, error: "Please log in to use chat. Click the logout icon and log in again." };
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Tutorial Mode - Handle onboarding stages with isolated processing (SHARED)
      // ─────────────────────────────────────────────────────────────────────────

      // Load profile to check onboarding stage
      let profile = null;
      try {
        const profilePath = await context.getUserProfilePath(context.currentUser.username);
        const markdown = await context.fs.readFile(profilePath, "utf8");
        profile = context.parseUserProfile(markdown);
      } catch {
        // No profile yet
      }

      const currentStage = profile?.onboardingStage || "completed";

      // Check if we should use tutorial mode (isolated from task decomposition)
      if (context.shouldUseTutorialMode(currentStage, userMessage)) {
        console.log(`[Tutorial] Processing message in tutorial mode (stage: ${currentStage})`);

        // Check for stage advancement triggers
        const advancement = await context.checkStageAdvancement(currentStage, userMessage, {
          lastResponse: messages[messages.length - 2]?.content
        });

        if (advancement && advancement.shouldAdvance) {
          console.log(`[Tutorial] Advancing from ${currentStage} to ${advancement.nextStage}`);
          profile.onboardingStage = advancement.nextStage;
          const profilePath = await context.getUserProfilePath(context.currentUser.username);
          await context.fs.writeFile(profilePath, context.serializeUserProfile(profile), "utf8");

          if (advancement.response) {
            return { ok: true, response: advancement.response };
          }
          // If no response, will continue to show next stage welcome
        }

        // Handle profile stage - collect user info
        if (currentStage === "profile") {
          console.log(`[Tutorial] Processing profile collection`);
          const result = await context.processProfileStageMessage(userMessage, profile, null);

          // Save the updated fields
          if (Object.keys(result.updatedFields).length > 0) {
            const profilePath = await context.getUserProfilePath(context.currentUser.username);
            Object.assign(profile, result.updatedFields);

            // Check if we should advance to next stage
            if (result.shouldAdvance) {
              console.log(`[Tutorial] Profile complete, advancing to task_demo`);
              profile.onboardingStage = "task_demo";
            }

            await context.fs.writeFile(profilePath, context.serializeUserProfile(profile), "utf8");
          }

          // Return the response (next question or completion message)
          if (result.response) {
            // Save to memory
            await saveConversationToMemory(userMessage, result.response);
            return { ok: true, response: result.response };
          }

          // If shouldAdvance but no response, show next stage welcome
          if (result.shouldAdvance) {
            const welcome = context.getStageWelcomeMessage("task_demo", profile, "afternoon");
            await saveConversationToMemory(userMessage, welcome.message);
            return { ok: true, response: welcome.message };
          }
        }

        // For other tutorial stages, generate a guidance response
        const tutorialResponse = context.generateTutorialResponse(currentStage, userMessage, profile);
        if (tutorialResponse) {
          await saveConversationToMemory(userMessage, tutorialResponse);
          return { ok: true, response: tutorialResponse };
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Normal Processing - Use processChatQuery for shared context preparation
      // ─────────────────────────────────────────────────────────────────────────

      // Streaming mode always skips decomposition for faster responses
      const processResult = await context.processChatQuery(messages, {
        skipDecomposition: stream ? true : skipDecomposition,
        stepContext,
        workflowContext
      });

      // If decomposition returned a task suggestion, return it directly
      if (processResult.suggestTask) {
        return processResult;
      }

      // If there was an error, return it
      if (!processResult.ok) {
        return processResult;
      }

      // If we need to continue with full flow, route to appropriate handler
      if (!processResult.continueWithFullFlow) {
        return processResult;
      }

      // Branch to streaming or non-streaming processing
      if (stream) {
        return await this.processMessageStream(
          messages,
          userMessage,
          processResult,
          context,
          saveConversationToMemory
        );
      } else {
        return await this.processMessageSync(
          messages,
          userMessage,
          processResult,
          context,
          saveConversationToMemory,
          checkSkillDemoCompletion,
          stepContext,
          workflowContext
        );
      }

    } catch (err: any) {
      console.error("Chat error:", err);
      return { ok: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Non-Streaming Processing (chat:send)
  // ─────────────────────────────────────────────────────────────────────────────

  private static async processMessageSync(
    messages: ChatMessage[],
    userMessage: string,
    processResult: any,
    context: ChatContext,
    saveConversationToMemory: (userMsg: string, assistantResp: string) => Promise<void>,
    checkSkillDemoCompletion: (userMsg: string, assistantResp: string) => Promise<void>,
    stepContext: any,
    workflowContext: any
  ): Promise<ChatResponse> {
    const { apiKeys, models, activeProvider, systemPrompt: baseSystemPrompt } = processResult;
    const { accessToken } = processResult;
    const { hasGoogleTools, hasIMessageTools } = processResult;

    // Build on the system prompt from processChatQuery (SHARED LOGIC)
    let systemPrompt = baseSystemPrompt;
    const settingsPath = await context.getSettingsPath(context.currentUser!.username);

    // Weather system prompt (added before checking if enabled)
    systemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates. Use these when the user asks about weather.`;

    // Check if weather is enabled
    let weatherEnabled = true;
    try {
      const settings = JSON.parse(await context.fs.readFile(settingsPath, "utf8"));
      weatherEnabled = settings.weatherEnabled !== false;
    } catch {
      // Use default
    }

    // Check if Slack is connected (SHARED LOGIC)
    let slackAccessToken = null;
    let hasSlackTools = false;
    try {
      slackAccessToken = await context.getSlackAccessToken(context.currentUser!.username);
      hasSlackTools = !!slackAccessToken;
    } catch {
      // No Slack
    }

    // Add Slack system prompt if connected
    if (hasSlackTools) {
      systemPrompt += `\n\nYou have access to Slack. You can list channels, read messages, send messages, and search for users. Always confirm before sending messages.`;
    }

    // Check if browser automation is enabled (SHARED LOGIC)
    let hasBrowserTools = false;
    try {
      const settings = JSON.parse(await context.fs.readFile(settingsPath, "utf8"));
      hasBrowserTools = settings.browserEnabled === true;
    } catch {
      // Default disabled
    }

    // Get available credentials for browser login (SHARED LOGIC)
    const availableCredentials = await context.getAvailableCredentialDomains();

    // Add browser automation system prompt
    if (hasBrowserTools) {
      let browserPrompt = `\n\n## WEB RESEARCH CAPABILITY - BROWSER AUTOMATION

You have FULL browser automation capability via the browser_* tools. Use these to research online:

**AVAILABLE BROWSER TOOLS:**
- \`browser_navigate\`: Go to any URL. Returns a visual snapshot with clickable element refs.
- \`browser_click\`: Click an element using its ref (e.g., "e5"). Each snapshot shows available refs.
- \`browser_type\`: Type text into an input field. Specify ref to focus it first.
- \`browser_press\`: Press keys like "Enter" to submit forms.
- \`browser_snapshot\`: Get current page screenshot and element list.
- \`browser_scroll\`: Scroll up/down to see more content.
- \`browser_back\`: Go back to previous page.

**HOW TO USE:**
1. Use \`browser_navigate\` to go to a website
2. Review the returned snapshot to see what's on the page
3. Use refs (like "e5", "e12") to click buttons/links or type into fields
4. After typing, use \`browser_press\` with "Enter" to submit

**DO NOT SAY "I cannot access" websites. JUST USE THE BROWSER TOOLS.**

**CAPTCHA/BOT DETECTION:**
If blocked, try alternative sites:
- Real estate: Zillow → Redfin → Realtor.com
- Flights: Google Flights → Kayak → Skyscanner
- Hotels: Google Hotels → Booking.com → Expedia
- Products: Amazon → Walmart → Target`;

      // Add credential information
      if (availableCredentials.length > 0) {
        browserPrompt += `

**SAVED CREDENTIALS AVAILABLE FOR LOGIN:**
The user has credentials saved for these domains - use them automatically when logging in:
${availableCredentials.map(d => `- ${d}`).join('\n')}

**HOW TO LOG IN (using browser_fill_credential):**
1. Navigate to the login page
2. Take a snapshot to find the username and password field refs
3. Use \`browser_fill_credential\` with domain, field="username", and the username field ref
4. Use \`browser_fill_credential\` with domain, field="password", and the password field ref
5. Click the login/submit button

Example for brightwheel.com:
- \`browser_fill_credential({ domain: "mybrightwheel.com", field: "username", ref: "e5" })\`
- \`browser_fill_credential({ domain: "mybrightwheel.com", field: "password", ref: "e6" })\`
- Then click the submit button

**CRITICAL: NEVER ASK THE USER FOR CREDENTIALS.** If a site needs login and it's not in the list above, say:
"I don't have saved credentials for [domain]. Please add them in the Credentials page of the app, then try again."`;
      } else {
        browserPrompt += `

**LOGIN CREDENTIALS:**
No saved credentials found. If a website requires login, inform the user:
"I need to log into [site], but I don't have saved credentials. Please add them in the Credentials page of the app, then try again."

**NEVER ASK THE USER FOR THEIR PASSWORD OR LOGIN CREDENTIALS.**`;
      }

      systemPrompt += browserPrompt;
    }

    // Add task system prompt
    systemPrompt += `\n\nYou can create autonomous background TASKS for things that require multiple steps over time, waiting for external responses, or follow-up actions.

*** WHEN TO OFFER TASK CREATION ***
You MUST offer to create a task when the user's request involves ANY of these patterns:
- SCHEDULING: "schedule a meeting", "set up a call", "arrange dinner", "find a time to meet", "schedule lunch"
- FOLLOW-UP: "follow up with", "check back with", "remind them", "make sure they respond"
- COORDINATION: "coordinate with", "work out the details with", "negotiate a time"
- BACK-AND-FORTH: Any request that will likely require waiting for someone's reply

Examples that MUST trigger task offer:
- "email jeff@wovly.ai to schedule a meeting" → TASK (scheduling requires back-and-forth)
- "text adaira to schedule dinner" → TASK
- "email bob to set up a call next week" → TASK
- "message sarah to find a time for lunch" → TASK

Examples that are ONE-SHOT (no task needed):
- "send a thank you email to jeff" → Just send the email
- "email bob the document" → Just send it
- "text adaira happy birthday" → Just send it

CRITICAL TASK CREATION RULES:
1. When you recognize a SCHEDULING or FOLLOW-UP request, DO NOT draft an email directly
2. Instead, FIRST describe your proposed plan in plain text in your response
3. Ask the user: "Would you like me to create this task to handle the scheduling?"
4. WAIT for the user's response - they must say yes/confirm/go ahead
5. ONLY AFTER they confirm, call the create_task tool

VERY IMPORTANT - When creating a task:
- Do NOT send any messages or perform any actions yourself
- Do NOT call send_email, send_imessage, send_slack_message, create_calendar_event, or any other action tools
- Do NOT draft the email - the task executor will compose and send it
- ONLY call the create_task tool
- The task executor will automatically handle ALL steps including the first one
- If you send a message AND create a task, TWO messages will be sent (this is a bug)
- PLAN: Pass an EMPTY array [] for the plan - the system will auto-select the appropriate skill procedure

MESSAGING CHANNEL DETECTION - When calling create_task, you MUST set the messagingChannel parameter:
- User says "text", "message her/him", "iMessage", "SMS" → messagingChannel: "imessage"
- User says "email", "mail", "gmail" → messagingChannel: "email"
- User says "slack" → messagingChannel: "slack"
- If unclear, ASK which channel they prefer before creating the task.

Example: "text adaira to schedule dinner" → messagingChannel: "imessage"
Example: "email jeff about the meeting" → messagingChannel: "email"

NEVER create a task without explicit user confirmation first. Only create ONE task per request.`;

    // Combine tools (SHARED LOGIC)
    const allTools = [...context.profileTools, ...context.taskTools, ...context.memoryTools, ...context.timeTools];
    if (hasGoogleTools) allTools.push(...context.googleWorkspaceTools);
    if (hasIMessageTools) allTools.push(...context.iMessageTools);
    if (weatherEnabled) allTools.push(...context.weatherTools);
    if (hasSlackTools) allTools.push(...context.slackTools);
    if (hasBrowserTools) allTools.push(...context.cdpBrowserTools);

    // Determine which provider to use
    const useProvider = apiKeys[activeProvider] ? activeProvider :
                        apiKeys.anthropic ? "anthropic" :
                        apiKeys.openai ? "openai" :
                        apiKeys.google ? "google" : null;

    if (!useProvider) {
      return { ok: false, error: "No API keys configured" };
    }

    // Performance tracking
    const perf = new context.PerformanceTracker('Chat Processing');

    // Call LLM with tools - ANTHROPIC
    if (useProvider === "anthropic" && apiKeys.anthropic) {
      const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
      let currentMessages = messages.map(m => ({ role: m.role, content: m.content }));

      for (let iteration = 0; iteration < 20; iteration++) {
        const response = await context.fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: anthropicModel,
            max_tokens: 4096,
            system: systemPrompt,
            tools: allTools,
            messages: currentMessages
          })
        });

        if (!response.ok) {
          const error = await response.text();
          return { ok: false, error: `API error: ${error}` };
        }

        const data: any = await response.json();

        if (data.stop_reason === "end_turn" || !data.content.some((b: any) => b.type === "tool_use")) {
          const textBlock = data.content.find((b: any) => b.type === "text");
          let responseText = textBlock?.text || "";

          // Save conversation to memory
          await saveConversationToMemory(userMessage, responseText);

          // Check for skill demo completion
          await checkSkillDemoCompletion(userMessage, responseText);

          // Cache the response for future queries
          if (!stepContext && !workflowContext) {
            context.responseCache.cacheResponse(userMessage, context.currentUser?.username, responseText);
          }

          // Log performance metrics
          perf.report();

          return { ok: true, response: responseText };
        }

        // Handle tool calls
        const toolUseBlocks = data.content.filter((b: any) => b.type === "tool_use");
        const toolResults = [];

        // Build tool executor with current context
        const chatToolExecutor = context.buildToolsAndExecutor({
          googleAccessToken: accessToken,
          slackAccessToken,
          weatherEnabled,
          iMessageEnabled: hasIMessageTools,
          browserEnabled: hasBrowserTools,
          apiKeys
        });

        for (const toolUse of toolUseBlocks) {
          console.log(`Tool: ${toolUse.name}`, toolUse.input);
          const result = await chatToolExecutor.executeTool(toolUse.name, toolUse.input);

          // Handle CDP browser tool screenshots - send to UI for display
          if (result.screenshotDataUrl && context.win && !context.win.isDestroyed()) {
            context.win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
          }

          // For browser tools with screenshots, send image to LLM
          const { screenshotDataUrl, ...resultForLLM } = result;

          if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
            const base64Match = screenshotDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (base64Match) {
              const mediaType = `image/${base64Match[1]}`;
              const base64Data = base64Match[2];

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: [
                  { type: "text", text: JSON.stringify(resultForLLM) },
                  { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } }
                ]
              });
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(resultForLLM)
              });
            }
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(resultForLLM)
            });
          }
        }

        currentMessages.push({ role: "assistant", content: data.content } as any);
        currentMessages.push({ role: "user", content: toolResults } as any);
      }

      return { ok: false, error: "Max iterations reached" };
    }

    // Call LLM with tools - OPENAI
    if (useProvider === "openai" && apiKeys.openai) {
      const openaiModel = models.openai || "gpt-4o";
      const openaiTools = allTools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema }
      }));

      let currentMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ];

      for (let iteration = 0; iteration < 20; iteration++) {
        const response = await context.fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: currentMessages,
            tools: openaiTools
          })
        });

        if (!response.ok) {
          const error = await response.text();
          return { ok: false, error: `API error: ${error}` };
        }

        const data: any = await response.json();
        const choice = data.choices[0];

        if (choice.finish_reason === "stop" || !choice.message.tool_calls) {
          let responseText = choice.message.content || "";

          // Save conversation to memory
          await saveConversationToMemory(userMessage, responseText);

          // Check for skill demo completion
          await checkSkillDemoCompletion(userMessage, responseText);

          // Cache the response
          if (!stepContext && !workflowContext) {
            context.responseCache.cacheResponse(userMessage, context.currentUser?.username, responseText);
          }

          perf.report();

          return { ok: true, response: responseText };
        }

        currentMessages.push(choice.message);

        // Build tool executor
        const openaiToolExecutor = context.buildToolsAndExecutor({
          googleAccessToken: accessToken,
          slackAccessToken,
          weatherEnabled,
          iMessageEnabled: hasIMessageTools,
          browserEnabled: hasBrowserTools
        });

        let pendingScreenshots = [];

        for (const toolCall of choice.message.tool_calls) {
          const toolInput = JSON.parse(toolCall.function.arguments);
          const result = await openaiToolExecutor.executeTool(toolCall.function.name, toolInput);

          // Handle screenshots
          if (result.screenshotDataUrl && context.win && !context.win.isDestroyed()) {
            context.win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
          }

          const { screenshotDataUrl, ...resultForLLM } = result;
          if (screenshotDataUrl) {
            pendingScreenshots.push(screenshotDataUrl);
            resultForLLM.screenshotAttached = true;
          }

          currentMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(resultForLLM)
          } as any);
        }

        // Add screenshots as user message
        if (pendingScreenshots.length > 0) {
          const imageContent = pendingScreenshots.map(dataUrl => ({
            type: "image_url",
            image_url: { url: dataUrl, detail: "low" }
          }));
          currentMessages.push({
            role: "user",
            content: [
              { type: "text", text: "Here is the current browser screenshot. Analyze it to understand the page and continue with the task." },
              ...imageContent
            ]
          });
        }
      }

      return { ok: false, error: "Max iterations reached" };
    }

    // Call LLM - GOOGLE GEMINI
    if (useProvider === "google" && apiKeys.google) {
      const geminiModel = models.google || "gemini-1.5-pro";

      const geminiMessages = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      const response = await context.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKeys.google}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: geminiMessages,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { ok: false, error: `Gemini API error: ${error}` };
      }

      const data: any = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Save conversation to memory
      await saveConversationToMemory(userMessage, text);

      // Check for skill demo completion
      await checkSkillDemoCompletion(userMessage, text);

      // Cache the response
      if (!stepContext && !workflowContext) {
        context.responseCache.cacheResponse(userMessage, context.currentUser?.username, text);
      }

      perf.report();

      return { ok: true, response: text };
    }

    return { ok: false, error: "No API key available for selected provider" };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Streaming Processing (chat:sendStream)
  // ─────────────────────────────────────────────────────────────────────────────

  private static async processMessageStream(
    messages: ChatMessage[],
    userMessage: string,
    processResult: any,
    context: ChatContext,
    saveConversationToMemory: (userMsg: string, assistantResp: string) => Promise<void>
  ): Promise<ChatResponse> {
    console.log("[StreamingChat] Starting streaming response...");

    const { apiKeys, models, activeProvider, systemPrompt: baseSystemPrompt } = processResult;
    const { accessToken, hasGoogleTools, hasIMessageTools } = processResult;

    // Build system prompt (SHARED LOGIC - simplified for streaming)
    let systemPrompt = baseSystemPrompt;
    const settingsPath = await context.getSettingsPath(context.currentUser!.username);

    // Weather system prompt
    systemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates. Use these when the user asks about weather.`;

    // Check if weather is enabled
    let weatherEnabled = true;
    try {
      const settings = JSON.parse(await context.fs.readFile(settingsPath, "utf8"));
      weatherEnabled = settings.weatherEnabled !== false;
    } catch {
      // Use default
    }

    // Check if Slack is connected (SHARED LOGIC)
    let slackAccessToken = null;
    let hasSlackTools = false;
    try {
      slackAccessToken = await context.getSlackAccessToken(context.currentUser!.username);
      hasSlackTools = !!slackAccessToken;
    } catch {
      // No Slack
    }

    // Add Slack system prompt
    if (hasSlackTools) {
      systemPrompt += `\n\nYou have access to Slack. You can list channels, read messages, send messages, and search for users. Always confirm before sending messages.`;
    }

    // Check if browser automation is enabled (SHARED LOGIC)
    let hasBrowserTools = false;
    try {
      const settings = JSON.parse(await context.fs.readFile(settingsPath, "utf8"));
      hasBrowserTools = settings.browserEnabled === true;
    } catch {
      // Default disabled
    }

    // Get available credentials (SHARED LOGIC)
    const availableCredentials = await context.getAvailableCredentialDomains();

    // Add browser automation system prompt (simplified version for streaming)
    if (hasBrowserTools) {
      let browserPrompt = `\n\nYou have FULL browser automation capability. Use browser_navigate, browser_click, browser_type, browser_press, browser_snapshot, and browser_scroll to research online. DO NOT SAY "I cannot access" websites - JUST USE THE BROWSER TOOLS.`;

      if (availableCredentials.length > 0) {
        browserPrompt += `\n\nSaved credentials available for: ${availableCredentials.join(', ')}. Use browser_fill_credential to log in automatically.`;
      }

      systemPrompt += browserPrompt;
    }

    // Add task system prompt (simplified for streaming)
    systemPrompt += `\n\nYou can create autonomous background TASKS for scheduling, follow-ups, or multi-step coordination. Offer to create a task when requests involve waiting for responses or scheduling negotiations.`;

    // Combine tools (SHARED LOGIC)
    const allTools = [...context.profileTools, ...context.taskTools, ...context.memoryTools, ...context.timeTools];
    if (hasGoogleTools) allTools.push(...context.googleWorkspaceTools);
    if (hasIMessageTools) allTools.push(...context.iMessageTools);
    if (weatherEnabled) allTools.push(...context.weatherTools);
    if (hasSlackTools) allTools.push(...context.slackTools);
    if (hasBrowserTools) allTools.push(...context.cdpBrowserTools);

    console.log(`[StreamingChat] Tools available: ${allTools.length}`, allTools.map(t => t.name));

    // Convert messages to API format
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // ANTHROPIC STREAMING
    if (activeProvider === 'anthropic' && apiKeys.anthropic) {
      const model = models.anthropic || 'claude-sonnet-4-20250514';

      // Tool execution loop
      let currentMessages = [...conversationMessages];
      const maxIterations = 10;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`[StreamingChat] Iteration ${iteration + 1}/${maxIterations}`);

        const toolUseQueue: any[] = [];
        let streamResult: any = null;

        await context.streamAnthropicResponse(
          {
            apiKey: apiKeys.anthropic,
            model,
            maxTokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: allTools
          },
          // onDelta
          (delta: string, fullText: string) => {
            if (context.win && !context.win.isDestroyed()) {
              context.win.webContents.send('chat:stream:delta', { delta, fullText });
            }
          },
          // onToolUse
          (toolUse: any) => {
            console.log('[StreamingChat] Tool use detected:', toolUse.name);
            toolUseQueue.push(toolUse);
          },
          // onComplete
          (result: any) => {
            streamResult = result;
          }
        );

        // If no tool uses, we're done
        if (toolUseQueue.length === 0) {
          console.log('[StreamingChat] No more tool uses, completing');

          // Save to memory
          try {
            if (context.currentUser?.username && userMessage && streamResult?.text) {
              await context.saveToDaily(context.currentUser.username, userMessage, streamResult.text);
            }
          } catch (err: any) {
            console.error("[Memory] Failed to save:", err.message);
          }

          if (context.win && !context.win.isDestroyed()) {
            context.win.webContents.send('chat:stream:complete', {
              result: {
                text: streamResult?.text || '',
                stop_reason: streamResult?.stop_reason || 'end_turn'
              }
            });
          }

          return { ok: true, streaming: true };
        }

        // Execute all tools
        console.log(`[StreamingChat] Executing ${toolUseQueue.length} tools`);
        const toolResults: any[] = [];

        const chatToolExecutor = context.buildToolsAndExecutor({
          googleAccessToken: accessToken,
          slackAccessToken,
          weatherEnabled,
          iMessageEnabled: hasIMessageTools,
          browserEnabled: hasBrowserTools,
          apiKeys
        });

        for (const toolUse of toolUseQueue) {
          try {
            const toolInput = typeof toolUse.input === 'string'
              ? JSON.parse(toolUse.input)
              : toolUse.input;

            const result = await chatToolExecutor.executeTool(toolUse.name, toolInput);
            console.log('[StreamingChat] Tool result:', result);

            // Send tool execution to UI
            if (context.win && !context.win.isDestroyed()) {
              context.win.webContents.send('chat:stream:tool', {
                toolUse,
                result,
                screenshotDataUrl: result.screenshotDataUrl
              });
            }

            // Handle browser screenshots
            if (result.screenshotDataUrl && context.win && !context.win.isDestroyed()) {
              context.win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
            }

            const { screenshotDataUrl, ...resultForLLM } = result;

            if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
              const base64Match = screenshotDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (base64Match) {
                const mediaType = `image/${base64Match[1]}`;
                const base64Data = base64Match[2];

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: [
                    { type: "text", text: JSON.stringify(resultForLLM) },
                    { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } }
                  ]
                });
              } else {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(resultForLLM)
                });
              }
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(resultForLLM)
              });
            }
          } catch (err: any) {
            console.error('[StreamingChat] Tool execution error:', err);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: err.message }),
              is_error: true
            });
          }
        }

        // Ensure all tool_use blocks have object inputs
        const assistantContent = (streamResult.contentBlocks || []).map((block: any) => {
          if (block.type === 'tool_use') {
            if (typeof block.input === 'string') {
              console.warn('[StreamingChat] Tool input is still a string, parsing:', block.name);
              try {
                return { ...block, input: JSON.parse(block.input) };
              } catch (e) {
                console.error('[StreamingChat] Failed to parse tool input:', (e as Error).message);
                return { ...block, input: {} };
              }
            }
            if (!block.input) {
              console.warn('[StreamingChat] Tool input is missing, using empty object:', block.name);
              return { ...block, input: {} };
            }
          }
          return block;
        });

        console.log('[StreamingChat] Assistant content blocks:', JSON.stringify(assistantContent, null, 2));

        currentMessages.push({
          role: "assistant",
          content: assistantContent
        } as any);
        currentMessages.push({
          role: "user",
          content: toolResults
        } as any);

        // Continue to next iteration
      }

      // Max iterations reached
      console.error('[StreamingChat] Max iterations reached without completion');
      if (context.win && !context.win.isDestroyed()) {
        context.win.webContents.send('chat:stream:error', {
          error: 'Max iterations reached'
        });
      }

      return { ok: false, error: 'Max iterations reached' };

    } else if (activeProvider === 'openai' && apiKeys.openai) {
      // OPENAI STREAMING
      const model = models.openai || 'gpt-4o';

      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...conversationMessages
      ];

      await context.streamOpenAIResponse(
        {
          apiKey: apiKeys.openai,
          model,
          maxTokens: 4096,
          messages: openaiMessages,
          tools: allTools
        },
        // onDelta
        (delta: string, fullText: string) => {
          if (context.win && !context.win.isDestroyed()) {
            context.win.webContents.send('chat:stream:delta', { delta, fullText });
          }
        },
        // onToolCall
        async (toolCall: any) => {
          console.log('[StreamingChat] Tool call:', toolCall.function.name, toolCall.function.arguments);

          const chatToolExecutor = context.buildToolsAndExecutor({
            googleAccessToken: accessToken,
            slackAccessToken,
            weatherEnabled,
            iMessageEnabled: hasIMessageTools,
            browserEnabled: hasBrowserTools,
            apiKeys
          });

          try {
            const toolInput = JSON.parse(toolCall.function.arguments);
            const result = await chatToolExecutor.executeTool(toolCall.function.name, toolInput);
            console.log('[StreamingChat] Tool result:', result);

            // Send to UI
            if (context.win && !context.win.isDestroyed()) {
              context.win.webContents.send('chat:stream:tool', {
                toolCall,
                result,
                screenshotDataUrl: result.screenshotDataUrl
              });
            }

            // Handle screenshots
            if (result.screenshotDataUrl && context.win && !context.win.isDestroyed()) {
              context.win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
            }

            return result;
          } catch (err: any) {
            console.error('[StreamingChat] Tool execution error:', err);
            return { error: err.message };
          }
        },
        // onComplete
        async (result: any) => {
          console.log('[StreamingChat] Stream complete');

          // Save to memory
          try {
            if (context.currentUser?.username && userMessage && result.text) {
              await context.saveToDaily(context.currentUser.username, userMessage, result.text);
            }
          } catch (err: any) {
            console.error("[Memory] Failed to save:", err.message);
          }

          if (context.win && !context.win.isDestroyed()) {
            context.win.webContents.send('chat:stream:complete', {
              result: {
                text: result.text,
                finish_reason: result.finish_reason
              }
            });
          }
        }
      );

      return { ok: true, streaming: true };
    }

    return { ok: false, error: "No API key configured for streaming" };
  }
}
