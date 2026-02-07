const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const http = require("http");
const { URL, URLSearchParams } = require("url");
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const { spawn, exec, execSync } = require("child_process");

// ─────────────────────────────────────────────────────────────────────────────
// Import modular components from src/
// ─────────────────────────────────────────────────────────────────────────────
const {
  // Utils
  getTodayDate,
  getYesterdayDate,
  isOlderThanDays,
  isWithinDaysRange,
  truncateToLimit,
  getWovlyDir,
  getUserDataDir,
  getSettingsPath,
  // Auth
  getSessionPath,
  saveSession,
  loadSession,
  clearSession,
  // Credentials
  getCredentialsPath,
  loadCredentials,
  getAvailableCredentialDomains,
  saveCredentials,
  getCredentialForDomain,
  resolveCredentialPlaceholders,
  validateNoCredentialLeakage,
  clearCredentialsCache,
  // Memory
  CONTEXT_LIMITS,
  getMemoryDailyDir,
  getMemoryLongtermDir,
  extractSummaryFromMemory,
  hasSummarySection,
  generateMemorySummary,
  processOldMemoryFiles,
  loadConversationContext,
  saveToDaily,
  saveFactToDaily,
  // Profile
  getUserProfilePath,
  parseUserProfile,
  serializeUserProfile,
  // Skills
  getSkillsDir,
  parseSkill,
  serializeSkill,
  loadAllSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  extractQueryKeywords,
  calculateSkillScore,
  findBestSkill,
  // Tasks
  POLL_FREQUENCY_PRESETS,
  DEFAULT_POLL_FREQUENCY,
  getTasksDir,
  parseTaskMarkdown,
  serializeTask,
  createTask,
  getTask,
  updateTask,
  listTasks,
  listActiveTasks,
  getTasksWaitingForInput,
  cancelTask,
  hideTask,
  getTaskRawMarkdown,
  saveTaskRawMarkdown,
  setMainWindow,
  addTaskUpdate,
  getTaskUpdates,
  // Browser
  BrowserController,
  getBrowserController,
  loadPuppeteer,
  checkPuppeteerCoreInstalled,
  ensurePuppeteerCoreInstalled,
  // Integrations
  getGoogleAccessToken,
  getSlackAccessToken,
  messagingIntegrations,
  registerMessagingIntegration,
  findIntegrationByKeyword,
  getMessagingIntegration,
  getEnabledMessagingIntegrations,
  getIMessageChatId,
  checkForNewIMessages,
  checkForNewSlackMessages,
  checkForNewEmails,
  // Tools
  timeTools,
  executeTimeTool,
  // Task primitive tools
  taskPrimitiveTools,
  executeTaskPrimitiveTool,
  parseTimeString,
  // LLM - Architect-Builder Decomposition
  CLASSIFIER_MODELS,
  decomposeQuery,
  architectDecompose,
  builderMapToTools,
  validateDecomposition,
  formatDecomposedSteps,
  formatArchitectSteps,
  formatBuilderPlan,
  getToolCategories,
} = require("./src");

// Tutorial / Onboarding
const {
  ONBOARDING_STAGES,
  isInOnboarding,
  getNextStage,
  isProfileComplete,
  processProfileStageMessage,
  getStageWelcomeMessage,
  checkStageAdvancement,
  shouldUseTutorialMode,
  generateTutorialResponse
} = require("./src/tutorial");

// Note: BrowserController is now imported from ./src/browser/controller.js

// ─────────────────────────────────────────────────────────────────────────────
// Shared Onboarding Helper - Check if skill demo is completed (Marco -> Polo)
// This is shared between chat:send and chat:executeInline handlers
// ─────────────────────────────────────────────────────────────────────────────
async function checkSkillDemoCompletionShared(userMsg, assistantResp, username, winRef) {
  if (!username) return;
  
  try {
    const profilePath = await getUserProfilePath(username);
    const markdown = await fs.readFile(profilePath, "utf8");
    const profile = parseUserProfile(markdown);
    
    if (profile.onboardingStage === "skill_demo") {
      // Check if user said "marco" (case insensitive) and got "polo" in response
      const userSaidMarco = userMsg.toLowerCase().includes("marco");
      const responseSaidPolo = assistantResp.toLowerCase().includes("polo");
      
      if (userSaidMarco && responseSaidPolo) {
        console.log("[Onboarding] Skill test passed (Marco/Polo), advancing to integrations stage");
        profile.onboardingStage = "integrations";
        await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
        
        // Send the integrations message after a brief delay
        setTimeout(() => {
          if (winRef && winRef.webContents) {
            winRef.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.\n\nBy the way, you can continue to tell me important facts about yourself. Just share them and I'll ask if you want me to save them to your profile. Things like your spouse's name, your pet's name, allergies, important dates, or preferences.`,
              source: "app"
            });
          }
        }, 1000);
      }
    }
  } catch (err) {
    console.error("[Onboarding] Error checking skill demo completion:", err.message);
  }
}

// Global browser controller instance (module-level for reference)
let browserController = null;

// Wrapper to use imported getBrowserController
async function _getBrowserController(username) {
  browserController = await getBrowserController(username);
  return browserController;
}

// Currently logged in user (module-level for cross-function access)
let currentUser = null;

let win;

// ─────────────────────────────────────────────────────────────────────────────
// Message Confirmation System - Requires user approval before sending messages
// ─────────────────────────────────────────────────────────────────────────────
const pendingConfirmations = new Map(); // confirmationId -> { resolve, reject, details }
let confirmationIdCounter = 0;

// Tools that require user confirmation before execution
const TOOLS_REQUIRING_CONFIRMATION = [
  'send_email',
  'send_imessage', 
  'send_slack_message',
  'send_telegram_message',
  'send_discord_message',
  'post_tweet',
  'send_x_dm',
  'create_reddit_post',
  'create_reddit_comment'
];

/**
 * Build a human-readable preview for a message tool
 * @param {string} toolName - The tool being called
 * @param {Object} toolInput - The tool input parameters
 * @param {Object} taskContext - Optional task context with contextMemory for name lookups
 */
function buildMessagePreview(toolName, toolInput, taskContext = null) {
  const preview = {
    type: toolName.replace('send_', '').replace('_', ' '),
    recipient: '',
    subject: '',
    message: '',
    platform: ''
  };
  
  switch (toolName) {
    case 'send_email':
      preview.platform = 'Email (Gmail)';
      preview.recipient = toolInput.to;
      preview.subject = toolInput.subject || '(no subject)';
      preview.message = toolInput.body;
      if (toolInput.cc) preview.cc = toolInput.cc;
      break;
    case 'send_imessage':
      preview.platform = 'iMessage / SMS';
      preview.recipient = toolInput.recipient;
      preview.message = toolInput.message;
      break;
    case 'send_slack_message':
      preview.platform = 'Slack';
      // Try to find a friendly name for the recipient
      let slackRecipient = toolInput.channel;
      
      // If channel looks like a Slack user ID (starts with U), try to find username in context
      if (slackRecipient && slackRecipient.startsWith('U') && taskContext?.contextMemory) {
        // Look for any key that ends with _username or _name and has a matching _slack_id
        for (const [key, value] of Object.entries(taskContext.contextMemory)) {
          if (key.endsWith('_slack_id') && value === slackRecipient) {
            // Found the matching ID, look for the username
            const prefix = key.replace('_slack_id', '');
            const usernameKey = `${prefix}_username`;
            const nameKey = `${prefix}_name`;
            if (taskContext.contextMemory[usernameKey]) {
              slackRecipient = `@${taskContext.contextMemory[usernameKey]}`;
              break;
            } else if (taskContext.contextMemory[nameKey]) {
              slackRecipient = taskContext.contextMemory[nameKey];
              break;
            }
          }
        }
      }
      
      // Also check if there's a recipientName provided directly
      if (toolInput.recipientName) {
        slackRecipient = toolInput.recipientName;
      }
      
      preview.recipient = slackRecipient;
      preview.message = toolInput.message || toolInput.text;
      break;
  }
  
  return preview;
}

/**
 * Request user confirmation for a message before sending
 * @param {string} toolName - The tool being called
 * @param {Object} toolInput - The tool input parameters
 * @param {Object} taskContext - Optional task context { taskId, autoSend }
 * @returns {Promise<boolean|Object>} - true if approved, throws if rejected, or {pendingInTask: true} if stored in task
 */
async function requestMessageConfirmation(toolName, toolInput, taskContext = null) {
  const confirmationId = `confirm_${++confirmationIdCounter}_${Date.now()}`;
  const preview = buildMessagePreview(toolName, toolInput, taskContext);
  
  console.log(`[Confirmation] Requesting approval for ${toolName} to ${preview.recipient}`);
  
  // If we're in a task context, check for auto-send or store as pending
  if (taskContext && taskContext.taskId) {
    // If task has auto-send enabled, skip confirmation
    if (taskContext.autoSend) {
      console.log(`[Confirmation] Task ${taskContext.taskId} has auto-send enabled, skipping confirmation`);
      return true;
    }
    
    // Otherwise, store the pending message in the task
    console.log(`[Confirmation] Storing pending message in task ${taskContext.taskId}`);
    
    const pendingMessage = {
      id: confirmationId,
      toolName,
      platform: preview.platform,
      recipient: preview.recipient,
      subject: preview.subject || '',
      message: preview.message,
      created: new Date().toISOString(),
      toolInput: JSON.stringify(toolInput) // Store original input for execution
    };
    
    // Add pending message to task
    await addPendingMessageToTask(taskContext.taskId, pendingMessage);
    
    // Notify UI about the pending message
    if (win && !win.isDestroyed()) {
      win.webContents.send('task:pendingMessage', {
        taskId: taskContext.taskId,
        message: pendingMessage
      });
    }
    
    // Return special object indicating message is pending in task
    return { pendingInTask: true, taskId: taskContext.taskId, messageId: confirmationId };
  }
  
  // Standard flow - show modal for immediate confirmation
  if (win && !win.isDestroyed()) {
    win.webContents.send('message:confirmationRequired', {
      confirmationId,
      toolName,
      preview
    });
  } else {
    console.error('[Confirmation] No window available for confirmation');
    throw new Error('Cannot send message: No UI available for confirmation');
  }
  
  // Wait for user response (with timeout)
  return new Promise((resolve, reject) => {
    const timeoutMs = 5 * 60 * 1000; // 5 minute timeout
    
    const timeout = setTimeout(() => {
      pendingConfirmations.delete(confirmationId);
      reject(new Error('Message confirmation timed out. User did not respond within 5 minutes.'));
    }, timeoutMs);
    
    pendingConfirmations.set(confirmationId, {
      resolve: (approved) => {
        clearTimeout(timeout);
        pendingConfirmations.delete(confirmationId);
        resolve(approved);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        pendingConfirmations.delete(confirmationId);
        reject(reason);
      },
      details: { toolName, toolInput, preview }
    });
  });
}

/**
 * Add a pending message to a task
 */
async function addPendingMessageToTask(taskId, pendingMessage) {
  const task = await getTask(taskId, currentUser?.username);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  
  // Initialize pendingMessages if needed
  if (!task.pendingMessages) {
    task.pendingMessages = [];
  }
  
  task.pendingMessages.push(pendingMessage);
  task.status = "waiting_approval"; // New status indicating message needs approval
  task.lastUpdated = new Date().toISOString();
  
  // Save the task
  const tasksDir = await getTasksDir(currentUser?.username);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  await fs.writeFile(taskPath, serializeTask(task), "utf8");
  
  // Notify about the update
  addTaskUpdate(taskId, `Message pending approval: ${pendingMessage.platform} to ${pendingMessage.recipient}`);
  
  console.log(`[Confirmation] Pending message added to task ${taskId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp State
// ─────────────────────────────────────────────────────────────────────────────
let whatsappSocket = null;
let whatsappQR = null;
let whatsappStatus = "disconnected"; // disconnected, connecting, connected, qr_ready
let whatsappSelfChatJid = null; // JID for the self-chat (to sync messages)
let whatsappAuthState = null;
let whatsappSaveCreds = null;

// Note: Session, auth, and utility functions are now imported from ./src

// ─────────────────────────────────────────────────────────────────────────────
// Wait-for-Reply Workflow Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use LLM to evaluate if a reply satisfies the success criteria
 * @param {Object} params - Evaluation parameters
 * @param {string} params.replyContent - The content of the reply
 * @param {string} params.originalRequest - What was originally requested
 * @param {string} params.successCriteria - What constitutes a satisfactory reply
 * @param {string} params.contact - Who the reply is from
 * @param {Object} apiKeys - API keys for LLM
 * @returns {Object} { satisfies: boolean, reason: string, extractedInfo: string }
 */
async function evaluateReplyWithLLM(params, apiKeys) {
  const { replyContent, originalRequest, successCriteria, contact } = params;
  
  if (!apiKeys?.anthropic) {
    console.log("[WaitForReply] No API key for LLM evaluation, assuming reply satisfies criteria");
    return { satisfies: true, reason: "No API key available for evaluation", extractedInfo: replyContent };
  }
  
  console.log(`[WaitForReply] Evaluating reply from ${contact}`);
  console.log(`[WaitForReply] Original request: ${originalRequest}`);
  console.log(`[WaitForReply] Success criteria: ${successCriteria}`);
  console.log(`[WaitForReply] Reply content: ${replyContent?.substring(0, 200)}...`);
  
  const prompt = `You are evaluating if a reply to a message satisfies the original request.

ORIGINAL REQUEST:
${originalRequest}

SUCCESS CRITERIA:
${successCriteria}

REPLY FROM ${contact}:
${replyContent}

TASK:
Determine if this reply satisfies the success criteria. Be reasonable - if the person has provided the requested information, even if not perfectly formatted, it should be considered satisfactory.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "satisfies": true or false,
  "reason": "Brief explanation of why the reply does or doesn't satisfy the criteria",
  "extractedInfo": "If satisfies=true, extract the key information from the reply. If satisfies=false, leave empty."
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKeys.anthropic,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });
    
    if (!response.ok) {
      console.error("[WaitForReply] LLM API error:", response.status);
      return { satisfies: false, reason: "LLM evaluation failed", extractedInfo: "" };
    }
    
    const data = await response.json();
    const content = data.content?.[0]?.text || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log(`[WaitForReply] Evaluation result: satisfies=${result.satisfies}, reason=${result.reason}`);
      return {
        satisfies: result.satisfies === true,
        reason: result.reason || "",
        extractedInfo: result.extractedInfo || ""
      };
    }
    
    console.log("[WaitForReply] Could not parse LLM response, assuming not satisfied");
    return { satisfies: false, reason: "Could not parse evaluation response", extractedInfo: "" };
    
  } catch (err) {
    console.error("[WaitForReply] Evaluation error:", err.message);
    return { satisfies: false, reason: `Evaluation error: ${err.message}`, extractedInfo: "" };
  }
}

/**
 * Generate a follow-up message using LLM based on the original request and any unsatisfactory reply
 * @param {Object} params - Generation parameters
 * @param {string} params.originalRequest - What was originally requested
 * @param {string} params.previousReply - The unsatisfactory reply (if any)
 * @param {string} params.reason - Why the previous reply was unsatisfactory
 * @param {number} params.followupCount - How many follow-ups have been sent
 * @param {boolean} params.isTimeout - Whether this is a timeout follow-up (no reply received)
 * @param {Object} apiKeys - API keys for LLM
 * @returns {string} The follow-up message to send
 */
async function generateFollowupMessage(params, apiKeys) {
  const { originalRequest, previousReply, reason, followupCount, isTimeout } = params;
  
  if (!apiKeys?.anthropic) {
    // Fallback message if no API key
    if (isTimeout) {
      return `Hi, I wanted to follow up on my previous message. ${originalRequest} Please let me know when you have a chance.`;
    }
    return `Thanks for your response. Could you please provide more details? ${originalRequest}`;
  }
  
  const prompt = `You need to write a polite follow-up message.

ORIGINAL REQUEST:
${originalRequest}

${isTimeout ? `This is follow-up #${followupCount + 1} because the recipient hasn't responded yet.` : `
THEIR PREVIOUS REPLY:
${previousReply}

WHY IT'S NOT SATISFACTORY:
${reason}
`}

TASK:
Write a brief, friendly follow-up message that:
1. Is polite and professional
2. ${isTimeout ? "Gently reminds them about the original request" : "Thanks them for their response and asks for the specific missing information"}
3. Is concise (2-3 sentences max)
4. Doesn't sound pushy or demanding

Respond with ONLY the message text, no quotes or explanations.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKeys.anthropic,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });
    
    if (!response.ok) {
      console.error("[WaitForReply] Follow-up generation API error:", response.status);
      return isTimeout 
        ? `Hi, just following up on my previous message. ${originalRequest}`
        : `Thanks for your response. Could you please provide: ${originalRequest}`;
    }
    
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || `Following up: ${originalRequest}`;
    
  } catch (err) {
    console.error("[WaitForReply] Follow-up generation error:", err.message);
    return isTimeout 
      ? `Hi, just following up on my previous message. ${originalRequest}`
      : `Thanks for your response. Could you please provide: ${originalRequest}`;
  }
}

/**
 * Send a follow-up message via the appropriate platform
 * @param {Object} params - Follow-up parameters
 * @param {string} params.platform - Platform to send via (email, imessage, slack, telegram, discord)
 * @param {string} params.contact - Recipient contact info
 * @param {string} params.message - The follow-up message to send
 * @param {string} params.conversationId - Thread/conversation ID to reply to
 * @param {Object} params.task - The task object for context
 * @param {string} username - Username for credential access
 * @returns {Object} Result with success status and details
 */
async function sendFollowupMessage(params, username) {
  const { platform, contact, message, conversationId, task } = params;
  
  console.log(`[WaitForReply] Sending follow-up via ${platform} to ${contact}`);
  
  try {
    let result;
    
    switch (platform) {
      case "email": {
        // Get Gmail access token using the correct function
        const googleAccessToken = await getGoogleAccessToken(username);
        if (!googleAccessToken) {
          return { success: false, error: "Google credentials not available for email follow-up" };
        }
        
        // To properly reply in the same thread, we need to fetch the latest message
        // in the thread to get its Message-ID header and original subject
        let replyToMessageId = task?.contextMemory?.last_message_id;
        let originalSubject = task?.contextMemory?.original_subject;
        
        // If we have a threadId, fetch the latest message to get proper threading info
        if (conversationId) {
          try {
            // Get all messages in the thread
            const threadResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${conversationId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`,
              { headers: { "Authorization": `Bearer ${googleAccessToken}` } }
            );
            
            if (threadResponse.ok) {
              const threadData = await threadResponse.json();
              const messages = threadData.messages || [];
              
              if (messages.length > 0) {
                // Get the latest message in the thread
                const latestMessage = messages[messages.length - 1];
                const headers = latestMessage.payload?.headers || [];
                
                // Extract Message-ID for In-Reply-To header
                const messageIdHeader = headers.find(h => h.name.toLowerCase() === 'message-id');
                if (messageIdHeader) {
                  replyToMessageId = messageIdHeader.value;
                }
                
                // Extract Subject (use first message for original subject)
                if (!originalSubject) {
                  const firstMessage = messages[0];
                  const firstHeaders = firstMessage.payload?.headers || [];
                  const subjectHeader = firstHeaders.find(h => h.name.toLowerCase() === 'subject');
                  if (subjectHeader) {
                    originalSubject = subjectHeader.value.replace(/^Re:\s*/i, ''); // Remove existing Re: prefix
                  }
                }
              }
            }
          } catch (err) {
            console.log(`[WaitForReply] Warning: Could not fetch thread info: ${err.message}`);
          }
        }
        
        // Build subject - ensure it starts with "Re: " for proper threading
        const subject = originalSubject 
          ? `Re: ${originalSubject}`
          : `Re: ${task?.contextMemory?.original_request?.substring(0, 50) || "Follow-up"}`;
        
        // Build email content with proper headers for threading
        let emailContent = `To: ${contact}\r\n`;
        
        // Add In-Reply-To and References headers for proper threading
        if (replyToMessageId) {
          emailContent += `In-Reply-To: ${replyToMessageId}\r\n`;
          emailContent += `References: ${replyToMessageId}\r\n`;
        }
        
        emailContent += `Subject: ${subject}\r\n`;
        emailContent += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
        emailContent += message;
        
        const encodedEmail = Buffer.from(emailContent).toString("base64")
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        
        // Build request body - include threadId for replies
        const requestBody = { raw: encodedEmail };
        if (conversationId) {
          requestBody.threadId = conversationId;
        }
        
        console.log(`[WaitForReply] Sending reply in thread ${conversationId}, subject: "${subject}", replyTo: ${replyToMessageId?.substring(0, 30)}...`);
        
        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errData = await response.text();
          throw new Error(`Failed to send email: ${errData}`);
        }
        
        const apiResult = await response.json();
        result = { 
          success: true, 
          message: `Follow-up email sent to ${contact} (thread: ${apiResult.threadId})`,
          messageId: apiResult.id,
          threadId: apiResult.threadId
        };
        break;
      }
      
      case "imessage": {
        const { sendMessage } = require("./src/integrations/imessage-integration");
        result = await sendMessage(contact, message);
        break;
      }
      
      case "slack": {
        // Get Slack access token using the correct function
        const slackAccessToken = await getSlackAccessToken(username);
        if (!slackAccessToken) {
          return { success: false, error: "Slack credentials not available for follow-up" };
        }
        
        const { postMessage } = require("./src/integrations/slack-integration");
        // For Slack, the conversationId is the channel/DM ID
        result = await postMessage(slackAccessToken, conversationId || contact, message);
        break;
      }
      
      case "telegram": {
        // Get Telegram bot token from settings
        const settingsPath = await getSettingsPath(username);
        let telegramBotToken = null;
        try {
          const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
          telegramBotToken = settings.telegramBotToken;
        } catch { /* No settings */ }
        
        if (!telegramBotToken) {
          return { success: false, error: "Telegram credentials not available for follow-up" };
        }
        
        const { sendMessage: sendTelegramMessage } = require("./src/integrations/telegram-integration");
        result = await sendTelegramMessage(telegramBotToken, conversationId || contact, message);
        break;
      }
      
      case "discord": {
        // Get Discord access token from settings
        const settingsPath = await getSettingsPath(username);
        let discordAccessToken = null;
        try {
          const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
          discordAccessToken = settings.discordTokens?.access_token;
        } catch { /* No settings */ }
        
        if (!discordAccessToken) {
          return { success: false, error: "Discord credentials not available for follow-up" };
        }
        
        const { sendMessage: sendDiscordMessage } = require("./src/integrations/discord-integration");
        result = await sendDiscordMessage(discordAccessToken, conversationId || contact, message);
        break;
      }
      
      default:
        return { success: false, error: `Unknown platform: ${platform}` };
    }
    
    return { 
      success: true, 
      result,
      message: `Follow-up sent to ${contact} via ${platform}` 
    };
    
  } catch (err) {
    console.error(`[WaitForReply] Error sending follow-up via ${platform}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let taskSchedulerInterval = null;

// Forward declaration - will be defined later after executeTaskStep
const startTaskScheduler = () => {
  if (taskSchedulerInterval) {
    clearInterval(taskSchedulerInterval);
  }

  // Poll every 60 seconds - lightweight checks are cheap, only run LLM when needed
  console.log("[Tasks] Starting task scheduler (checking every 60 seconds)");
  
  taskSchedulerInterval = setInterval(async () => {
    try {
      // Skip scheduler tick if no user is logged in
      if (!currentUser?.username) {
        return;
      }
      const tasks = await listActiveTasks(currentUser.username);
      const googleAccessToken = await getGoogleAccessToken(currentUser.username);
      const slackAccessToken = await getSlackAccessToken(currentUser.username);
      
      const waitingTasks = tasks.filter(t => t.status === "waiting");
      if (waitingTasks.length > 0) {
        console.log(`[Tasks] Scheduler tick: ${waitingTasks.length} waiting tasks`);
      }
      
      for (let task of tasks) {
        // Skip event-based tasks - they only run on specific events like login
        if (task.pollFrequency?.type === "event") {
          continue;
        }
        
        // Check if task needs execution
        if (task.status === "waiting" && task.nextCheck && Date.now() >= task.nextCheck) {
          console.log(`[Tasks] Processing task ${task.id}: nextCheck was ${new Date(task.nextCheck).toISOString()}`);
          
          // Check for unified messaging context (new system)
          const waitingVia = task.contextMemory?.waiting_via;
          const waitingForContact = task.contextMemory?.waiting_for_contact;
          const lastMessageTime = task.contextMemory?.last_message_time;
          
          console.log(`[Tasks] Task context: via=${waitingVia}, contact=${waitingForContact}, lastMsg=${lastMessageTime}`);
          
          // Also support legacy email context for backward compatibility
          const legacyWaitingForEmail = task.contextMemory?.waiting_for_email || task.contextMemory?.email;
          const legacyLastCheckTime = task.contextMemory?.last_email_check || task.contextMemory?.email_sent_time;
          
          // Try unified messaging first
          if (waitingVia && waitingForContact && lastMessageTime) {
            const integration = getMessagingIntegration(waitingVia);
            
            if (integration && integration.checkForNewMessages) {
              // Get the appropriate access token for this integration
              const accessToken = waitingVia === "email" ? googleAccessToken :
                                  waitingVia === "slack" ? slackAccessToken : null;
              
              // Get conversation/thread ID if available (for filtering to specific conversation)
              // This ensures we only see replies in the SAME thread, not from group chats or other conversations
              let conversationId = task.contextMemory?.conversation_id || task.contextMemory?.chat_id || null;
              
              // For iMessage tasks without a conversation_id, try to capture it now
              // This handles tasks created before the conversation tracking fix
              if (!conversationId && waitingVia === 'imessage') {
                const phoneNumber = task.contextMemory?.adaira_phone || 
                                   task.contextMemory?.[`${waitingForContact.toLowerCase()}_phone`] ||
                                   waitingForContact;
                console.log(`[Tasks] No conversation_id for iMessage task, attempting to capture for ${phoneNumber}`);
                try {
                  conversationId = await getIMessageChatId(phoneNumber);
                  if (conversationId) {
                    console.log(`[Tasks] Captured missing conversation_id: ${conversationId}`);
                    // Store it for future checks
                    await updateTask(task.id, {
                      contextMemory: { ...task.contextMemory, conversation_id: conversationId }
                    }, currentUser.username);
                  }
                } catch (err) {
                  console.error(`[Tasks] Failed to capture conversation_id: ${err.message}`);
                }
              }
              
              // Check if we have a valid conversation ID (not null, string "null", or unresolved template)
              const isUnresolvedTemplate = typeof conversationId === 'string' && 
                conversationId.startsWith('{{') && conversationId.endsWith('}}');
              const hasValidConversationId = conversationId && 
                conversationId !== "null" && 
                conversationId !== "undefined" && 
                !isUnresolvedTemplate;
              
              if (isUnresolvedTemplate) {
                console.log(`[Tasks] WARNING: conversation_id is unresolved template "${conversationId}" - will match any thread`);
              }
              console.log(`[Tasks] Checking ${integration.name} for reply from ${waitingForContact}${hasValidConversationId ? ` (thread: ${conversationId})` : ' (any thread)'}`);
              
              // Normalize: pass null if conversationId is invalid string
              const threadIdToPass = hasValidConversationId ? conversationId : null;
              const check = await integration.checkForNewMessages(
                waitingForContact, 
                new Date(lastMessageTime).getTime(),
                accessToken,
                threadIdToPass  // Pass null if no valid thread ID, so it matches ANY email from contact
              );
              
              if (!check.hasNew) {
                // No new messages - check if this is a wait_for_reply workflow with timeout
                if (task.contextMemory?.wait_for_reply_active) {
                  const waitStartTime = task.contextMemory.wait_started_at;
                  const followupAfterMs = (task.contextMemory.followup_after_hours || 24) * 60 * 60 * 1000;
                  const lastFollowupTime = task.contextMemory.last_followup_time;
                  const timeSinceStart = Date.now() - new Date(waitStartTime).getTime();
                  const timeSinceLastFollowup = lastFollowupTime 
                    ? Date.now() - new Date(lastFollowupTime).getTime() 
                    : timeSinceStart;
                  
                  // Check if we've waited long enough since last followup/start
                  if (timeSinceLastFollowup >= followupAfterMs) {
                    const currentFollowupCount = task.contextMemory.followup_count || 0;
                    const maxFollowups = task.contextMemory.max_followups || 3;
                    
                    if (currentFollowupCount >= maxFollowups) {
                      // Max follow-ups reached with no reply - notify user
                      console.log(`[Tasks] wait_for_reply timeout: max follow-ups (${maxFollowups}) reached for task ${task.id}`);
                      
                      await updateTask(task.id, {
                        status: "waiting_for_input",
                        contextMemory: {
                          ...task.contextMemory,
                          wait_for_reply_active: false,
                          max_followups_reached: true,
                          timeout_reached: true,
                          pendingClarification: `I've sent ${maxFollowups} follow-ups to ${waitingForContact} over the past ${Math.round(timeSinceStart / (1000 * 60 * 60))} hours but haven't received a reply. What would you like me to do?`
                        },
                        logEntry: `Timeout: No reply after ${maxFollowups} follow-ups - asking user for guidance`
                      }, currentUser.username);
                      
                      if (win) {
                        win.webContents.send("chat:newMessage", {
                          role: "assistant",
                          content: `⚠️ **Task: ${task.title}**\n\nI've sent ${maxFollowups} follow-up messages to ${waitingForContact} over the past ${Math.round(timeSinceStart / (1000 * 60 * 60))} hours, but haven't received a reply.\n\nOriginal request: "${task.contextMemory.original_request}"\n\nWhat would you like me to do?\n1. Keep trying\n2. Try a different approach\n3. Cancel this task`,
                          source: "task_question",
                          expectsResponse: true
                        });
                      }
                      
                      continue;
                    }
                    
                    // Send timeout follow-up
                    console.log(`[Tasks] wait_for_reply timeout - sending follow-up #${currentFollowupCount + 1} to ${waitingForContact}`);
                    
                    // Mark that we need to send a follow-up due to timeout
                    await updateTask(task.id, {
                      contextMemory: {
                        ...task.contextMemory,
                        needs_followup: true,
                        followup_is_timeout: true,
                        followup_reason: `No reply received after ${Math.round(timeSinceLastFollowup / (1000 * 60 * 60))} hours`
                      },
                      logEntry: `No reply in ${Math.round(timeSinceLastFollowup / (1000 * 60 * 60))} hours - preparing timeout follow-up #${currentFollowupCount + 1}`
                    }, currentUser.username);
                    
                    // Refresh task and fall through to executeTaskStep to handle the follow-up
                    task = await getTask(task.id, currentUser.username);
                    // Don't continue - let it fall through to executeTaskStep
                  } else {
                    // Not yet time for follow-up - reschedule
                    const pollInterval = task.pollFrequency?.type === "event" ? null : (task.pollFrequency?.value || 60000);
                    console.log(`[Tasks] No new ${integration.name} from ${waitingForContact}, rescheduling in ${pollInterval ? pollInterval/1000 + 's' : 'event-based'}`);
                    if (pollInterval) {
                      await updateTask(task.id, {
                        nextCheck: Date.now() + pollInterval,
                        contextMemory: { ...task.contextMemory, last_check_time: new Date().toISOString() }
                      }, currentUser.username);
                    }
                    continue;
                  }
                } else {
                  // Not a wait_for_reply workflow - standard reschedule
                  const pollInterval = task.pollFrequency?.type === "event" ? null : (task.pollFrequency?.value || 60000);
                  console.log(`[Tasks] No new ${integration.name} from ${waitingForContact}, rescheduling in ${pollInterval ? pollInterval/1000 + 's' : 'event-based'}`);
                  if (pollInterval) {
                    await updateTask(task.id, {
                      nextCheck: Date.now() + pollInterval,
                      contextMemory: { ...task.contextMemory, last_check_time: new Date().toISOString() }
                    }, currentUser.username);
                  }
                  continue; // Skip to next task
                }
              }
              
              console.log(`[Tasks] New ${integration.name} from ${waitingForContact}! Running executor.`);
              
              // Extract message preview from check result if available
              let messagePreview = '';
              let messages = [];
              if (check.messages && Array.isArray(check.messages)) {
                messages = check.messages;
                // Get preview of first/latest message
                const latestMsg = messages[0];
                if (latestMsg) {
                  messagePreview = latestMsg.snippet || latestMsg.text || latestMsg.body || '';
                  if (messagePreview.length > 200) {
                    messagePreview = messagePreview.substring(0, 200) + '...';
                  }
                }
              } else if (check.snippet) {
                messagePreview = check.snippet;
              } else if (check.text) {
                messagePreview = check.text;
              }
              
              // Log the received message in execution log
              const logMessage = messagePreview 
                ? `Received reply from ${waitingForContact} via ${integration.name}: "${messagePreview}"`
                : `Received reply from ${waitingForContact} via ${integration.name}`;
              
              // Update task context with info about new messages so executor knows a reply was received
              await updateTask(task.id, {
                contextMemory: { 
                  ...task.contextMemory, 
                  new_reply_detected: true,
                  new_reply_count: check.count || 1,
                  last_check_time: new Date().toISOString(),
                  last_reply_preview: messagePreview,
                  recent_messages: messages.slice(0, 5) // Store up to 5 recent messages
                },
                logEntry: logMessage
              }, currentUser.username);
              
              // Proactively notify user that a reply was received
              if (win) {
                const displayMessage = messagePreview 
                  ? `📬 **Task: ${task.title}**\n\nReceived a reply from ${waitingForContact} via ${integration.name}:\n\n> ${messagePreview}\n\nProcessing now...`
                  : `📬 **Task: ${task.title}**\n\nReceived a reply from ${waitingForContact} via ${integration.name}! Processing now...`;
                  
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: displayMessage,
                  source: "task"
                });
              }
              
              // If this is a wait_for_reply workflow, evaluate the reply with LLM
              if (task.contextMemory?.wait_for_reply_active) {
                console.log(`[Tasks] wait_for_reply active - evaluating reply for task ${task.id}`);
                
                // Get API keys from settings
                const settingsPath = await getSettingsPath(currentUser?.username);
                let apiKeys = {};
                try {
                  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                  apiKeys = settings.apiKeys || {};
                } catch {
                  console.error("[Tasks] Could not load API keys for reply evaluation");
                }
                
                // Get full reply content (prefer full content over snippet)
                let fullReplyContent = messagePreview;
                if (messages[0]) {
                  fullReplyContent = messages[0].body || messages[0].text || messages[0].snippet || messagePreview;
                }
                
                const evaluation = await evaluateReplyWithLLM({
                  replyContent: fullReplyContent,
                  originalRequest: task.contextMemory.original_request,
                  successCriteria: task.contextMemory.success_criteria,
                  contact: waitingForContact
                }, apiKeys);
                
                if (evaluation.satisfies) {
                  // Reply satisfies criteria - complete the task!
                  console.log(`[Tasks] Reply satisfies criteria - completing task ${task.id}`);
                  
                  await updateTask(task.id, {
                    status: "completed",
                    contextMemory: {
                      ...task.contextMemory,
                      wait_for_reply_active: false,
                      reply_satisfied: true,
                      extracted_info: evaluation.extractedInfo,
                      completed_at: new Date().toISOString()
                    },
                    logEntry: `Reply from ${waitingForContact} satisfied criteria: ${evaluation.reason}`
                  }, currentUser.username);
                  
                  // Notify user of completion
                  if (win && !task.notificationsDisabled) {
                    const completionMsg = evaluation.extractedInfo 
                      ? `✅ **Task Completed: ${task.title}**\n\nReceived satisfactory reply from ${waitingForContact}.\n\n**Extracted Information:**\n${evaluation.extractedInfo}`
                      : `✅ **Task Completed: ${task.title}**\n\nReceived satisfactory reply from ${waitingForContact}.`;
                    
                    win.webContents.send("chat:newMessage", {
                      role: "assistant",
                      content: completionMsg,
                      source: "task"
                    });
                  }
                  
                  continue; // Task complete, move to next task
                } else {
                  // Reply doesn't satisfy criteria - handle follow-up
                  console.log(`[Tasks] Reply doesn't satisfy criteria: ${evaluation.reason}`);
                  const currentFollowupCount = task.contextMemory.followup_count || 0;
                  const maxFollowups = task.contextMemory.max_followups || 3;
                  
                  if (currentFollowupCount >= maxFollowups) {
                    // Max follow-ups reached - notify user and pause
                    console.log(`[Tasks] Max follow-ups (${maxFollowups}) reached - notifying user`);
                    
                    await updateTask(task.id, {
                      status: "waiting_for_input",
                      contextMemory: {
                        ...task.contextMemory,
                        wait_for_reply_active: false,
                        max_followups_reached: true,
                        last_evaluation_reason: evaluation.reason,
                        pendingClarification: `I've sent ${maxFollowups} follow-ups to ${waitingForContact} but haven't received a satisfactory reply. What would you like me to do?`
                      },
                      logEntry: `Max follow-ups (${maxFollowups}) reached - asking user for guidance`
                    }, currentUser.username);
                    
                    if (win) {
                      win.webContents.send("chat:newMessage", {
                        role: "assistant",
                        content: `⚠️ **Task: ${task.title}**\n\nI've sent ${maxFollowups} follow-up messages to ${waitingForContact}, but their responses haven't contained the requested information (${task.contextMemory.original_request}).\n\nLast response: "${messagePreview}"\n\nWhat would you like me to do?\n1. Keep trying\n2. Try a different approach\n3. Cancel this task`,
                        source: "task_question",
                        expectsResponse: true
                      });
                    }
                    
                    continue; // Waiting for user input, move to next task
                  }
                  
                  // Send a follow-up message asking for the missing info
                  console.log(`[Tasks] Sending follow-up #${currentFollowupCount + 1} to ${waitingForContact}`);
                  
                  // Store that we need to send a follow-up - the actual sending will happen in executeTaskStep
                  // or we can directly send it here using the integration
                  await updateTask(task.id, {
                    contextMemory: {
                      ...task.contextMemory,
                      followup_count: currentFollowupCount + 1,
                      last_followup_time: new Date().toISOString(),
                      needs_followup: true,
                      followup_reason: evaluation.reason,
                      last_reply_content: fullReplyContent
                    },
                    logEntry: `Reply from ${waitingForContact} didn't satisfy criteria - preparing follow-up #${currentFollowupCount + 1}: ${evaluation.reason}`
                  }, currentUser.username);
                  
                  // Refresh task and fall through to executeTaskStep which will handle the follow-up
                  task = await getTask(task.id, currentUser.username);
                }
              }
            }
          }
          // Fall back to legacy email check
          else if (legacyWaitingForEmail && googleAccessToken && legacyLastCheckTime) {
            console.log(`[Tasks] Legacy email check for task ${task.id}: waiting for ${legacyWaitingForEmail}`);
            const emailCheck = await checkForNewEmails(googleAccessToken, legacyWaitingForEmail, new Date(legacyLastCheckTime).getTime());
            
            if (!emailCheck.hasNew) {
              // Reschedule using task's poll frequency
              const pollInterval = task.pollFrequency?.type === "event" ? null : (task.pollFrequency?.value || 60000);
              console.log(`[Tasks] No new emails from ${legacyWaitingForEmail}, rescheduling in ${pollInterval ? pollInterval/1000 + 's' : 'event-based'}`);
              if (pollInterval) {
                await updateTask(task.id, {
                  nextCheck: Date.now() + pollInterval,
                  contextMemory: { ...task.contextMemory, last_email_check: new Date().toISOString() }
                }, currentUser.username);
              }
              continue;
            }
            
            console.log(`[Tasks] New email found from ${legacyWaitingForEmail}! Running task executor.`);
          }
          
          console.log(`[Tasks] Executing scheduled check for task: ${task.id}`);
          await executeTaskStep(task.id, currentUser.username);
        }
      }
    } catch (err) {
      console.error("[Tasks] Scheduler error:", err.message);
    }
  }, 60000); // Check every 60 seconds
};

const stopTaskScheduler = () => {
  if (taskSchedulerInterval) {
    clearInterval(taskSchedulerInterval);
    taskSchedulerInterval = null;
    console.log("[Tasks] Stopped task scheduler");
  }
};

// Resume tasks on app startup
const resumeTasksOnStartup = async (username) => {
  console.log("[Tasks] Checking for tasks to resume...");
  
  if (!username) {
    console.log("[Tasks] No user logged in, skipping task resume");
    return;
  }
  
  try {
    const tasks = await listActiveTasks(username);
    
    for (const task of tasks) {
      // Log task state for debugging
      console.log(`[Tasks] Task ${task.id}: status=${task.status}, step=${task.currentStep?.step}, pending=${task.pendingMessages?.length || 0}`);
      
      if (task.status === "waiting_approval" && task.pendingMessages?.length > 0) {
        // Task has messages awaiting user approval - just notify, don't execute
        console.log(`[Tasks] Task ${task.id} has ${task.pendingMessages.length} messages awaiting approval`);
        addTaskUpdate(task.id, `Task resumed - ${task.pendingMessages.length} message(s) awaiting your approval`);
      } else if (task.status === "waiting" && task.nextCheck) {
        // Check if we missed any polls while app was closed
        if (Date.now() >= task.nextCheck) {
          console.log(`[Tasks] Resuming task: ${task.id} (missed scheduled check)`);
          // Schedule immediate check for replies
          setTimeout(() => executeTaskStep(task.id, username), 5000);
        } else {
          console.log(`[Tasks] Task ${task.id} will be checked at next scheduled time`);
        }
      } else if (task.status === "waiting" && !task.nextCheck) {
        // Waiting but no next check scheduled - set one up
        console.log(`[Tasks] Task ${task.id} is waiting but has no nextCheck - scheduling`);
        await updateTask(task.id, {
          nextCheck: Date.now() + 60000,
          logEntry: "Task resumed after app restart - checking for replies"
        }, username);
      } else if (task.status === "active") {
        console.log(`[Tasks] Task ${task.id} is active, will continue execution`);
        // Resume active tasks after a delay to let the app fully initialize
        setTimeout(() => executeTaskStep(task.id, username), 10000);
      }
    }
  } catch (err) {
    console.error("[Tasks] Failed to resume tasks:", err.message);
  }
};

// Run tasks that are configured to execute on login
const runOnLoginTasks = async (username) => {
  console.log("[Tasks] Checking for on-login tasks...");
  
  if (!username) {
    console.log("[Tasks] No user logged in, skipping on-login tasks");
    return;
  }
  
  try {
    const tasks = await listActiveTasks(username);
    
    // Find tasks with on_login poll frequency that are waiting or active
    const onLoginTasks = tasks.filter(task => 
      task.pollFrequency?.type === "event" && 
      task.pollFrequency?.value === "on_login" &&
      (task.status === "waiting" || task.status === "active")
    );
    
    if (onLoginTasks.length === 0) {
      console.log("[Tasks] No on-login tasks to run");
      return;
    }
    
    console.log(`[Tasks] Found ${onLoginTasks.length} on-login task(s) to execute`);
    
    for (const task of onLoginTasks) {
      console.log(`[Tasks] Running on-login task: ${task.id}`);
      
      // Add log entry
      await updateTask(task.id, {
        logEntry: "Task triggered by user login"
      }, username);
      
      // Execute the task with a small delay to let app initialize
      setTimeout(() => executeTaskStep(task.id, username), 3000);
    }
  } catch (err) {
    console.error("[Tasks] Failed to run on-login tasks:", err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Task Executor
// ─────────────────────────────────────────────────────────────────────────────

// Execute a single step of a task using the LLM
// This is a placeholder that will be replaced with the full implementation in app.whenReady()
let executeTaskStep = async (taskId) => {
  console.log(`[Tasks] Placeholder executeTaskStep called for: ${taskId}`);
  return { error: "Task executor not yet initialized" };
};

// This will be called from app.whenReady() to inject the real implementation
const setTaskExecutor = (executor) => {
  executeTaskStep = executor;
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Style Context - Retrieve user's sent messages to mimic their voice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the user's previously sent messages to a specific recipient
 * Used to analyze communication style and mimic the user's voice when drafting
 * @param {string} recipient - Email address, phone number, or Slack user/channel
 * @param {string} platform - 'email', 'slack', or 'imessage'
 * @param {object} options - { limit: number, accessToken: string, slackUserId: string }
 * @returns {{ messages: string[], hasHistory: boolean, recipient: string }}
 */
const getConversationStyleContext = async (recipient, platform, options = {}) => {
  const { limit = 10, accessToken, slackUserId } = options;
  const messages = [];
  
  console.log(`[StyleContext] Retrieving sent messages to ${recipient} via ${platform}`);
  
  try {
    switch (platform) {
      case 'email': {
        if (!accessToken) {
          console.log('[StyleContext] No Google access token, skipping email history');
          return { messages: [], hasHistory: false, recipient };
        }
        
        // Search for emails sent TO this recipient
        const query = `to:${recipient} in:sent`;
        const url = new URL("https://www.googleapis.com/gmail/v1/users/me/messages");
        url.searchParams.set("q", query);
        url.searchParams.set("maxResults", String(limit));
        
        const response = await fetch(url.toString(), {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        
        if (!response.ok) {
          console.error(`[StyleContext] Gmail API error: ${response.status}`);
          return { messages: [], hasHistory: false, recipient };
        }
        
        const data = await response.json();
        const messageIds = data.messages || [];
        
        // Fetch message bodies
        for (const msg of messageIds.slice(0, limit)) {
          try {
            const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
            const msgResponse = await fetch(msgUrl, {
              headers: { "Authorization": `Bearer ${accessToken}` }
            });
            
            if (msgResponse.ok) {
              const msgData = await msgResponse.json();
              // Extract body from payload
              let body = '';
              const payload = msgData.payload;
              
              if (payload.body?.data) {
                body = Buffer.from(payload.body.data, 'base64').toString('utf8');
              } else if (payload.parts) {
                // Look for text/plain part
                const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
                if (textPart?.body?.data) {
                  body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
                }
              }
              
              if (body && body.trim()) {
                // Clean up the body - remove quoted replies, signatures
                const cleanBody = body.split(/\n>|\nOn .* wrote:|\n--\s*\n/)[0].trim();
                if (cleanBody.length > 20) { // Only include substantial messages
                  messages.push(cleanBody.substring(0, 1000)); // Limit length
                }
              }
            }
          } catch (msgErr) {
            console.error(`[StyleContext] Error fetching email ${msg.id}:`, msgErr.message);
          }
        }
        break;
      }
      
      case 'slack': {
        if (!accessToken) {
          console.log('[StyleContext] No Slack access token, skipping Slack history');
          return { messages: [], hasHistory: false, recipient };
        }
        
        // First, resolve the recipient to a channel ID
        let channelId = recipient;
        let targetUserId = null;
        
        // If it's a user ID (starts with U), open DM channel
        if (/^U[A-Z0-9]+$/i.test(recipient)) {
          targetUserId = recipient;
          const dmResponse = await fetch("https://slack.com/api/conversations.open", {
            method: "POST",
            headers: { 
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ users: recipient })
          });
          const dmData = await dmResponse.json();
          if (dmData.ok && dmData.channel) {
            channelId = dmData.channel.id;
          }
        }
        // If it doesn't look like a channel ID, search for user by name
        else if (!/^[CDG][A-Z0-9]+$/i.test(recipient)) {
          const usersResponse = await fetch(`https://slack.com/api/users.list?limit=200`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
          });
          const usersData = await usersResponse.json();
          
          if (usersData.ok && usersData.members) {
            const user = usersData.members.find(m => 
              m.name?.toLowerCase().includes(recipient.toLowerCase()) ||
              m.real_name?.toLowerCase().includes(recipient.toLowerCase())
            );
            
            if (user) {
              targetUserId = user.id;
              const dmResponse = await fetch("https://slack.com/api/conversations.open", {
                method: "POST",
                headers: { 
                  "Authorization": `Bearer ${accessToken}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ users: user.id })
              });
              const dmData = await dmResponse.json();
              if (dmData.ok && dmData.channel) {
                channelId = dmData.channel.id;
              }
            }
          }
        }
        
        // Fetch conversation history
        const historyResponse = await fetch(
          `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit * 3}`,
          { headers: { "Authorization": `Bearer ${accessToken}` } }
        );
        const historyData = await historyResponse.json();
        
        if (historyData.ok && historyData.messages) {
          // Filter for messages FROM the current user (sent by user)
          const currentUserId = slackUserId;
          
          for (const msg of historyData.messages) {
            // Only include messages from the current user (sent messages)
            if (msg.user === currentUserId && msg.text && !msg.subtype) {
              const cleanText = msg.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // Remove mentions
              if (cleanText.length > 10) {
                messages.push(cleanText.substring(0, 500));
                if (messages.length >= limit) break;
              }
            }
          }
        }
        break;
      }
      
      case 'imessage': {
        const dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db");
        
        try {
          await fs.access(dbPath);
        } catch {
          console.log('[StyleContext] Cannot access Messages database');
          return { messages: [], hasHistory: false, recipient };
        }
        
        // Resolve contact name to phone if it contains letters
        let phoneFilter = recipient;
        if (/[a-zA-Z]/.test(recipient) && !/@/.test(recipient)) {
          // This is a name - we'll match against handle.id loosely
          phoneFilter = recipient.replace(/'/g, "''");
        }
        
        const digits = phoneFilter.replace(/\D/g, "");
        const lastDigits = digits.slice(-10);
        
        // Query for messages FROM ME to this contact (is_from_me = 1)
        const query = lastDigits 
          ? `SELECT m.text, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date FROM message m JOIN handle h ON m.handle_id = h.ROWID WHERE h.id LIKE '%${lastDigits}%' AND m.is_from_me = 1 AND m.text IS NOT NULL AND m.text != '' ORDER BY m.date DESC LIMIT ${limit}`
          : `SELECT m.text, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date FROM message m JOIN handle h ON m.handle_id = h.ROWID WHERE (h.id LIKE '%${phoneFilter}%') AND m.is_from_me = 1 AND m.text IS NOT NULL AND m.text != '' ORDER BY m.date DESC LIMIT ${limit}`;
        
        const { exec } = require("child_process");
        const result = await new Promise((resolve) => {
          exec(`sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
              console.error(`[StyleContext] iMessage query error: ${error.message}`);
              resolve([]);
              return;
            }
            try {
              const rows = stdout.trim() ? JSON.parse(stdout) : [];
              resolve(rows.map(r => r.text).filter(t => t && t.length > 10));
            } catch {
              resolve([]);
            }
          });
        });
        
        messages.push(...result.slice(0, limit));
        break;
      }
    }
    
    console.log(`[StyleContext] Found ${messages.length} sent messages to ${recipient} via ${platform}`);
    return { 
      messages, 
      hasHistory: messages.length > 0, 
      recipient,
      platform 
    };
    
  } catch (err) {
    console.error(`[StyleContext] Error retrieving messages: ${err.message}`);
    return { messages: [], hasHistory: false, recipient };
  }
};

/**
 * Generate a style guide by analyzing the user's previous messages
 * Uses a fast LLM call to summarize communication patterns
 * @param {string[]} messages - Array of user's sent messages
 * @param {string} recipient - Who the messages were sent to
 * @param {object} apiKeys - API keys for LLM providers
 * @param {string} activeProvider - Which LLM provider to use
 * @returns {{ styleGuide: string, formality: string }}
 */
const generateStyleGuide = async (messages, recipient, apiKeys, activeProvider) => {
  if (!messages || messages.length === 0) {
    return { styleGuide: null, formality: 'professional' };
  }
  
  console.log(`[StyleGuide] Analyzing ${messages.length} messages to generate style guide`);
  
  // Prepare sample messages for analysis (limit to avoid token overflow)
  const sampleMessages = messages.slice(0, 7).map((m, i) => `Message ${i + 1}: "${m.substring(0, 300)}${m.length > 300 ? '...' : ''}"`).join('\n\n');
  
  const analysisPrompt = `Analyze these messages I've sent to "${recipient}" and describe my communication style in 2-3 concise sentences. Focus on:
- Tone (casual, formal, friendly, direct, professional)
- Greeting and sign-off patterns (if any)
- Writing style (short/long sentences, emojis, exclamation points, bullet points)
- Any notable patterns or phrases I use

Messages:
${sampleMessages}

Respond with ONLY a brief style description (2-3 sentences max) that I can use as a guide for writing similar messages. Also indicate the formality level at the end as one word: casual, professional, or mixed.

Example format:
"Uses friendly, casual tone with short sentences. Often starts with 'Hey' and uses emojis. Tends to be direct and action-oriented. Formality: casual"`;

  try {
    let styleGuide = '';
    let formality = 'professional';
    
    // Use a fast model for style analysis
    if (apiKeys.anthropic) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeys.anthropic,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307", // Fast model for analysis
          max_tokens: 200,
          messages: [{ role: "user", content: analysisPrompt }]
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        styleGuide = result.content?.[0]?.text || '';
      }
    } else if (apiKeys.openai) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // Fast model for analysis
          max_tokens: 200,
          messages: [{ role: "user", content: analysisPrompt }]
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        styleGuide = result.choices?.[0]?.message?.content || '';
      }
    } else if (apiKeys.google) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeys.google}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analysisPrompt }] }],
          generationConfig: { maxOutputTokens: 200 }
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        styleGuide = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }
    
    // Extract formality from the response
    const formalityMatch = styleGuide.toLowerCase().match(/formality:\s*(casual|professional|mixed)/);
    if (formalityMatch) {
      formality = formalityMatch[1];
    }
    
    console.log(`[StyleGuide] Generated style guide (formality: ${formality})`);
    return { styleGuide: styleGuide.trim(), formality };
    
  } catch (err) {
    console.error(`[StyleGuide] Error generating style guide: ${err.message}`);
    return { styleGuide: null, formality: 'professional' };
  }
};

// Fetch calendar events for a date range
const fetchCalendarEvents = async (accessToken, startDate, endDate) => {
  const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calendarUrl.searchParams.set("timeMin", startDate.toISOString());
  calendarUrl.searchParams.set("timeMax", endDate.toISOString());
  calendarUrl.searchParams.set("singleEvents", "true");
  calendarUrl.searchParams.set("orderBy", "startTime");

  console.log(`[Calendar] Fetching events from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  const response = await fetch(calendarUrl.toString(), {
    headers: { "Authorization": `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Calendar] API Error (${response.status}):`, errorText);
    
    // Check for specific errors
    if (response.status === 403) {
      throw new Error("Calendar access denied. The Google Calendar API may not be enabled in your Google Cloud project, or you may need to reconnect Google to grant calendar permissions. Go to Integrations > Google and click 'Disconnect' then reconnect.");
    } else if (response.status === 401) {
      throw new Error("Calendar authentication expired. Please reconnect Google in Integrations.");
    }
    
    throw new Error(`Calendar API error (${response.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  console.log(`[Calendar] Found ${data.items?.length || 0} events`);
  
  return (data.items || []).map(event => ({
    id: event.id,
    title: event.summary || "(No title)",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location,
    description: event.description
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Connection Manager
// ─────────────────────────────────────────────────────────────────────────────

const getWhatsAppAuthDir = async (username) => {
  const dir = await getUserDataDir(username);
  const authDir = path.join(dir, "whatsapp-auth");
  await fs.mkdir(authDir, { recursive: true });
  return authDir;
};

const connectWhatsApp = async () => {
  try {
    whatsappStatus = "connecting";
    notifyWhatsAppStatus();

    const authDir = await getWhatsAppAuthDir();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    whatsappAuthState = state;
    whatsappSaveCreds = saveCreds;

    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ["Wovly", "Desktop", "1.0.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false
    });

    whatsappSocket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR code as data URL
        try {
          whatsappQR = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
          whatsappStatus = "qr_ready";
          notifyWhatsAppStatus();
        } catch (err) {
          console.error("QR code generation failed:", err);
        }
      }

      if (connection === "close") {
        whatsappSocket = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log("WhatsApp connection closed:", statusCode, "Reconnecting:", shouldReconnect);
        
        if (statusCode === DisconnectReason.loggedOut) {
          whatsappStatus = "disconnected";
          whatsappQR = null;
          // Clear auth state on logout
          try {
            const authDir = await getWhatsAppAuthDir();
            const files = await fs.readdir(authDir);
            for (const file of files) {
              await fs.unlink(path.join(authDir, file)).catch(() => {});
            }
          } catch (e) {
            console.error("Failed to clear auth:", e);
          }
        } else {
          whatsappStatus = "disconnected";
          // Auto-reconnect after short delay
          if (shouldReconnect) {
            setTimeout(() => connectWhatsApp(), 3000);
          }
        }
        notifyWhatsAppStatus();
      }

      if (connection === "open") {
        console.log("WhatsApp connected!");
        whatsappStatus = "connected";
        whatsappQR = null;
        notifyWhatsAppStatus();
      }
    });

    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
      if (!m.messages || m.type !== "notify") return;

      // Get own JID for self-message detection
      const ownJid = sock.user?.id || "";
      const ownNumber = ownJid.split("@")[0].split(":")[0]; // Extract just the phone number
      
      console.log("WhatsApp: Message event received, own number:", ownNumber);

      for (const msg of m.messages) {
        const remoteJid = msg.key.remoteJid || "";
        const remoteNumber = remoteJid.split("@")[0].split(":")[0];
        const isLidChat = remoteJid.endsWith("@lid"); // Linked ID format (used for self-chat)
        
        console.log("WhatsApp: Processing message - fromMe:", msg.key.fromMe, "remoteJid:", remoteJid, "isLidChat:", isLidChat);
        
        // Skip status updates
        if (remoteJid === "status@broadcast") {
          console.log("WhatsApp: Skipping status broadcast");
          continue;
        }

        // Check if this is a self-message:
        // 1. Same phone number (traditional format)
        // 2. OR it's a @lid chat with fromMe=true (WhatsApp's "Message yourself" feature)
        const isSelfMessage = (ownNumber && remoteNumber === ownNumber) || (isLidChat && msg.key.fromMe);
        console.log("WhatsApp: isSelfMessage:", isSelfMessage);
        
        // Store the self-chat JID for syncing messages from the app
        if (isSelfMessage && !whatsappSelfChatJid) {
          whatsappSelfChatJid = remoteJid;
          console.log("WhatsApp: Stored self-chat JID:", whatsappSelfChatJid);
        }
        
        // For regular chats: skip messages from self (we don't want to respond to our own messages)
        // For self-chats: we WANT to process fromMe messages (that's how self-messaging works)
        if (msg.key.fromMe && !isSelfMessage) {
          console.log("WhatsApp: Skipping - fromMe is true and not self-message");
          continue;
        }

        // Debug: log the full message structure to understand format
        console.log("WhatsApp: Message structure:", JSON.stringify(msg.message, null, 2));

        // Get the message text - try multiple possible locations
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text ||
                     msg.message?.imageMessage?.caption ||
                     msg.message?.videoMessage?.caption ||
                     msg.message?.buttonsResponseMessage?.selectedDisplayText ||
                     msg.message?.listResponseMessage?.title ||
                     msg.message?.templateButtonReplyMessage?.selectedDisplayText ||
                     // For edited messages
                     msg.message?.editedMessage?.message?.conversation ||
                     msg.message?.editedMessage?.message?.extendedTextMessage?.text ||
                     // Protocol messages sometimes wrap the actual message
                     msg.message?.protocolMessage?.editedMessage?.message?.conversation ||
                     msg.message?.protocolMessage?.editedMessage?.message?.extendedTextMessage?.text;

        if (!text) {
          console.log("WhatsApp: Skipping - no text content found in message");
          continue;
        }

        // Skip if this looks like a Wovly response (to prevent loops)
        if (text.startsWith("[Wovly]")) {
          console.log("WhatsApp: Skipping - Wovly response (loop prevention)");
          continue;
        }

        console.log("WhatsApp message from:", remoteJid, isSelfMessage ? "(self)" : "", ":", text);

        // Notify UI about the incoming message (for sync)
        if (win && !win.isDestroyed()) {
          win.webContents.send("chat:newMessage", {
            role: "user",
            content: text,
            source: "whatsapp",
            timestamp: Date.now()
          });
        }

        // Process message with LLM
        try {
          const response = await processWhatsAppMessage(text, remoteJid);
          
          // Send response back (prefix self-messages to identify Wovly responses)
          if (response && whatsappSocket) {
            const responseText = isSelfMessage ? `[Wovly] ${response}` : response;
            console.log("WhatsApp: Sending response:", responseText.substring(0, 100) + "...");
            await whatsappSocket.sendMessage(remoteJid, { text: responseText });
            
            // Notify UI about the AI response (for sync)
            if (win && !win.isDestroyed()) {
              win.webContents.send("chat:newMessage", {
                role: "assistant",
                content: response, // Send without [Wovly] prefix for clean display
                source: "whatsapp",
                timestamp: Date.now()
              });
            }
          }
        } catch (err) {
          console.error("Error processing WhatsApp message:", err);
        }
      }
    });

  } catch (err) {
    console.error("WhatsApp connection error:", err);
    whatsappStatus = "disconnected";
    notifyWhatsAppStatus();
  }
};

const disconnectWhatsApp = async () => {
  if (whatsappSocket) {
    await whatsappSocket.logout().catch(() => {});
    whatsappSocket = null;
  }
  whatsappStatus = "disconnected";
  whatsappQR = null;
  
  // Clear auth state
  try {
    const authDir = await getWhatsAppAuthDir();
    const files = await fs.readdir(authDir);
    for (const file of files) {
      await fs.unlink(path.join(authDir, file)).catch(() => {});
    }
  } catch (e) {
    console.error("Failed to clear auth:", e);
  }
  
  notifyWhatsAppStatus();
};

const notifyWhatsAppStatus = () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send("whatsapp:status", {
      status: whatsappStatus,
      qr: whatsappQR
    });
  }
};

// Process incoming external message with LLM - uses SAME tools as main chat
// This is a placeholder that will be replaced with full tool access in app.whenReady()
// Shared by WhatsApp, Telegram, and other chat interfaces
let processExternalMessage = async (text, senderId, source) => {
  console.log(`[${source}] Placeholder processExternalMessage called`);
  return "Sorry, the message processor is still initializing. Please try again in a moment.";
};

// Legacy alias for WhatsApp compatibility
let processWhatsAppMessage = async (text, senderId) => {
  return processExternalMessage(text, senderId, "WhatsApp");
};

// This will be called from app.whenReady() to inject the real implementation with full tool access
const setExternalMessageProcessor = (processor) => {
  processExternalMessage = processor;
  // Keep processWhatsAppMessage in sync
  processWhatsAppMessage = async (text, senderId) => processor(text, senderId, "WhatsApp");
};

// Legacy alias
const setWhatsAppMessageProcessor = setExternalMessageProcessor;

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Chat Interface (similar to WhatsApp)
// Uses the bot token from integrations to receive and respond to messages
// ─────────────────────────────────────────────────────────────────────────────

let telegramInterfaceActive = false;
let telegramPollingInterval = null;
let telegramLastUpdateId = 0;
let telegramInterfaceStatus = "disconnected"; // disconnected, connecting, connected

const notifyTelegramInterfaceStatus = () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send("telegram:interfaceStatus", {
      status: telegramInterfaceStatus
    });
  }
};

const connectTelegramInterface = async () => {
  const botToken = await getTelegramToken();
  if (!botToken) {
    throw new Error("Telegram bot not configured. Please set up Telegram in the Integrations page first.");
  }

  telegramInterfaceStatus = "connecting";
  notifyTelegramInterfaceStatus();

  // Test the bot token
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || "Invalid bot token");
    }
    console.log(`[Telegram Interface] Bot connected: @${data.result.username}`);
  } catch (err) {
    telegramInterfaceStatus = "disconnected";
    notifyTelegramInterfaceStatus();
    throw err;
  }

  telegramInterfaceActive = true;
  telegramInterfaceStatus = "connected";
  notifyTelegramInterfaceStatus();

  // Save enabled state for auto-reconnect
  try {
    const settingsPath = await getSettingsPath(currentUser?.username);
    let settings = {};
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    } catch { /* No settings */ }
    settings.telegramInterfaceEnabled = true;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("[Telegram Interface] Failed to save enabled state:", err.message);
  }

  // Start long-polling for messages
  const pollForMessages = async () => {
    if (!telegramInterfaceActive) return;

    const token = await getTelegramToken();
    if (!token) {
      telegramInterfaceActive = false;
      telegramInterfaceStatus = "disconnected";
      notifyTelegramInterfaceStatus();
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${telegramLastUpdateId + 1}&timeout=30`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          telegramLastUpdateId = update.update_id;

          // Process message
          const message = update.message;
          if (!message || !message.text) continue;

          const chatId = message.chat.id;
          const text = message.text;
          const fromUser = message.from?.first_name || message.from?.username || "User";

          // Skip bot's own messages (loop prevention)
          if (text.startsWith("[Wovly]")) {
            continue;
          }

          console.log(`[Telegram Interface] Message from ${fromUser}: ${text.substring(0, 50)}...`);

          // Notify UI about incoming message
          if (win && !win.isDestroyed()) {
            win.webContents.send("chat:newMessage", {
              role: "user",
              content: text,
              source: "telegram",
              timestamp: Date.now()
            });
          }

          // Process with LLM (reusing the same processor as WhatsApp)
          try {
            const response = await processExternalMessage(text, chatId.toString(), "Telegram");

            if (response) {
              // Send response back via Telegram
              const sendResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: `[Wovly] ${response}`,
                  parse_mode: "Markdown"
                })
              });

              if (!sendResponse.ok) {
                console.error("[Telegram Interface] Failed to send response");
              }

              // Notify UI about AI response
              if (win && !win.isDestroyed()) {
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: response,
                  source: "telegram",
                  timestamp: Date.now()
                });
              }
            }
          } catch (err) {
            console.error("[Telegram Interface] Error processing message:", err.message);
          }
        }
      }
    } catch (err) {
      console.error("[Telegram Interface] Polling error:", err.message);
    }

    // Continue polling if still active
    if (telegramInterfaceActive) {
      telegramPollingInterval = setTimeout(pollForMessages, 1000);
    }
  };

  // Start polling
  pollForMessages();
  console.log("[Telegram Interface] Started message polling");
};

const disconnectTelegramInterface = async () => {
  telegramInterfaceActive = false;
  if (telegramPollingInterval) {
    clearTimeout(telegramPollingInterval);
    telegramPollingInterval = null;
  }
  telegramInterfaceStatus = "disconnected";
  notifyTelegramInterfaceStatus();
  
  // Clear enabled state
  try {
    const settingsPath = await getSettingsPath(currentUser?.username);
    let settings = {};
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    } catch { /* No settings */ }
    settings.telegramInterfaceEnabled = false;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("[Telegram Interface] Failed to clear enabled state:", err.message);
  }
  
  console.log("[Telegram Interface] Disconnected");
};

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    // In packaged app, UI is in resources/ui folder
    const uiPath = path.join(process.resourcesPath, "ui", "index.html");
    win.loadFile(uiPath);
  }
}

app.whenReady().then(async () => {
  createWindow();
  
  // Set main window reference for task notifications
  setMainWindow(win);

  // Process old memory files (summarize and move to longterm) - deferred until user logs in
  // This will be triggered after login via auth:login handler

  // Start task scheduler (tasks are resumed after user login)
  startTaskScheduler();
  
  // Auto-reconnect WhatsApp if previously connected
  try {
    const authDir = await getWhatsAppAuthDir();
    const files = await fs.readdir(authDir);
    const hasAuth = files.some(f => f.includes("creds"));
    
    if (hasAuth) {
      console.log("[WhatsApp] Found saved auth state, auto-reconnecting...");
      // Slight delay to let the window initialize
      setTimeout(async () => {
        try {
          await connectWhatsApp();
          console.log("[WhatsApp] Auto-reconnect initiated");
        } catch (err) {
          console.error("[WhatsApp] Auto-reconnect failed:", err.message);
        }
      }, 2000);
    }
  } catch (err) {
    console.log("[WhatsApp] No saved auth state found");
  }

  // Auto-reconnect Telegram interface if it was previously active
  try {
    const settingsPath = await getSettingsPath(currentUser?.username);
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    
    if (settings.telegramInterfaceEnabled && settings.telegramBotToken) {
      console.log("[Telegram Interface] Found saved state, auto-reconnecting...");
      setTimeout(async () => {
        try {
          await connectTelegramInterface();
          console.log("[Telegram Interface] Auto-reconnect initiated");
        } catch (err) {
          console.error("[Telegram Interface] Auto-reconnect failed:", err.message);
        }
      }, 3000);
    }
  } catch (err) {
    console.log("[Telegram Interface] No saved state found");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Auto-reconnect new integrations on startup
  // ─────────────────────────────────────────────────────────────────────────────
  
  const refreshIntegrationsOnStartup = async () => {
    console.log("[Integrations] Checking saved integrations...");
    const settingsPath = await getSettingsPath(currentUser?.username);
    let settings = {};
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    } catch {
      return; // No settings file yet
    }

    let updated = false;

    // Telegram - Verify bot token still works
    if (settings.telegramBotToken) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
        const data = await response.json();
        if (data.ok) {
          console.log(`[Telegram] Connected as @${data.result.username}`);
        } else {
          console.log("[Telegram] Token invalid, clearing...");
          delete settings.telegramBotToken;
          updated = true;
        }
      } catch (err) {
        console.log("[Telegram] Connection check failed:", err.message);
      }
    }

    // Discord - Refresh token if needed
    if (settings.discordTokens?.refresh_token) {
      try {
        if (Date.now() > (settings.discordTokens.expires_at || 0) - 60000) {
          console.log("[Discord] Refreshing token...");
          const refreshed = await refreshDiscordToken(settings.discordTokens);
          if (refreshed) {
            settings.discordTokens = refreshed;
            updated = true;
            console.log("[Discord] Token refreshed successfully");
          } else {
            console.log("[Discord] Token refresh failed, user may need to re-authorize");
          }
        } else {
          console.log("[Discord] Token still valid");
        }
      } catch (err) {
        console.log("[Discord] Token refresh error:", err.message);
      }
    }

    // X (Twitter) - Refresh token if needed
    if (settings.xTokens?.refresh_token) {
      try {
        if (Date.now() > (settings.xTokens.expires_at || 0) - 60000) {
          console.log("[X] Refreshing token...");
          const refreshed = await refreshXToken(settings.xTokens);
          if (refreshed) {
            settings.xTokens = refreshed;
            updated = true;
            console.log("[X] Token refreshed successfully");
          } else {
            console.log("[X] Token refresh failed, user may need to re-authorize");
          }
        } else {
          console.log("[X] Token still valid");
        }
      } catch (err) {
        console.log("[X] Token refresh error:", err.message);
      }
    }

    // Notion - Tokens don't expire, just verify connection
    if (settings.notionTokens?.access_token) {
      try {
        const response = await fetch("https://api.notion.com/v1/users/me", {
          headers: {
            "Authorization": `Bearer ${settings.notionTokens.access_token}`,
            "Notion-Version": "2022-06-28"
          }
        });
        if (response.ok) {
          const data = await response.json();
          console.log(`[Notion] Connected as ${data.name || "user"}`);
        } else {
          console.log("[Notion] Token invalid, clearing...");
          delete settings.notionTokens;
          updated = true;
        }
      } catch (err) {
        console.log("[Notion] Connection check failed:", err.message);
      }
    }

    // GitHub - Tokens don't expire, just verify connection
    if (settings.githubTokens?.access_token) {
      try {
        const response = await fetch("https://api.github.com/user", {
          headers: {
            "Authorization": `Bearer ${settings.githubTokens.access_token}`,
            "Accept": "application/vnd.github+json"
          }
        });
        if (response.ok) {
          const data = await response.json();
          console.log(`[GitHub] Connected as @${data.login}`);
        } else {
          console.log("[GitHub] Token invalid, clearing...");
          delete settings.githubTokens;
          updated = true;
        }
      } catch (err) {
        console.log("[GitHub] Connection check failed:", err.message);
      }
    }

    // Asana - Refresh token if needed
    if (settings.asanaTokens?.refresh_token) {
      try {
        if (Date.now() > (settings.asanaTokens.expires_at || 0) - 60000) {
          console.log("[Asana] Refreshing token...");
          const refreshed = await refreshAsanaToken(settings.asanaTokens);
          if (refreshed) {
            settings.asanaTokens = refreshed;
            updated = true;
            console.log("[Asana] Token refreshed successfully");
          } else {
            console.log("[Asana] Token refresh failed, user may need to re-authorize");
          }
        } else {
          console.log("[Asana] Token still valid");
        }
      } catch (err) {
        console.log("[Asana] Token refresh error:", err.message);
      }
    }

    // Reddit - Refresh token if needed
    if (settings.redditTokens?.refresh_token) {
      try {
        if (Date.now() > (settings.redditTokens.expires_at || 0) - 60000) {
          console.log("[Reddit] Refreshing token...");
          const refreshed = await refreshRedditToken(settings.redditTokens);
          if (refreshed) {
            settings.redditTokens = refreshed;
            updated = true;
            console.log("[Reddit] Token refreshed successfully");
          } else {
            console.log("[Reddit] Token refresh failed, user may need to re-authorize");
          }
        } else {
          console.log("[Reddit] Token still valid");
        }
      } catch (err) {
        console.log("[Reddit] Token refresh error:", err.message);
      }
    }

    // Spotify - Refresh token if needed
    if (settings.spotifyTokens?.refresh_token) {
      try {
        if (Date.now() > (settings.spotifyTokens.expires_at || 0) - 60000) {
          console.log("[Spotify] Refreshing token...");
          const refreshed = await refreshSpotifyToken(settings.spotifyTokens);
          if (refreshed) {
            settings.spotifyTokens = refreshed;
            updated = true;
            console.log("[Spotify] Token refreshed successfully");
          } else {
            console.log("[Spotify] Token refresh failed, user may need to re-authorize");
          }
        } else {
          console.log("[Spotify] Token still valid");
        }
      } catch (err) {
        console.log("[Spotify] Token refresh error:", err.message);
      }
    }

    // Save updated tokens if any were refreshed
    if (updated) {
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      console.log("[Integrations] Saved refreshed tokens");
    }

    console.log("[Integrations] Startup check complete");
  };

  // Run integration refresh with a slight delay to not block app startup
  setTimeout(() => {
    refreshIntegrationsOnStartup().catch(err => {
      console.error("[Integrations] Startup refresh error:", err.message);
    });
  }, 1000);

  // Settings handlers
  ipcMain.handle("settings:get", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: true, settings: {} };
      }
      const settingsPath = await getSettingsPath(currentUser.username);
      const data = await fs.readFile(settingsPath, "utf8");
      return { ok: true, settings: JSON.parse(data) };
    } catch {
      return { ok: true, settings: {} };
    }
  });

  ipcMain.handle("settings:set", async (_event, { settings }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const settingsPath = await getSettingsPath(currentUser.username);
      let existing = {};
      try {
        existing = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch {
        // No existing settings
      }
      const merged = { ...existing, ...settings };
      await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Profile handlers
  ipcMain.handle("profile:get", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      return { ok: true, profile };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("profile:update", async (_event, { updates }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      Object.assign(profile, updates);
      const newMarkdown = serializeUserProfile(profile);
      await fs.writeFile(profilePath, newMarkdown, "utf8");
      return { ok: true, profile };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("profile:needsOnboarding", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: true, needsOnboarding: false };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      
      // Use the new onboardingStage field
      const needsOnboarding = profile.onboardingStage !== "completed";
      
      return { ok: true, needsOnboarding, profile };
    } catch {
      return { ok: true, needsOnboarding: false };
    }
  });

  // Add facts to profile (with conflict resolution)
  ipcMain.handle("profile:addFacts", async (_event, { facts, conflictResolutions }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      profile.notes = profile.notes || [];
      
      // Handle conflict resolutions (remove old notes that are being replaced)
      if (conflictResolutions && conflictResolutions.length > 0) {
        for (const resolution of conflictResolutions) {
          if (resolution.keepNew) {
            // Remove the old conflicting note
            const existingIndex = profile.notes.findIndex(n => n === resolution.existingNote);
            if (existingIndex > -1) {
              console.log(`[Profile] Removing conflicting note: "${resolution.existingNote}"`);
              profile.notes.splice(existingIndex, 1);
            }
          }
        }
      }
      
      // Add facts (skip those where user chose to keep existing)
      for (const fact of facts) {
        const conflictRes = conflictResolutions?.find(r => r.newFact === fact.summary);
        if (conflictRes && !conflictRes.keepNew) {
          console.log(`[Profile] Skipping fact (user kept existing): "${fact.summary}"`);
          continue; // User chose to keep existing, don't add new
        }
        console.log(`[Profile] Adding fact: "${fact.summary}"`);
        profile.notes.push(fact.summary);
      }
      
      await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
      console.log(`[Profile] Saved profile with ${profile.notes.length} notes`);
      return { ok: true };
    } catch (err) {
      console.error("[Profile] Error adding facts:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // Get raw profile markdown (for About Me page)
  ipcMain.handle("profile:getMarkdown", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      return { ok: true, markdown };
    } catch (err) {
      console.error("[Profile] Error reading markdown:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // Save raw profile markdown (for About Me page editor)
  ipcMain.handle("profile:saveMarkdown", async (_event, markdown) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const profilePath = await getUserProfilePath(currentUser.username);
      await fs.writeFile(profilePath, markdown, "utf8");
      console.log("[Profile] Saved profile markdown");
      return { ok: true };
    } catch (err) {
      console.error("[Profile] Error saving markdown:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // Onboarding handlers
  ipcMain.handle("onboarding:getStatus", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      
      // Check if any API keys are configured
      const settingsPath = await getSettingsPath(currentUser.username);
      let hasApiKeys = false;
      try {
        const settingsData = await fs.readFile(settingsPath, "utf8");
        const settings = JSON.parse(settingsData);
        // Check for any LLM API keys
        hasApiKeys = !!(
          settings.anthropicApiKey || 
          settings.openaiApiKey || 
          settings.googleApiKey ||
          settings.deepseekApiKey ||
          settings.ollamaEndpoint
        );
      } catch {
        // No settings file means no API keys
      }
      
      // Get current onboarding stage from profile
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      
      // Check if they have any integrations connected
      let hasIntegrations = false;
      try {
        const settingsData = await fs.readFile(settingsPath, "utf8");
        const settings = JSON.parse(settingsData);
        hasIntegrations = !!(
          settings.googleAccessToken ||
          settings.slackAccessToken ||
          settings.weatherEnabled ||
          settings.browserEnabled ||
          settings.telegramToken ||
          settings.discordAccessToken ||
          settings.notionAccessToken ||
          settings.githubAccessToken
        );
      } catch {
        // No settings
      }
      
      // Check if they have any tasks
      let hasTask = false;
      try {
        const tasksDir = await getTasksDir(currentUser.username);
        const files = await fs.readdir(tasksDir);
        hasTask = files.some(f => f.endsWith('.md'));
      } catch {
        // No tasks
      }
      
      // Check if they have any skills
      let hasSkill = false;
      try {
        const skillsDir = await getSkillsDir(currentUser.username);
        const files = await fs.readdir(skillsDir);
        hasSkill = files.some(f => f.endsWith('.md'));
      } catch {
        // No skills
      }
      
      console.log(`[Onboarding] Status: stage=${profile.onboardingStage}, hasApiKeys=${hasApiKeys}, hasTask=${hasTask}, hasSkill=${hasSkill}, hasIntegrations=${hasIntegrations}`);
      
      return { 
        ok: true, 
        stage: profile.onboardingStage,
        skippedAt: profile.onboardingSkippedAt,
        hasApiKeys,
        hasTask,
        hasSkill,
        hasIntegrations,
        profileComplete: !!(profile.firstName && profile.firstName !== "User" && profile.occupation)
      };
    } catch (err) {
      console.error("[Onboarding] Error getting status:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("onboarding:setStage", async (_event, { stage }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      
      if (!ONBOARDING_STAGES.includes(stage)) {
        return { ok: false, error: `Invalid stage: ${stage}. Valid stages: ${ONBOARDING_STAGES.join(", ")}` };
      }
      
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      
      profile.onboardingStage = stage;
      // Clear skipped status when advancing
      if (stage !== profile.onboardingStage) {
        profile.onboardingSkippedAt = null;
      }
      
      await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
      console.log(`[Onboarding] Set stage to: ${stage}`);
      
      return { ok: true, stage };
    } catch (err) {
      console.error("[Onboarding] Error setting stage:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("onboarding:skip", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      
      const profilePath = await getUserProfilePath(currentUser.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);
      
      profile.onboardingStage = "completed";
      profile.onboardingSkippedAt = new Date().toISOString();
      
      await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
      console.log("[Onboarding] Skipped onboarding");
      
      return { ok: true };
    } catch (err) {
      console.error("[Onboarding] Error skipping:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // Skills handlers
  ipcMain.handle("skills:list", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: true, skills: [] };
      }
      const skills = await loadAllSkills(currentUser.username);
      return { ok: true, skills };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("skills:get", async (_event, { skillId }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const skillsDir = await getSkillsDir(currentUser.username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      const content = await fs.readFile(filePath, "utf8");
      const skill = parseSkill(content, `${skillId}.md`);
      return { ok: true, skill, content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("skills:save", async (_event, { skillId, content }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const skillsDir = await getSkillsDir(currentUser.username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      await fs.writeFile(filePath, content, "utf8");
      const skill = parseSkill(content, `${skillId}.md`);
      return { ok: true, skill };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("skills:delete", async (_event, { skillId }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const skillsDir = await getSkillsDir(currentUser.username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      await fs.unlink(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("skills:getTemplate", async () => {
    const template = `# New Skill

## Description
Describe what this skill does and when it should be used.

## Keywords
keyword1, keyword2, keyword3

## Procedure
1. First step
2. Second step
3. Third step

## Constraints
- Important constraint or rule
- Another constraint
`;
    return { ok: true, template };
  });

  // LLM-powered welcome message generator
  ipcMain.handle("welcome:generate", async () => {
    try {
      // Get current time info
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      // Determine time of day
      let timeOfDay;
      if (hour >= 5 && hour < 12) {
        timeOfDay = "morning";
      } else if (hour >= 12 && hour < 17) {
        timeOfDay = "afternoon";
      } else if (hour >= 17 && hour < 21) {
        timeOfDay = "evening";
      } else {
        timeOfDay = "night";
      }

      // Get user profile
      let profile = null;
      try {
        const profilePath = await getUserProfilePath(currentUser?.username);
        const markdown = await fs.readFile(profilePath, "utf8");
        profile = parseUserProfile(markdown);
      } catch {
        // Profile not available
      }

      // Check if any API keys are configured
      const settingsPath = await getSettingsPath(currentUser?.username);
      let hasApiKeys = false;
      let apiKeys = {};
      let models = {};
      let activeProvider = "anthropic";
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        apiKeys = settings.apiKeys || {};
        models = settings.models || {};
        activeProvider = settings.activeProvider || "anthropic";
        hasApiKeys = !!(
          apiKeys.anthropic || 
          apiKeys.openai || 
          apiKeys.google ||
          apiKeys.deepseek ||
          settings.ollamaEndpoint
        );
      } catch {
        // No settings file
      }

      // ONBOARDING STAGE 0: API Setup
      // If no API keys, show API setup message
      if (!hasApiKeys) {
        console.log("[Onboarding] No API keys configured, showing setup message");
        return {
          ok: true,
          message: `Welcome to Wovly! I'm your AI assistant.\n\nTo get started, you'll need to connect me to an AI provider. Head to **Settings** and add an API key from Anthropic, OpenAI, or Google.\n\nOnce configured, I'll help you set up your profile and show you what I can do!`,
          needsApiSetup: true,
          onboardingStage: "api_setup",
          timeOfDay,
          profile
        };
      }

      // Check onboarding stage
      const onboardingStage = profile?.onboardingStage || "api_setup";
      
      // ONBOARDING STAGE 1: Profile Questions
      if (onboardingStage === "api_setup" || onboardingStage === "profile") {
        // If they have API keys but are still in api_setup stage, advance to profile
        if (onboardingStage === "api_setup" && hasApiKeys) {
          console.log("[Onboarding] API keys configured, advancing to profile stage");
          // Update the profile to reflect new stage
          if (profile) {
            profile.onboardingStage = "profile";
            const profilePath = await getUserProfilePath(currentUser?.username);
            await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
          }
        }
        
        const greeting = timeOfDay === "morning" ? "Good morning" : 
                        timeOfDay === "afternoon" ? "Good afternoon" : 
                        timeOfDay === "evening" ? "Good evening" : "Hey there";
        
        console.log("[Onboarding] Starting profile questions");
        return {
          ok: true,
          message: `${greeting}! Great, you're all set up! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)`,
          needsOnboarding: true,
          onboardingStage: "profile",
          timeOfDay,
          profile
        };
      }

      // ONBOARDING STAGE 2: Task Demo
      if (onboardingStage === "task_demo") {
        console.log("[Onboarding] Starting task demo");
        return {
          ok: true,
          message: `Now let's see Wovly in action! Try creating your first task.\n\nType something like: **"Remind me to eat lunch at 12pm tomorrow"**\n\nTasks run in the background and can monitor, remind, and take actions for you.`,
          needsOnboarding: true,
          onboardingStage: "task_demo",
          timeOfDay,
          profile
        };
      }

      // ONBOARDING STAGE 3: Skill Demo
      if (onboardingStage === "skill_demo") {
        console.log("[Onboarding] Starting skill demo");
        return {
          ok: true,
          message: `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`,
          needsOnboarding: true,
          onboardingStage: "skill_demo",
          timeOfDay,
          profile
        };
      }

      // ONBOARDING STAGE 4: Integrations
      if (onboardingStage === "integrations") {
        console.log("[Onboarding] Starting integrations recommendations");
        return {
          ok: true,
          message: `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.`,
          needsOnboarding: true,
          onboardingStage: "integrations",
          timeOfDay,
          profile
        };
      }

      // COMPLETED - Normal operation
      // Get today's and tomorrow's agenda if Google is authorized
      let todayEvents = [];
      let tomorrowEvents = [];
      
      try {
        const accessToken = await getGoogleAccessToken(currentUser?.username);
        if (accessToken) {
          // Today's events
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(now);
          todayEnd.setHours(23, 59, 59, 999);
          todayEvents = await fetchCalendarEvents(accessToken, todayStart, todayEnd);

          // Tomorrow's events
          const tomorrowStart = new Date(now);
          tomorrowStart.setDate(tomorrowStart.getDate() + 1);
          tomorrowStart.setHours(0, 0, 0, 0);
          const tomorrowEnd = new Date(tomorrowStart);
          tomorrowEnd.setHours(23, 59, 59, 999);
          tomorrowEvents = await fetchCalendarEvents(accessToken, tomorrowStart, tomorrowEnd);
        }
      } catch (err) {
        console.error("Calendar fetch error:", err);
      }

      // Build context for LLM
      const formatEvents = (events) => {
        if (events.length === 0) return "No events scheduled.";
        return events.map(e => {
          const startTime = e.start.includes("T") 
            ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : "All day";
          return `- ${startTime}: ${e.title}`;
        }).join("\n");
      };

      const llmPrompt = `You are Wovly, a warm and personable AI assistant. Generate a welcome message for the user based on the context below.

CURRENT TIME: ${timeStr} on ${dayOfWeek}, ${dateStr}
TIME OF DAY: ${timeOfDay}

USER PROFILE:
- Name: ${profile?.firstName || "Friend"} ${profile?.lastName || ""}
- Occupation: ${profile?.occupation || "Not specified"}
- City: ${profile?.city || "Not specified"}
- Home Life: ${profile?.homeLife || "Not specified"}

TODAY'S AGENDA (${dayOfWeek}):
${formatEvents(todayEvents)}

TOMORROW'S AGENDA:
${formatEvents(tomorrowEvents)}

INSTRUCTIONS:
- Keep the message concise (2-4 sentences max)
- Be warm and personable, like a supportive friend
- Reference specific events or context when relevant
- Adjust tone based on time of day:
  * Morning: Energizing, mention what's ahead
  * Afternoon: Encouraging, acknowledge progress on the day
  * Evening: Supportive, mention winding down
  * Night (after 9pm): Calm, reflective, hopeful about tomorrow
- If it's late night and they have events tomorrow, mention being ready for tomorrow
- If they have kids (mentioned in home life), reference kid-related events like pickups
- Don't be overly formal or use exclamation marks excessively
- End with an invitation to chat or ask for help

Generate ONLY the welcome message, nothing else.`;

      // Determine which provider to use for welcome
      const useProvider = apiKeys[activeProvider] ? activeProvider : 
                          apiKeys.anthropic ? "anthropic" : 
                          apiKeys.openai ? "openai" : 
                          apiKeys.google ? "google" : null;

      // Call the LLM
      let welcomeMessage = "";

      if (useProvider === "anthropic" && apiKeys.anthropic) {
        try {
          const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKeys.anthropic,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: anthropicModel,
              max_tokens: 300,
              messages: [{ role: "user", content: llmPrompt }]
            })
          });

          if (response.ok) {
            const data = await response.json();
            welcomeMessage = data.content?.[0]?.text || "";
          }
        } catch (err) {
          console.error("Anthropic API error:", err);
        }
      }

      // OpenAI
      if (!welcomeMessage && apiKeys.openai) {
        try {
          const openaiModel = models.openai || "gpt-4o";
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKeys.openai}`
            },
            body: JSON.stringify({
              model: openaiModel,
              max_tokens: 300,
              messages: [{ role: "user", content: llmPrompt }]
            })
          });

          if (response.ok) {
            const data = await response.json();
            welcomeMessage = data.choices?.[0]?.message?.content || "";
          }
        } catch (err) {
          console.error("OpenAI API error:", err);
        }
      }

      // Google Gemini
      if (!welcomeMessage && apiKeys.google) {
        try {
          const geminiModel = models.google || "gemini-1.5-pro";
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKeys.google}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: llmPrompt }] }]
              })
            }
          );

          if (response.ok) {
            const data = await response.json();
            welcomeMessage = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          }
        } catch (err) {
          console.error("Gemini API error:", err);
        }
      }

      // Final fallback
      if (!welcomeMessage) {
        const firstName = profile?.firstName || "there";
        welcomeMessage = `Hey ${firstName}! How can I help you today?`;
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

    } catch (err) {
      console.error("Welcome generation error:", err);
      return {
        ok: false,
        error: err.message,
        message: "Hello! I'm Wovly, your AI assistant. How can I help you today?"
      };
    }
  });

  // Calendar events handler
  ipcMain.handle("calendar:getEvents", async (_event, { date }) => {
    try {
      const accessToken = await getGoogleAccessToken(currentUser?.username);
      if (!accessToken) {
        return { ok: false, error: "Google not authorized" };
      }

      // Parse date in local timezone (not UTC)
      // "2026-01-31" should be midnight Jan 31 LOCAL time
      const [year, month, day] = date.split('-').map(Number);
      const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

      const events = await fetchCalendarEvents(accessToken, startDate, endDate);
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Integration test handlers
  ipcMain.handle("integrations:testGoogle", async () => {
    try {
      const accessToken = await getGoogleAccessToken(currentUser?.username);
      if (!accessToken) {
        return { ok: false, error: "Not authorized" };
      }
      
      // Test basic connection
      const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      
      if (!response.ok) {
        return { ok: false, error: "Failed to verify connection" };
      }
      
      const userInfo = await response.json();
      
      // Also test calendar access specifically
      const calendarTestUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary");
      const calendarResponse = await fetch(calendarTestUrl.toString(), {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      
      if (!calendarResponse.ok) {
        const errorText = await calendarResponse.text();
        console.error("[Google] Calendar test failed:", errorText);
        
        if (calendarResponse.status === 403) {
          return { 
            ok: false, 
            error: `Connected as ${userInfo.email}, but Calendar access denied. Please: 1) Enable Google Calendar API in your Google Cloud Console, 2) Disconnect and reconnect Google to grant calendar permissions.`
          };
        }
        
        return { 
          ok: false, 
          error: `Connected as ${userInfo.email}, but Calendar API error: ${calendarResponse.status}`
        };
      }
      
      return { ok: true, message: `Connected as ${userInfo.email} (Calendar: ✓)` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Note: testSlack handler is now defined in the Slack Integration section above

  ipcMain.handle("integrations:testIMessage", async () => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "iMessage is only available on macOS" };
    }
    
    const dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db");
    try {
      await fs.access(dbPath);
      return { ok: true, message: "iMessage database accessible" };
    } catch {
      return { ok: false, error: "Cannot access Messages database. Grant Full Disk Access to this app." };
    }
  });

  // Weather test handler
  ipcMain.handle("integrations:testWeather", async () => {
    try {
      // Test Open-Meteo API with a simple location query
      const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m&timezone=auto");
      if (response.ok) {
        const data = await response.json();
        const temp = Math.round(data.current.temperature_2m * 9/5 + 32); // Convert to F
        return { ok: true, message: `Weather API connected. Current: ${temp}°F in NYC` };
      }
      return { ok: false, error: "Failed to connect to weather API" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Weather enable/disable handler
  ipcMain.handle("integrations:setWeatherEnabled", async (_event, { enabled }) => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch {
        // No existing settings
      }
      settings.weatherEnabled = enabled;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("integrations:getWeatherEnabled", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return { ok: true, enabled: settings.weatherEnabled !== false };
    } catch {
      return { ok: true, enabled: true }; // Default to enabled
    }
  });

  // Browser Automation Settings (CDP)
  ipcMain.handle("integrations:getBrowserEnabled", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return { ok: true, enabled: settings.browserEnabled === true };
    } catch {
      return { ok: true, enabled: false };
    }
  });

  ipcMain.handle("integrations:setBrowserEnabled", async (_event, { enabled }) => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch {}
      
      settings.browserEnabled = enabled;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      
      console.log(`[Settings] Browser automation ${enabled ? 'enabled' : 'disabled'}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Test CDP browser
  ipcMain.handle("integrations:testBrowser", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const controller = await getBrowserController(currentUser.username);
      const snapshot = await controller.navigate("test", "https://example.com");
      
      // Clean up test session
      const { context } = controller.contexts.get("test") || {};
      if (context) {
        await context.close();
        controller.contexts.delete("test");
      }
      
      return { 
        ok: true, 
        message: `Browser working! Navigated to ${snapshot.title}. Found ${snapshot.elementCount} interactive elements.`,
        screenshot: snapshot.screenshot
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Credential Storage IPC Handlers
  // Secure, local-only credential management for website logins
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("credentials:list", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: true, credentials: [] };
      }
      const credentials = await loadCredentials(currentUser.username);
      // Return credentials with passwords masked for display
      const masked = Object.entries(credentials).map(([domain, cred]) => ({
        domain: cred.domain || domain,
        displayName: cred.displayName || domain,
        username: cred.username || "",
        hasPassword: !!cred.password,
        notes: cred.notes || "",
        lastUsed: cred.lastUsed || null,
        created: cred.created || null
      }));
      return { ok: true, credentials: masked };
    } catch (err) {
      console.error("[Credentials] List error:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("credentials:get", async (_event, { domain, includePassword = false }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const credential = await getCredentialForDomain(domain, currentUser.username);
      if (!credential) {
        return { ok: false, error: "Credential not found" };
      }
      
      // Only include password if explicitly requested (for edit modal)
      const result = {
        domain: credential.domain,
        displayName: credential.displayName || credential.domain,
        username: credential.username || "",
        notes: credential.notes || "",
        lastUsed: credential.lastUsed || null,
        created: credential.created || null
      };
      
      if (includePassword) {
        result.password = credential.password || "";
      }
      
      return { ok: true, credential: result };
    } catch (err) {
      console.error("[Credentials] Get error:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("credentials:save", async (_event, { domain, displayName, username, password, notes }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      if (!domain || domain.trim() === "") {
        return { ok: false, error: "Domain is required" };
      }
      
      const credentials = await loadCredentials(currentUser.username);
      const normalizedDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      
      const existingCred = credentials[normalizedDomain];
      
      credentials[normalizedDomain] = {
        domain: normalizedDomain,
        displayName: displayName || normalizedDomain,
        username: username || "",
        password: password || existingCred?.password || "", // Keep existing password if not provided
        notes: notes || "",
        lastUsed: existingCred?.lastUsed || null,
        created: existingCred?.created || new Date().toISOString()
      };
      
      await saveCredentials(credentials, currentUser.username);
      
      console.log(`[Credentials] Saved credential for ${normalizedDomain}`);
      return { ok: true, domain: normalizedDomain };
    } catch (err) {
      console.error("[Credentials] Save error:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("credentials:delete", async (_event, { domain }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const credentials = await loadCredentials(currentUser.username);
      const normalizedDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      
      if (!credentials[normalizedDomain]) {
        return { ok: false, error: "Credential not found" };
      }
      
      delete credentials[normalizedDomain];
      await saveCredentials(credentials, currentUser.username);
      
      console.log(`[Credentials] Deleted credential for ${normalizedDomain}`);
      return { ok: true };
    } catch (err) {
      console.error("[Credentials] Delete error:", err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("credentials:updateLastUsed", async (_event, { domain }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const credentials = await loadCredentials(currentUser.username);
      const normalizedDomain = domain.toLowerCase();
      
      if (credentials[normalizedDomain]) {
        credentials[normalizedDomain].lastUsed = new Date().toISOString();
        await saveCredentials(credentials, currentUser.username);
      }
      
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Shell utilities
  // ─────────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle("shell:openExternal", async (_event, { url }) => {
    try {
      const { shell } = require("electron");
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      console.error("[Shell] Open external error:", err.message);
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // User Authentication System - Multi-user support with local passwords
  // ─────────────────────────────────────────────────────────────────────────────
  
  // currentUser is defined at module scope for cross-function access
  
  const getUsersPath = async () => {
    const baseDir = await getWovlyDir();
    return path.join(baseDir, "users.json");
  };
  
  const loadUsers = async () => {
    try {
      const usersPath = await getUsersPath();
      const data = await fs.readFile(usersPath, "utf8");
      return JSON.parse(data);
    } catch {
      return {};
    }
  };
  
  const saveUsers = async (users) => {
    const usersPath = await getUsersPath();
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2));
  };
  
  // Simple password hashing (for local use - not cryptographically secure for network)
  const hashPassword = (password) => {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(password).digest("hex");
  };
  
  // Check if any users exist
  ipcMain.handle("auth:hasUsers", async () => {
    try {
      const users = await loadUsers();
      return { ok: true, hasUsers: Object.keys(users).length > 0 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  
  // List all usernames (for login screen)
  ipcMain.handle("auth:listUsers", async () => {
    try {
      const users = await loadUsers();
      const userList = Object.entries(users).map(([username, data]) => ({
        username,
        displayName: data.displayName || username,
        createdAt: data.createdAt
      }));
      return { ok: true, users: userList };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  
  // Register a new user
  ipcMain.handle("auth:register", async (_event, { username, password, displayName }) => {
    try {
      if (!username || !password) {
        return { ok: false, error: "Username and password are required" };
      }
      
      const users = await loadUsers();
      const normalizedUsername = username.toLowerCase().trim();
      
      if (users[normalizedUsername]) {
        return { ok: false, error: "Username already exists" };
      }
      
      users[normalizedUsername] = {
        username: normalizedUsername,
        displayName: displayName || username,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      
      await saveUsers(users);
      console.log(`[Auth] User registered: ${normalizedUsername}`);
      
      return { ok: true, username: normalizedUsername };
    } catch (err) {
      console.error("[Auth] Register error:", err.message);
      return { ok: false, error: err.message };
    }
  });
  
  // Login
  ipcMain.handle("auth:login", async (_event, { username, password }) => {
    try {
      if (!username || !password) {
        return { ok: false, error: "Username and password are required" };
      }
      
      const users = await loadUsers();
      const normalizedUsername = username.toLowerCase().trim();
      const user = users[normalizedUsername];
      
      if (!user) {
        return { ok: false, error: "User not found" };
      }
      
      if (user.passwordHash !== hashPassword(password)) {
        return { ok: false, error: "Incorrect password" };
      }
      
      // Set current user
      currentUser = {
        username: normalizedUsername,
        displayName: user.displayName
      };
      
      // Update last login
      users[normalizedUsername].lastLogin = new Date().toISOString();
      await saveUsers(users);
      
      // Save session for persistence across app restarts
      await saveSession(currentUser);
      
      console.log(`[Auth] User logged in: ${normalizedUsername}`);
      
      // Process old memory files for this user (in background)
      processOldMemoryFiles(normalizedUsername).catch(err => {
        console.error("[Memory] Error processing old files:", err.message);
      });
      
      // Resume any pending tasks for this user (in background)
      resumeTasksOnStartup(normalizedUsername).catch(err => {
        console.error("[Tasks] Error resuming tasks:", err.message);
      });
      
      // Run event-based tasks triggered by login (in background)
      runOnLoginTasks(normalizedUsername).catch(err => {
        console.error("[Tasks] Error running on-login tasks:", err.message);
      });
      
      return { 
        ok: true, 
        user: {
          username: currentUser.username,
          displayName: currentUser.displayName
        }
      };
    } catch (err) {
      console.error("[Auth] Login error:", err.message);
      return { ok: false, error: err.message };
    }
  });
  
  // Logout
  ipcMain.handle("auth:logout", async () => {
    try {
      const username = currentUser?.username;
      currentUser = null;
      // Clear session file
      await clearSession();
      // Clear user-specific caches
      if (username) {
        credentialsCache.delete(username);
      }
      contactNameCache.clear();
      console.log(`[Auth] User logged out: ${username || "unknown"}`);
      return { ok: true };
    } catch (err) {
      console.error("[Auth] Logout error:", err.message);
      return { ok: false, error: err.message };
    }
  });
  
  // Check current session - restores from file if not in memory
  ipcMain.handle("auth:checkSession", async () => {
    try {
      // If already logged in, return current user
      if (currentUser) {
        return { 
          ok: true, 
          loggedIn: true, 
          user: {
            username: currentUser.username,
            displayName: currentUser.displayName
          }
        };
      }
      
      // Try to restore session from file
      const savedSession = await loadSession();
      if (savedSession?.username) {
        // Verify user still exists
        const users = await loadUsers();
        const user = users[savedSession.username];
        if (user) {
          // Restore the session
          currentUser = {
            username: savedSession.username,
            displayName: savedSession.displayName || user.displayName
          };
          console.log(`[Auth] Session restored for ${currentUser.username}`);
          
          // Resume tasks in background
          resumeTasksOnStartup(currentUser.username).catch(err => {
            console.error("[Tasks] Error resuming tasks:", err.message);
          });
          
          // Run on-login event tasks in background
          runOnLoginTasks(currentUser.username).catch(err => {
            console.error("[Tasks] Error running on-login tasks:", err.message);
          });
          
          return { 
            ok: true, 
            loggedIn: true, 
            user: {
              username: currentUser.username,
              displayName: currentUser.displayName
            }
          };
        } else {
          // User was deleted, clear the session
          await clearSession();
        }
      }
      
      return { ok: true, loggedIn: false };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  
  // Get current user
  ipcMain.handle("auth:getCurrentUser", async () => {
    try {
      if (!currentUser) {
        return { ok: false, error: "Not logged in" };
      }
      return { 
        ok: true, 
        user: {
          username: currentUser.username,
          displayName: currentUser.displayName
        }
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Google OAuth flow
  ipcMain.handle("integrations:startGoogleOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/drive.readonly"
      ].join(" ");

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&access_type=offline` +
        `&prompt=consent`;

      // Create local server to handle callback
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              // Exchange code for tokens
              const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  grant_type: "authorization_code"
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                // Save tokens
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch {
                  // No existing settings
                }

                settings.googleTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error_description || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        resolve({ ok: false, error: "Authorization timed out" });
      }, 300000);
    });
  });

  ipcMain.handle("integrations:checkGoogleAuth", async () => {
    const accessToken = await getGoogleAccessToken(currentUser?.username);
    return { ok: true, authorized: !!accessToken };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Slack Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Cloudflare Tunnel for Slack OAuth (HTTPS required)
  let slackTunnelProcess = null;
  let slackTunnelUrl = null;

  ipcMain.handle("integrations:startSlackTunnel", async () => {
    // Kill existing tunnel if any
    if (slackTunnelProcess) {
      slackTunnelProcess.kill();
      slackTunnelProcess = null;
      slackTunnelUrl = null;
    }

    const { spawn, exec } = require("child_process");

    // Helper to check if cloudflared is installed
    const isCloudflaredInstalled = () => {
      return new Promise((resolve) => {
        exec("which cloudflared", (error) => {
          resolve(!error);
        });
      });
    };

    // Helper to install cloudflared via brew
    const installCloudflared = () => {
      return new Promise((resolve) => {
        console.log("Installing cloudflared via Homebrew...");
        const installProc = spawn("brew", ["install", "cloudflared"], {
          stdio: ["ignore", "pipe", "pipe"]
        });

        let output = "";
        installProc.stdout.on("data", (data) => {
          output += data.toString();
          console.log("brew:", data.toString());
        });
        installProc.stderr.on("data", (data) => {
          output += data.toString();
          console.log("brew:", data.toString());
        });

        installProc.on("close", (code) => {
          if (code === 0) {
            resolve({ ok: true });
          } else {
            // Check if brew is installed
            exec("which brew", (brewError) => {
              if (brewError) {
                resolve({ 
                  ok: false, 
                  error: "Homebrew is not installed. Please install it first: https://brew.sh" 
                });
              } else {
                resolve({ ok: false, error: "Failed to install cloudflared: " + output });
              }
            });
          }
        });

        installProc.on("error", () => {
          resolve({ 
            ok: false, 
            error: "Homebrew is not installed. Please install it first: https://brew.sh" 
          });
        });
      });
    };

    // Check and install cloudflared if needed
    const installed = await isCloudflaredInstalled();
    if (!installed) {
      console.log("cloudflared not found, installing...");
      const installResult = await installCloudflared();
      if (!installResult.ok) {
        return installResult;
      }
      console.log("cloudflared installed successfully");
    }

    return new Promise((resolve) => {
      // Start cloudflared quick tunnel
      const proc = spawn("cloudflared", ["tunnel", "--url", "http://localhost:18924"], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      slackTunnelProcess = proc;
      let urlFound = false;

      const handleOutput = (data) => {
        const output = data.toString();
        console.log("cloudflared:", output);
        
        // Look for the tunnel URL in output
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (urlMatch && !urlFound) {
          urlFound = true;
          slackTunnelUrl = urlMatch[0];
          console.log("Slack tunnel URL:", slackTunnelUrl);
          resolve({ ok: true, url: slackTunnelUrl });
        }
      };

      proc.stdout.on("data", handleOutput);
      proc.stderr.on("data", handleOutput);

      proc.on("error", (err) => {
        console.error("cloudflared error:", err);
        if (!urlFound) {
          resolve({ 
            ok: false, 
            error: "Failed to start cloudflared: " + err.message
          });
        }
      });

      proc.on("exit", (code) => {
        if (!urlFound && code !== 0) {
          resolve({ 
            ok: false, 
            error: "cloudflared exited unexpectedly" 
          });
        }
        slackTunnelProcess = null;
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!urlFound) {
          proc.kill();
          resolve({ ok: false, error: "Tunnel startup timed out" });
        }
      }, 30000);
    });
  });

  ipcMain.handle("integrations:stopSlackTunnel", async () => {
    if (slackTunnelProcess) {
      slackTunnelProcess.kill();
      slackTunnelProcess = null;
      slackTunnelUrl = null;
    }
    return { ok: true };
  });

  ipcMain.handle("integrations:getSlackTunnelUrl", async () => {
    return { ok: true, url: slackTunnelUrl };
  });

  // Slack OAuth flow - using USER tokens to send messages as the user
  ipcMain.handle("integrations:startSlackOAuth", async (_event, { clientId, clientSecret, tunnelUrl }) => {
    return new Promise((resolve) => {
      // Use tunnel URL if provided, otherwise fall back to localhost
      const redirectUri = tunnelUrl ? `${tunnelUrl}/oauth/callback` : "http://localhost:18924/oauth/callback";
      
      // User scopes - these allow sending messages as the user (not as a bot)
      const userScopes = [
        "channels:history",
        "channels:read", 
        "channels:write",
        "chat:write",
        "groups:history",
        "groups:read",
        "groups:write",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "users:read",
        "users:read.email"
      ].join(",");

      // Use user_scope instead of scope to get user token
      const authUrl = `https://slack.com/oauth/v2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&user_scope=${encodeURIComponent(userScopes)}`;

      // Create local server to handle callback
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18924`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>" + error + "</p><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              // Exchange code for tokens
              const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri
                })
              });

              const tokenData = await tokenResponse.json();
              console.log("Slack OAuth response:", tokenData.ok ? "success" : tokenData.error);

              // Check for user token (authed_user.access_token) - this allows sending as the user
              const userToken = tokenData.authed_user?.access_token;
              const userId = tokenData.authed_user?.id;
              
              if (tokenData.ok && userToken) {
                // Save user token (not bot token)
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch {
                  // No existing settings
                }

                settings.slackTokens = {
                  access_token: userToken,  // User token, not bot token
                  user_id: userId,
                  team: tokenData.team,
                  client_id: clientId,
                  client_secret: clientSecret,
                  is_user_token: true  // Flag to indicate this is a user token
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`<h1>Slack Connected!</h1><p>Workspace: ${tokenData.team?.name || "Unknown"}</p><p>Connected as user. Messages will be sent on your behalf.</p><p>You can close this window and return to Wovly.</p>`);
                server.close();
                resolve({ ok: true, team: tokenData.team });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Failed</h1><p>" + (tokenData.error || "Unknown error") + "</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18924, () => {
        require("electron").shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        resolve({ ok: false, error: "Authorization timed out" });
      }, 300000);
    });
  });

  ipcMain.handle("integrations:checkSlackAuth", async () => {
    const accessToken = await getSlackAccessToken(currentUser?.username);
    if (!accessToken) {
      return { ok: true, authorized: false };
    }
    
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return { 
        ok: true, 
        authorized: true,
        team: settings.slackTokens?.team
      };
    } catch {
      return { ok: true, authorized: false };
    }
  });

  ipcMain.handle("integrations:disconnectSlack", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch {
        // No settings
      }
      delete settings.slackTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Update the test handler
  ipcMain.handle("integrations:testSlack", async () => {
    const accessToken = await getSlackAccessToken(currentUser?.username);
    if (!accessToken) {
      return { ok: false, error: "Slack not connected" };
    }

    try {
      const response = await fetch("https://slack.com/api/auth.test", {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      const data = await response.json();
      
      if (data.ok) {
        return { ok: true, message: `Connected to ${data.team} as ${data.user} (messages will be sent as you)` };
      }
      return { ok: false, error: data.error || "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Telegram IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("telegram:setToken", async (_event, { token }) => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No existing settings */ }
      
      settings.telegramBotToken = token;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      
      // Verify the token works
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await response.json();
      
      if (data.ok) {
        return { ok: true, bot: { username: data.result.username, name: data.result.first_name } };
      }
      return { ok: false, error: "Invalid bot token" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("telegram:checkAuth", async () => {
    const token = await getTelegramToken();
    return { authorized: !!token };
  });

  ipcMain.handle("telegram:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.telegramBotToken;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("telegram:test", async () => {
    const token = await getTelegramToken();
    if (!token) {
      return { ok: false, error: "Telegram not connected" };
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await response.json();
      if (data.ok) {
        return { ok: true, message: `Connected as @${data.result.username}` };
      }
      return { ok: false, error: "Token verification failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Discord IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("discord:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = "identify guilds guilds.members.read messages.read bot";
      
      const authUrl = `https://discord.com/api/oauth2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  grant_type: "authorization_code"
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.discordTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error_description || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("discord:checkAuth", async () => {
    const token = await getDiscordAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("discord:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.discordTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("discord:test", async () => {
    const token = await getDiscordAccessToken();
    if (!token) {
      return { ok: false, error: "Discord not connected" };
    }
    try {
      const response = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.username) {
        return { ok: true, message: `Connected as ${data.username}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // X (Twitter) IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("x:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = "tweet.read tweet.write users.read dm.read dm.write offline.access";
      const codeVerifier = require("crypto").randomBytes(32).toString("base64url");
      const codeChallenge = require("crypto").createHash("sha256").update(codeVerifier).digest("base64url");
      
      const authUrl = `https://twitter.com/i/oauth2/authorize?` +
        `response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=state` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
                },
                body: new URLSearchParams({
                  code,
                  grant_type: "authorization_code",
                  redirect_uri: redirectUri,
                  code_verifier: codeVerifier
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.xTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>" + (tokenData.error_description || "Unknown error") + "</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error_description || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("x:checkAuth", async () => {
    const token = await getXAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("x:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.xTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("x:test", async () => {
    const token = await getXAccessToken();
    if (!token) {
      return { ok: false, error: "X not connected" };
    }
    try {
      const response = await fetch("https://api.twitter.com/2/users/me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.data?.username) {
        return { ok: true, message: `Connected as @${data.data.username}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Notion IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("notion:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      
      const authUrl = `https://api.notion.com/v1/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&owner=user`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
                },
                body: JSON.stringify({
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: redirectUri
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.notionTokens = {
                  access_token: tokenData.access_token,
                  workspace_name: tokenData.workspace_name,
                  workspace_id: tokenData.workspace_id
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true, workspace: tokenData.workspace_name });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("notion:checkAuth", async () => {
    const token = await getNotionAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("notion:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.notionTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notion:test", async () => {
    const token = await getNotionAccessToken();
    if (!token) {
      return { ok: false, error: "Notion not connected" };
    }
    try {
      const response = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Notion-Version": "2022-06-28"
        }
      });
      const data = await response.json();
      if (data.name) {
        return { ok: true, message: `Connected as ${data.name}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GitHub IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("github:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = "repo read:user notifications";
      
      const authUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json"
                },
                body: JSON.stringify({
                  client_id: clientId,
                  client_secret: clientSecret,
                  code
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.githubTokens = {
                  access_token: tokenData.access_token,
                  token_type: tokenData.token_type,
                  scope: tokenData.scope
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error_description || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("github:checkAuth", async () => {
    const token = await getGitHubAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("github:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.githubTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("github:test", async () => {
    const token = await getGitHubAccessToken();
    if (!token) {
      return { ok: false, error: "GitHub not connected" };
    }
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json"
        }
      });
      const data = await response.json();
      if (data.login) {
        return { ok: true, message: `Connected as @${data.login}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Asana IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("asana:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      
      const authUrl = `https://app.asana.com/-/oauth_authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://app.asana.com/-/oauth_token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  code
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.asanaTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("asana:checkAuth", async () => {
    const token = await getAsanaAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("asana:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.asanaTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("asana:test", async () => {
    const token = await getAsanaAccessToken();
    if (!token) {
      return { ok: false, error: "Asana not connected" };
    }
    try {
      const response = await fetch("https://app.asana.com/api/1.0/users/me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.data?.name) {
        return { ok: true, message: `Connected as ${data.data.name}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reddit IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("reddit:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = "identity read submit privatemessages history";
      const state = require("crypto").randomBytes(16).toString("hex");
      
      const authUrl = `https://www.reddit.com/api/v1/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&state=${state}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&duration=permanent` +
        `&scope=${encodeURIComponent(scopes)}`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
                },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: redirectUri
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.redditTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("reddit:checkAuth", async () => {
    const token = await getRedditAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("reddit:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.redditTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("reddit:test", async () => {
    const token = await getRedditAccessToken();
    if (!token) {
      return { ok: false, error: "Reddit not connected" };
    }
    try {
      const response = await fetch("https://oauth.reddit.com/api/v1/me", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Wovly/1.0"
        }
      });
      const data = await response.json();
      if (data.name) {
        return { ok: true, message: `Connected as u/${data.name}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Spotify IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("spotify:startOAuth", async (_event, { clientId, clientSecret }) => {
    return new Promise((resolve) => {
      const redirectUri = "http://localhost:18923/oauth/callback";
      const scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative";
      
      const authUrl = `https://accounts.spotify.com/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}`;

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:18923`);
        
        if (url.pathname === "/oauth/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authorization Failed</h1><p>You can close this window.</p>");
            server.close();
            resolve({ ok: false, error });
            return;
          }

          if (code) {
            try {
              const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
                },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: redirectUri
                })
              });

              const tokenData = await tokenResponse.json();

              if (tokenData.access_token) {
                const settingsPath = await getSettingsPath(currentUser?.username);
                let settings = {};
                try {
                  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
                } catch { /* No existing settings */ }

                settings.spotifyTokens = {
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token,
                  expires_at: Date.now() + (tokenData.expires_in * 1000),
                  client_id: clientId,
                  client_secret: clientSecret
                };

                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authorization Successful!</h1><p>You can close this window and return to Wovly.</p>");
                server.close();
                resolve({ ok: true });
              } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Token Exchange Failed</h1><p>You can close this window.</p>");
                server.close();
                resolve({ ok: false, error: tokenData.error || "Token exchange failed" });
              }
            } catch (err) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Error</h1><p>" + err.message + "</p>");
              server.close();
              resolve({ ok: false, error: err.message });
            }
          }
        }
      });

      server.listen(18923, () => {
        require("electron").shell.openExternal(authUrl);
      });
    });
  });

  ipcMain.handle("spotify:checkAuth", async () => {
    const token = await getSpotifyAccessToken();
    return { authorized: !!token };
  });

  ipcMain.handle("spotify:disconnect", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch { /* No settings */ }
      
      delete settings.spotifyTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("spotify:test", async () => {
    const token = await getSpotifyAccessToken();
    if (!token) {
      return { ok: false, error: "Spotify not connected" };
    }
    try {
      const response = await fetch("https://api.spotify.com/v1/me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.display_name) {
        return { ok: true, message: `Connected as ${data.display_name}` };
      }
      return { ok: false, error: "Connection test failed" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("tasks:create", async (_event, taskData) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const task = await createTask(taskData, currentUser.username);
      
      // Check if we should advance onboarding from task_demo to skill_demo
      try {
        const profilePath = await getUserProfilePath(currentUser.username);
        const markdown = await fs.readFile(profilePath, "utf8");
        const profile = parseUserProfile(markdown);
        if (profile.onboardingStage === "task_demo") {
          console.log("[Onboarding] First task created, advancing to skill_demo stage");
          profile.onboardingStage = "skill_demo";
          await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
          
          // Send the skill demo prompt after task notification
          setTimeout(() => {
            if (win && win.webContents) {
              win.webContents.send("chat:newMessage", {
                role: "assistant",
                content: `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`,
                source: "app"
              });
            }
          }, 2000);
        }
      } catch (err) {
        console.error("[Onboarding] Error checking task_demo stage:", err.message);
      }
      
      // Send initial notification that task is starting
      if (win && win.webContents) {
        win.webContents.send("chat:newMessage", {
          role: "assistant",
          content: `🚀 **Task Started: ${task.title}**\n\nExecuting step 1: ${task.plan[0] || "Starting..."}`,
          source: "task"
        });
      }
      
      // Auto-start the task immediately (same as when created from chat)
      setTimeout(async () => {
        console.log(`[Tasks] Auto-starting task from UI: ${task.id}`);
        await executeTaskStep(task.id, currentUser.username);
      }, 100);
      
      return { ok: true, task };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:list", async () => {
    try {
      if (!currentUser?.username) {
        return { ok: true, tasks: [] };
      }
      const tasks = await listTasks(currentUser.username);
      return { ok: true, tasks };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:get", async (_event, taskId) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const task = await getTask(taskId, currentUser.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }
      return { ok: true, task };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:update", async (_event, { taskId, updates }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const task = await updateTask(taskId, updates, currentUser.username);
      if (task.error) {
        return { ok: false, error: task.error };
      }
      return { ok: true, task };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:cancel", async (_event, taskId) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const result = await cancelTask(taskId, currentUser.username);
      if (result.error) {
        return { ok: false, error: result.error };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:hide", async (_event, taskId) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const result = await hideTask(taskId, currentUser.username);
      if (result.error) {
        return { ok: false, error: result.error };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:getUpdates", async () => {
    try {
      const updates = getTaskUpdates();
      return { ok: true, updates };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:getRawMarkdown", async (_event, taskId) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const markdown = await getTaskRawMarkdown(taskId, currentUser.username);
      if (markdown.error) {
        return { ok: false, error: markdown.error };
      }
      return { ok: true, markdown };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:saveRawMarkdown", async (_event, { taskId, markdown }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const result = await saveTaskRawMarkdown(taskId, markdown, currentUser.username);
      if (result.error) {
        return { ok: false, error: result.error };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("tasks:execute", async (_event, taskId) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }
      const result = await executeTaskStep(taskId, currentUser.username);
      if (result.error) {
        return { ok: false, error: result.error };
      }
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Pending Message Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Approve and send a pending message from a task
  ipcMain.handle("tasks:approvePendingMessage", async (_event, { taskId, messageId, editedMessage }) => {
    try {
      const task = await getTask(taskId, currentUser?.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }

      // Find the pending message
      const messageIndex = task.pendingMessages?.findIndex(m => m.id === messageId);
      if (messageIndex === undefined || messageIndex < 0) {
        return { ok: false, error: "Pending message not found" };
      }

      const pendingMsg = task.pendingMessages[messageIndex];
      let toolInput;
      
      try {
        toolInput = JSON.parse(pendingMsg.toolInput || '{}');
      } catch {
        // If toolInput is missing or invalid, try to reconstruct from message content
        console.log(`[Tasks] toolInput parse failed, reconstructing from message content`);
        toolInput = {};
      }
      
      // If toolInput is empty, reconstruct from pending message fields
      if (!toolInput || Object.keys(toolInput).length === 0) {
        console.log(`[Tasks] Reconstructing toolInput for ${pendingMsg.toolName}`);
        switch (pendingMsg.toolName) {
          case 'send_email':
            toolInput = {
              to: pendingMsg.recipient,
              subject: pendingMsg.subject || '',
              body: pendingMsg.message
            };
            break;
          case 'send_imessage':
            toolInput = {
              recipient: pendingMsg.recipient,
              message: pendingMsg.message
            };
            break;
          case 'send_slack_message':
            toolInput = {
              channel: pendingMsg.recipient,
              message: pendingMsg.message
            };
            break;
          default:
            return { ok: false, error: `Unknown tool type: ${pendingMsg.toolName}` };
        }
      }

      // If message was edited, update the content
      if (editedMessage) {
        switch (pendingMsg.toolName) {
          case 'send_email':
            toolInput.body = editedMessage;
            break;
          case 'send_imessage':
            toolInput.message = editedMessage;
            break;
          case 'send_slack_message':
            toolInput.message = editedMessage;
            break;
        }
      }

      // Execute the actual send (bypass confirmation since user just approved)
      console.log(`[Tasks] Sending approved message: ${pendingMsg.toolName} to ${pendingMsg.recipient}`);
      
      const { executeTool, slackAccessToken } = await loadIntegrationsAndBuildTools();
      
      // For Slack: resolve recipient name to user ID if needed
      if (pendingMsg.toolName === 'send_slack_message' && toolInput.channel) {
        const channel = toolInput.channel;
        // Check if it's already a user/channel ID (starts with U, C, D, or G)
        if (!/^[UCDG][A-Z0-9]+$/i.test(channel)) {
          console.log(`[Tasks] Resolving Slack user name "${channel}" to user ID...`);
          
          // Check if we have the resolved ID stored in task context
          // Also check waiting_for_contact context which may have the user ID from initial send
          let storedUserId = task.contextMemory?.slack_user_id || 
                             task.contextMemory?.[`slack_user_${channel.toLowerCase()}`];
          
          // If waiting_for_contact matches this recipient, check if we have their ID stored
          const waitingFor = task.contextMemory?.waiting_for_contact;
          if (!storedUserId && waitingFor) {
            const waitingForLower = waitingFor.toLowerCase();
            if (waitingForLower.includes(channel.toLowerCase()) || channel.toLowerCase().includes(waitingForLower.split(' ')[0])) {
              // Might be the same person - check for stored ID
              storedUserId = task.contextMemory?.waiting_for_user_id;
            }
          }
          
          if (storedUserId && /^[UCDG][A-Z0-9]+$/i.test(storedUserId)) {
            console.log(`[Tasks] Using stored Slack user ID: ${storedUserId}`);
            toolInput.channel = storedUserId;
          } else if (slackAccessToken) {
            // Need to resolve by searching users
            try {
              const usersResponse = await fetch(`https://slack.com/api/users.list?limit=200`, {
                headers: { "Authorization": `Bearer ${slackAccessToken}` }
              });
              const usersData = await usersResponse.json();
              
              if (usersData.ok && usersData.members) {
                const searchTerm = channel.toLowerCase();
                const user = usersData.members.find(m => 
                  m.name?.toLowerCase() === searchTerm ||
                  m.real_name?.toLowerCase() === searchTerm ||
                  m.name?.toLowerCase().includes(searchTerm) ||
                  m.real_name?.toLowerCase().includes(searchTerm) ||
                  m.profile?.display_name?.toLowerCase() === searchTerm ||
                  m.profile?.display_name?.toLowerCase().includes(searchTerm)
                );
                
                if (user) {
                  console.log(`[Tasks] Resolved "${channel}" to Slack user: ${user.real_name} (${user.id})`);
                  toolInput.channel = user.id;
                  
                  // Store for future use
                  await updateTask(taskId, {
                    contextMemory: {
                      ...task.contextMemory,
                      slack_user_id: user.id,
                      [`slack_user_${channel.toLowerCase()}`]: user.id
                    }
                  }, currentUser?.username);
                } else {
                  console.error(`[Tasks] Could not find Slack user matching "${channel}"`);
                  return { ok: false, error: `Could not find Slack user "${channel}". Please use their exact Slack username or display name.` };
                }
              }
            } catch (resolveErr) {
              console.error(`[Tasks] Failed to resolve Slack user:`, resolveErr.message);
            }
          }
        }
      }
      
      // Temporarily remove the tool from confirmation list to bypass the check
      const toolIndex = TOOLS_REQUIRING_CONFIRMATION.indexOf(pendingMsg.toolName);
      if (toolIndex > -1) {
        TOOLS_REQUIRING_CONFIRMATION.splice(toolIndex, 1);
      }
      
      let sendResult;
      let sendSuccess = false;
      let sendError = null;
      
      try {
        sendResult = await executeTool(pendingMsg.toolName, toolInput);
        
        // Check if the send was actually successful
        // Different tools return success differently
        if (sendResult) {
          if (typeof sendResult === 'object') {
            // Check various success indicators
            if (sendResult.ok === true || sendResult.success === true) {
              sendSuccess = true;
            } else if (sendResult.error || sendResult.ok === false) {
              sendError = sendResult.error || sendResult.message || 'Send failed';
            } else if (sendResult.messageId || sendResult.id || sendResult.ts) {
              // Slack returns ts, email might return messageId
              sendSuccess = true;
            } else {
              // If no clear error, assume success
              sendSuccess = true;
            }
          } else if (typeof sendResult === 'string') {
            // String result - check if it contains error indicators
            if (sendResult.toLowerCase().includes('error') || sendResult.toLowerCase().includes('failed')) {
              sendError = sendResult;
            } else {
              sendSuccess = true;
            }
          } else {
            sendSuccess = true;
          }
        }
        
        console.log(`[Tasks] Send result: success=${sendSuccess}, error=${sendError}`, sendResult);
        
      } catch (err) {
        sendError = err.message;
        console.error(`[Tasks] Send failed with exception:`, err.message);
      } finally {
        // Re-add the tool to confirmation list
        if (toolIndex > -1 && !TOOLS_REQUIRING_CONFIRMATION.includes(pendingMsg.toolName)) {
          TOOLS_REQUIRING_CONFIRMATION.push(pendingMsg.toolName);
        }
      }

      // If send failed, keep the message for retry and notify user
      if (!sendSuccess) {
        task.lastUpdated = new Date().toISOString();
        task.executionLog.push({
          timestamp: new Date().toISOString(),
          message: `FAILED to send ${pendingMsg.platform} message to ${pendingMsg.recipient}: ${sendError || 'Unknown error'}`
        });
        
        // Save task with the failure logged (but keep pending message for retry)
        const tasksDir = await getTasksDir(currentUser?.username);
        const taskPath = path.join(tasksDir, `${taskId}.md`);
        await fs.writeFile(taskPath, serializeTask(task), "utf8");
        
        addTaskUpdate(taskId, `Failed to send message to ${pendingMsg.recipient}: ${sendError}`, {
          toChat: true,
          emoji: "❌",
          taskTitle: task.title
        });
        
        return { ok: false, error: sendError || 'Failed to send message. Please try again.' };
      }

      // Send succeeded - remove the pending message
      task.pendingMessages.splice(messageIndex, 1);
      
      // Log the successful send
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Sent ${pendingMsg.platform} message to ${pendingMsg.recipient}`
      });
      
      // CRITICAL: Do NOT auto-advance to next step just because message was sent
      // The current step may require waiting for a response
      // Check if the current step involves waiting for a response
      const currentStepDesc = task.plan[task.currentStep.step - 1]?.toLowerCase() || '';
      const isWaitingStep = currentStepDesc.includes('wait') || 
                           currentStepDesc.includes('response') ||
                           currentStepDesc.includes('reply') ||
                           currentStepDesc.includes('follow up') ||
                           currentStepDesc.includes('until');
      
      console.log(`[Tasks] DEBUG approvePendingMessage: currentStepDesc = "${currentStepDesc}", isWaitingStep = ${isWaitingStep}`);
      
      // Capture conversation/thread ID from send result BEFORE the branching logic
      // This ensures it's available for both waiting and non-waiting steps
      const conversationId = sendResult?.chatId ||     // iMessage chat_id
                             sendResult?.channel ||    // Slack channel
                             sendResult?.threadId ||   // Email thread
                             null;
      
      console.log(`[Tasks] DEBUG approvePendingMessage: sendResult =`, JSON.stringify(sendResult).slice(0, 300));
      console.log(`[Tasks] DEBUG approvePendingMessage: captured conversationId = ${conversationId}`);
      
      if (task.pendingMessages.length === 0) {
        if (isWaitingStep) {
          // This step requires waiting for a response - don't advance
          task.status = "waiting";
          task.currentStep.state = "waiting";
          
          // CRITICAL: Set nextCheck to prevent immediate re-execution by scheduler
          // Use the task's poll frequency or default to 5 minutes
          const pollInterval = task.pollFrequency?.value || 300000; // Default 5 minutes
          task.nextCheck = Date.now() + pollInterval;
          
          // Store context about what we're waiting for
          task.contextMemory = {
            ...task.contextMemory,
            waiting_via: pendingMsg.platform,
            waiting_for_contact: pendingMsg.recipient,
            last_message_time: new Date().toISOString(),
            new_reply_detected: false,
            // Store conversation ID for thread-specific reply checking
            ...(conversationId ? { conversation_id: conversationId } : {}),
            // Store original subject for email threading (strip "Re: " prefix if present)
            ...(pendingMsg.platform === 'email' && pendingMsg.subject ? { 
              original_subject: pendingMsg.subject.replace(/^Re:\s*/i, '') 
            } : {}),
            // Store message ID from send result for reply threading
            ...(sendResult?.messageId ? { last_message_id: sendResult.messageId } : {})
          };
          
          console.log(`[Tasks] DEBUG approvePendingMessage: contextMemory.conversation_id = ${task.contextMemory.conversation_id}`);
          
          console.log(`[Tasks] Message sent for waiting step "${currentStepDesc}" - staying on step ${task.currentStep.step}, waiting for response${conversationId ? ` (conversation: ${conversationId})` : ''}, next check in ${pollInterval/1000}s`);
          
          task.executionLog.push({
            timestamp: new Date().toISOString(),
            message: `Waiting for response from ${pendingMsg.recipient} via ${pendingMsg.platform}`
          });
        } else {
          // Non-waiting step - can advance (e.g., simple notification)
          task.status = "active";
          
          // IMPORTANT: Still capture the conversation_id for any subsequent wait_for_reply steps
          // This ensures the next step has access to the threadId even if current step doesn't wait
          if (conversationId || pendingMsg.platform === 'email') {
            task.contextMemory = {
              ...task.contextMemory,
              ...(conversationId ? { conversation_id: conversationId } : {}),
              last_message_time: new Date().toISOString(),
              // Store original subject for email threading
              ...(pendingMsg.platform === 'email' && pendingMsg.subject ? { 
                original_subject: pendingMsg.subject.replace(/^Re:\s*/i, '') 
              } : {}),
              // Store message ID from send result for reply threading
              ...(sendResult?.messageId ? { last_message_id: sendResult.messageId } : {})
            };
            console.log(`[Tasks] Captured conversation_id ${conversationId} for next step`);
          }
          
          const currentStep = task.currentStep.step;
          const nextStep = currentStep + 1;
          
          if (nextStep <= task.plan.length) {
            task.currentStep.step = nextStep;
            task.currentStep.state = "executing";
            console.log(`[Tasks] Message sent on non-waiting step, advancing from step ${currentStep} to step ${nextStep}`);
          } else {
            task.status = "completed";
            task.currentStep.state = "completed";
            console.log(`[Tasks] Message sent on final step, marking task as completed`);
          }
        }
      }

      // Save task
      const tasksDir = await getTasksDir(currentUser?.username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), "utf8");

      // Notify UI - always send to chat for visibility
      const updateMessage = task.status === "completed"
        ? `Task completed! Final message sent to ${pendingMsg.recipient}.`
        : isWaitingStep
          ? `Message sent to ${pendingMsg.recipient}. Waiting for their response...`
          : `Message sent to ${pendingMsg.recipient}.`;
      
      const updateEmoji = task.status === "completed" ? "✅" : "📤";
      
      addTaskUpdate(taskId, updateMessage, { 
        toChat: true, 
        emoji: updateEmoji, 
        taskTitle: task.title 
      });
      
      // Only continue execution if task is active (not waiting)
      if (task.status === "active") {
        setTimeout(() => executeTaskStep(taskId, currentUser?.username), 100);
      }

      return { ok: true, sendResult, waiting: task.status === "waiting" };
    } catch (err) {
      console.error(`[Tasks] Error approving message:`, err.message);
      return { ok: false, error: err.message };
    }
  });

  // Reject/discard a pending message
  ipcMain.handle("tasks:rejectPendingMessage", async (_event, { taskId, messageId }) => {
    try {
      const task = await getTask(taskId, currentUser?.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }

      // Find and remove the pending message
      const messageIndex = task.pendingMessages?.findIndex(m => m.id === messageId);
      if (messageIndex === undefined || messageIndex < 0) {
        return { ok: false, error: "Pending message not found" };
      }

      const pendingMsg = task.pendingMessages[messageIndex];
      task.pendingMessages.splice(messageIndex, 1);
      
      // Update task status - advance to next step even when discarded (otherwise it will retry the same message)
      if (task.pendingMessages.length === 0) {
        task.status = "active"; // Resume but message was skipped
        
        // Advance to the next step since the user chose to skip this message
        const currentStep = task.currentStep.step;
        const nextStep = currentStep + 1;
        
        if (nextStep <= task.plan.length) {
          task.currentStep.step = nextStep;
          task.currentStep.state = "executing";
          console.log(`[Tasks] Message discarded, advancing from step ${currentStep} to step ${nextStep}`);
        } else {
          // This was the last step - mark task as completed (with skipped message)
          task.status = "completed";
          task.currentStep.state = "completed";
          console.log(`[Tasks] Message discarded on final step, marking task as completed`);
        }
      }
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Discarded ${pendingMsg.platform} message to ${pendingMsg.recipient} (user rejected)`
      });

      // Save task
      const tasksDir = await getTasksDir(currentUser?.username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), "utf8");

      // Notify UI - send to chat
      const discardMessage = task.status === "completed"
        ? `Task completed (message was skipped).`
        : `Message to ${pendingMsg.recipient} was discarded. Continuing to next step...`;
      
      addTaskUpdate(taskId, discardMessage, {
        toChat: true,
        emoji: "⏭️",
        taskTitle: task.title
      });
      
      // Continue task execution on the next step
      if (task.status === "active") {
        setTimeout(() => executeTaskStep(taskId, currentUser?.username), 100);
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Set auto-send preference for a task
  ipcMain.handle("tasks:setAutoSend", async (_event, { taskId, autoSend }) => {
    try {
      const task = await getTask(taskId, currentUser?.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }

      task.autoSend = autoSend;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Auto-send ${autoSend ? 'enabled' : 'disabled'}`
      });

      // Save task
      const tasksDir = await getTasksDir(currentUser?.username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), "utf8");

      // Notify UI
      addTaskUpdate(taskId, `Auto-send ${autoSend ? 'enabled' : 'disabled'}`);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Set notifications disabled preference for a task
  ipcMain.handle("tasks:setNotificationsDisabled", async (_event, { taskId, disabled }) => {
    try {
      const task = await getTask(taskId, currentUser?.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }

      task.notificationsDisabled = disabled;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Notifications ${disabled ? 'disabled' : 'enabled'}`
      });

      // Save task
      const tasksDir = await getTasksDir(currentUser?.username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), "utf8");

      // Only notify if notifications are being enabled
      if (!disabled) {
        addTaskUpdate(taskId, `Notifications enabled`);
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Set poll frequency for a task
  ipcMain.handle("tasks:setPollFrequency", async (_event, { taskId, pollFrequency }) => {
    try {
      const task = await getTask(taskId, currentUser?.username);
      if (!task) {
        return { ok: false, error: "Task not found" };
      }

      // Parse poll frequency - can be a preset key or full object
      let newPollFrequency;
      if (typeof pollFrequency === 'string') {
        if (POLL_FREQUENCY_PRESETS[pollFrequency]) {
          newPollFrequency = { ...POLL_FREQUENCY_PRESETS[pollFrequency] };
        } else {
          return { ok: false, error: "Invalid poll frequency preset" };
        }
      } else if (typeof pollFrequency === 'object' && pollFrequency.type && pollFrequency.value) {
        newPollFrequency = pollFrequency;
      } else {
        return { ok: false, error: "Invalid poll frequency format" };
      }

      task.pollFrequency = newPollFrequency;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Poll frequency changed to: ${newPollFrequency.label}`
      });

      // Update nextCheck based on the new poll frequency
      if (newPollFrequency.type === "event") {
        // For event-based tasks, clear nextCheck since they don't poll on interval
        task.nextCheck = null;
      } else {
        // Always recalculate nextCheck when user explicitly changes frequency
        // Schedule next check from NOW based on new interval
        task.nextCheck = Date.now() + newPollFrequency.value;
        console.log(`[Tasks] Poll frequency updated for ${taskId}: next check in ${newPollFrequency.value}ms (${newPollFrequency.label})`);
      }

      // Save task
      const tasksDir = await getTasksDir(currentUser?.username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), "utf8");

      // Notify UI
      addTaskUpdate(taskId, `Poll frequency changed to: ${newPollFrequency.label}`);

      return { ok: true, pollFrequency: newPollFrequency };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Get available poll frequency presets
  ipcMain.handle("tasks:getPollFrequencyPresets", async () => {
    return { ok: true, presets: POLL_FREQUENCY_PRESETS };
  });

  // Slack API helpers for tools
  const fetchSlackChannels = async (accessToken) => {
    const response = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel,im,mpim&limit=100", {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data.channels || [];
  };

  const fetchSlackMessages = async (accessToken, channelId, limit = 20) => {
    const response = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data.messages || [];
  };

  const sendSlackMessage = async (accessToken, channelId, text) => {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel: channelId, text })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data;
  };

  const fetchSlackUsers = async (accessToken) => {
    const response = await fetch("https://slack.com/api/users.list?limit=200", {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data.members || [];
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // WhatsApp Interface Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("whatsapp:connect", async () => {
    try {
      await connectWhatsApp();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("whatsapp:disconnect", async () => {
    try {
      await disconnectWhatsApp();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("whatsapp:getStatus", async () => {
    return {
      ok: true,
      status: whatsappStatus,
      qr: whatsappQR
    };
  });

  ipcMain.handle("whatsapp:checkAuth", async () => {
    // Check if we have auth state saved
    try {
      const authDir = await getWhatsAppAuthDir();
      const files = await fs.readdir(authDir);
      const hasAuth = files.some(f => f.includes("creds"));
      return {
        ok: true,
        hasAuth,
        connected: whatsappStatus === "connected"
      };
    } catch {
      return { ok: true, hasAuth: false, connected: false };
    }
  });

  ipcMain.handle("whatsapp:sendMessage", async (_event, { recipient, message }) => {
    if (!whatsappSocket || whatsappStatus !== "connected") {
      return { ok: false, error: "WhatsApp is not connected" };
    }

    try {
      // Ensure recipient ends with @s.whatsapp.net for individual chats
      let jid = recipient;
      if (!jid.includes("@")) {
        jid = jid.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
      }
      
      await whatsappSocket.sendMessage(jid, { text: message });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Sync a message to WhatsApp self-chat (for chat window sync)
  ipcMain.handle("whatsapp:syncToSelfChat", async (_event, { message, isFromUser }) => {
    if (!whatsappSocket || whatsappStatus !== "connected") {
      return { ok: false, error: "WhatsApp is not connected" };
    }

    if (!whatsappSelfChatJid) {
      return { ok: false, error: "Self-chat not initialized. Send a message from WhatsApp first." };
    }

    try {
      // Prefix AI responses with [Wovly] to distinguish from user messages
      const text = isFromUser ? message : `[Wovly] ${message}`;
      await whatsappSocket.sendMessage(whatsappSelfChatJid, { text });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Check if WhatsApp sync is ready (connected and has self-chat JID)
  ipcMain.handle("whatsapp:isSyncReady", async () => {
    return {
      ok: true,
      ready: whatsappStatus === "connected" && !!whatsappSelfChatJid
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Telegram Interface Handlers (Chat via Telegram, similar to WhatsApp)
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("telegramInterface:connect", async () => {
    try {
      await connectTelegramInterface();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("telegramInterface:disconnect", async () => {
    try {
      await disconnectTelegramInterface();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("telegramInterface:getStatus", async () => {
    return {
      ok: true,
      status: telegramInterfaceStatus
    };
  });

  ipcMain.handle("telegramInterface:checkAuth", async () => {
    // Check if bot token is configured
    const botToken = await getTelegramToken();
    return {
      ok: true,
      hasBot: !!botToken,
      connected: telegramInterfaceStatus === "connected"
    };
  });

  // Clear Google authorization (to force re-auth with new scopes)
  ipcMain.handle("integrations:disconnectGoogle", async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let settings = {};
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      } catch {
        // No settings
      }
      
      // Remove Google tokens
      delete settings.googleTokens;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Google Workspace Tools
  const googleWorkspaceTools = [
    {
      name: "get_calendar_events",
      description: "Get calendar events for a specific date or date range.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          days: { type: "number", description: "Number of days to fetch (default 1)" }
        },
        required: []
      }
    },
    {
      name: "create_calendar_event",
      description: "Create a new calendar event with optional attendees. Attendees will receive email invitations.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start: { type: "string", description: "Start datetime in ISO format" },
          end: { type: "string", description: "End datetime in ISO format" },
          description: { type: "string", description: "Event description" },
          location: { type: "string", description: "Event location" },
          attendees: { 
            type: "array", 
            items: { type: "string" },
            description: "Array of email addresses to invite to the event. They will receive calendar invitations."
          },
          sendNotifications: {
            type: "boolean",
            description: "Whether to send email notifications to attendees (default: true)"
          }
        },
        required: ["title", "start", "end"]
      }
    },
    {
      name: "delete_calendar_event",
      description: "Delete a calendar event by ID.",
      input_schema: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "The event ID to delete" }
        },
        required: ["eventId"]
      }
    },
    {
      name: "search_emails",
      description: "Search for emails.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxResults: { type: "number", description: "Max results (default 10)" }
        },
        required: ["query"]
      }
    },
    {
      name: "get_email_content",
      description: "Get the content of a specific email.",
      input_schema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The email message ID" }
        },
        required: ["messageId"]
      }
    },
    {
      name: "send_email",
      description: "Send an email or reply to an existing email thread. Always confirm with user before sending. When replying to an email, use threadId and replyToMessageId to keep the conversation in the same thread.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject. For replies, keep the original subject (optionally with 'Re: ' prefix) to maintain the thread." },
          body: { type: "string", description: "Email body" },
          cc: { type: "string", description: "CC recipients" },
          bcc: { type: "string", description: "BCC recipients" },
          threadId: { type: "string", description: "Gmail thread ID to reply to. Use this when replying to an existing email conversation." },
          replyToMessageId: { type: "string", description: "Message-ID header of the email being replied to. Required for proper threading." }
        },
        required: ["to", "subject", "body"]
      }
    },
    {
      name: "list_drive_files",
      description: "List files in Google Drive.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxResults: { type: "number", description: "Max results (default 10)" }
        },
        required: []
      }
    }
  ];

  // Profile tools
  const profileTools = [
    {
      name: "get_user_profile",
      description: "Get the user's profile information.",
      input_schema: { type: "object", properties: {}, required: [] }
    },
    {
      name: "update_user_profile",
      description: "Update the user's profile with new information. Use this when the user shares ANY personal information - their job, family details, important dates (birthdays, anniversaries), preferences, or any facts they want you to remember. Always confirm with user before updating. Use 'addNote' for custom facts like family birthdays, anniversaries, preferences, etc.",
      input_schema: {
        type: "object",
        properties: {
          occupation: { type: "string", description: "User's job or profession" },
          city: { type: "string", description: "City where user lives" },
          homeLife: { type: "string", description: "Family situation - spouse, kids, pets" },
          dateOfBirth: { type: "string", description: "User's birthday in any format" },
          onboardingCompleted: { type: "boolean", description: "Set true when basic info is collected" },
          addNote: { type: "string", description: "Add a custom fact or note to remember. Use for ANY information the user wants saved: family birthdays, anniversaries, preferences, important dates, etc. Example: 'Wife\\'s birthday: November 29, 1985'" },
          removeNote: { type: "string", description: "Remove a note that contains this text" }
        },
        required: []
      }
    }
  ];

  // Memory tools - for accessing historical conversations
  const memoryTools = [
    {
      name: "search_memory",
      description: "Search through historical conversations by keyword. Use when user asks about past conversations with specific topics. Examples: 'did we ever discuss Italy?', 'what did I say about the project?'",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms to look for in past conversations" },
          date_range: { 
            type: "string", 
            enum: ["last_week", "last_month", "last_3_months", "all"],
            description: "How far back to search. Default is 'all' for comprehensive search."
          }
        },
        required: ["query"]
      }
    },
    {
      name: "get_conversations_for_date",
      description: "Get all conversations from a specific date. Use when user asks about what was discussed on a particular day. Examples: 'what did we talk about yesterday?', 'what did we discuss on Monday?', 'show me our conversation from January 15th'",
      input_schema: {
        type: "object",
        properties: {
          date: { 
            type: "string", 
            description: "The date to retrieve. Can be: 'today', 'yesterday', a relative day like 'last Monday', or a specific date like '2024-01-15' or 'January 15, 2024'"
          }
        },
        required: ["date"]
      }
    },
    {
      name: "search_memory_between_dates",
      description: "Search conversations within a specific date range. Use when user asks about discussions during a time period. Examples: 'what did we discuss last week?', 'find mentions of the project between Christmas and New Year'",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional search terms. If empty, returns all conversations in range." },
          start_date: { type: "string", description: "Start date (inclusive). Format: 'YYYY-MM-DD' or relative like 'last Monday', '2 weeks ago'" },
          end_date: { type: "string", description: "End date (inclusive). Format: 'YYYY-MM-DD' or relative like 'yesterday', 'today'" }
        },
        required: ["start_date", "end_date"]
      }
    },
    {
      name: "list_memory_dates",
      description: "List all dates that have conversation records. Use to see conversation history availability or find when conversations started. Examples: 'when did we first chat?', 'how many days have we talked?', 'list all our conversation dates'",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of dates to return. Default 30." }
        },
        required: []
      }
    },
    {
      name: "get_conversation_summary",
      description: "Get the AI-generated summary for a specific date's conversations. Faster than retrieving full conversations when user just wants highlights. Examples: 'give me a summary of yesterday's chat', 'what were the key points from last Monday?'",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "The date to get summary for. Format: 'YYYY-MM-DD' or relative like 'yesterday', 'last Monday'" }
        },
        required: ["date"]
      }
    }
  ];

  // Memory search execution function
  const executeMemorySearch = async (query, dateRange = "all") => {
    if (!currentUser?.username) {
      return { error: "Not logged in" };
    }
    const dailyDir = await getMemoryDailyDir(currentUser.username);
    const longtermDir = await getMemoryLongtermDir(currentUser.username);
    const results = [];
    const queryLower = query.toLowerCase();

    // Calculate date cutoff based on range
    const now = new Date();
    let cutoffDate = null;
    if (dateRange === "last_week") {
      cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - 7);
    } else if (dateRange === "last_month") {
      cutoffDate = new Date(now);
      cutoffDate.setMonth(cutoffDate.getMonth() - 1);
    } else if (dateRange === "last_3_months") {
      cutoffDate = new Date(now);
      cutoffDate.setMonth(cutoffDate.getMonth() - 3);
    }
    // 'all' means no cutoff

    // Search helper function
    const searchFile = async (filePath, dateStr) => {
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (content.toLowerCase().includes(queryLower)) {
          // Extract matching lines for context
          const lines = content.split('\n');
          const matchingLines = lines.filter(line => 
            line.toLowerCase().includes(queryLower)
          ).slice(0, 5); // Limit to 5 matches per file

          if (matchingLines.length > 0) {
            results.push({
              date: dateStr,
              matches: matchingLines
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    };

    // Search daily files
    try {
      const dailyFiles = await fs.readdir(dailyDir);
      for (const file of dailyFiles) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');
        
        // Check date cutoff
        if (cutoffDate) {
          const fileDate = new Date(dateStr + 'T00:00:00');
          if (fileDate < cutoffDate) continue;
        }

        await searchFile(path.join(dailyDir, file), dateStr);
      }
    } catch {
      // No daily directory
    }

    // Search longterm files
    try {
      const longtermFiles = await fs.readdir(longtermDir);
      for (const file of longtermFiles) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');
        
        // Check date cutoff
        if (cutoffDate) {
          const fileDate = new Date(dateStr + 'T00:00:00');
          if (fileDate < cutoffDate) continue;
        }

        await searchFile(path.join(longtermDir, file), dateStr);
      }
    } catch {
      // No longterm directory
    }

    // Sort results by date (most recent first)
    results.sort((a, b) => b.date.localeCompare(a.date));

    if (results.length === 0) {
      return { found: false, message: `No conversations found matching "${query}" in the specified time range.` };
    }

    return {
      found: true,
      totalMatches: results.length,
      results: results.slice(0, 10) // Limit to 10 most recent matching days
    };
  };

  // Helper: Parse natural language date to YYYY-MM-DD format
  const parseDateString = (dateStr) => {
    const now = new Date();
    const lower = dateStr.toLowerCase().trim();
    
    // Handle relative dates
    if (lower === "today") {
      return now.toISOString().split('T')[0];
    }
    if (lower === "yesterday") {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }
    
    // Handle "X days ago"
    const daysAgoMatch = lower.match(/^(\d+)\s*days?\s*ago$/);
    if (daysAgoMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() - parseInt(daysAgoMatch[1]));
      return d.toISOString().split('T')[0];
    }
    
    // Handle "X weeks ago"
    const weeksAgoMatch = lower.match(/^(\d+)\s*weeks?\s*ago$/);
    if (weeksAgoMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() - parseInt(weeksAgoMatch[1]) * 7);
      return d.toISOString().split('T')[0];
    }
    
    // Handle "last Monday", "last Tuesday", etc.
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const lastDayMatch = lower.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
    if (lastDayMatch) {
      const targetDay = dayNames.indexOf(lastDayMatch[1]);
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysBack = currentDay - targetDay;
      if (daysBack <= 0) daysBack += 7;
      d.setDate(d.getDate() - daysBack);
      return d.toISOString().split('T')[0];
    }
    
    // Handle "this Monday", "this Tuesday", etc. (current week)
    const thisDayMatch = lower.match(/^this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
    if (thisDayMatch) {
      const targetDay = dayNames.indexOf(thisDayMatch[1]);
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysDiff = targetDay - currentDay;
      d.setDate(d.getDate() + daysDiff);
      return d.toISOString().split('T')[0];
    }
    
    // Try parsing as a date string (handles "January 15, 2024", "2024-01-15", etc.)
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    
    // Return as-is if already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    
    return null; // Could not parse
  };

  // Get conversations for a specific date
  const executeGetConversationsForDate = async (dateInput) => {
    if (!currentUser?.username) {
      return { error: "Not logged in" };
    }
    
    const dateStr = parseDateString(dateInput);
    if (!dateStr) {
      return { error: `Could not parse date: "${dateInput}". Try formats like "yesterday", "last Monday", "2024-01-15", or "January 15, 2024"` };
    }
    
    const dailyDir = await getMemoryDailyDir(currentUser.username);
    const longtermDir = await getMemoryLongtermDir(currentUser.username);
    
    // Try daily first, then longterm
    let content = null;
    let source = null;
    
    try {
      const dailyPath = path.join(dailyDir, `${dateStr}.md`);
      content = await fs.readFile(dailyPath, "utf8");
      source = "daily";
    } catch {
      try {
        const longtermPath = path.join(longtermDir, `${dateStr}.md`);
        content = await fs.readFile(longtermPath, "utf8");
        source = "longterm";
      } catch {
        // No file found
      }
    }
    
    if (!content) {
      return { 
        found: false, 
        date: dateStr,
        message: `No conversations found for ${dateStr}.` 
      };
    }
    
    // Parse conversations from content
    const entries = content.split(/\n---\n/).filter(e => e.trim());
    const conversations = [];
    
    for (const entry of entries) {
      // Skip summary section
      if (entry.startsWith('## Summary')) continue;
      
      const timestampMatch = entry.match(/\*\*\[([^\]]+)\]\*\*/);
      const userMatch = entry.match(/\*\*User:\*\*\s*([\s\S]*?)(?=\*\*Assistant:\*\*|$)/);
      const assistantMatch = entry.match(/\*\*Assistant:\*\*\s*([\s\S]*?)$/);
      
      if (userMatch || assistantMatch) {
        conversations.push({
          timestamp: timestampMatch ? timestampMatch[1] : null,
          user: userMatch ? userMatch[1].trim() : null,
          assistant: assistantMatch ? assistantMatch[1].trim() : null
        });
      }
    }
    
    return {
      found: true,
      date: dateStr,
      source,
      conversationCount: conversations.length,
      conversations: conversations.slice(0, 20) // Limit to 20 most recent
    };
  };

  // Search memory between specific dates
  const executeSearchMemoryBetweenDates = async (query, startDateInput, endDateInput) => {
    if (!currentUser?.username) {
      return { error: "Not logged in" };
    }
    
    const startDate = parseDateString(startDateInput);
    const endDate = parseDateString(endDateInput);
    
    if (!startDate) {
      return { error: `Could not parse start date: "${startDateInput}"` };
    }
    if (!endDate) {
      return { error: `Could not parse end date: "${endDateInput}"` };
    }
    
    const dailyDir = await getMemoryDailyDir(currentUser.username);
    const longtermDir = await getMemoryLongtermDir(currentUser.username);
    const results = [];
    const queryLower = query ? query.toLowerCase() : null;
    
    // Helper to check if date is in range
    const isInRange = (dateStr) => {
      return dateStr >= startDate && dateStr <= endDate;
    };
    
    // Helper to search a file
    const searchFile = async (filePath, dateStr) => {
      try {
        const content = await fs.readFile(filePath, "utf8");
        
        // If no query, just return that we found content for this date
        if (!queryLower) {
          const preview = content.slice(0, 200).replace(/\n/g, ' ').trim();
          results.push({
            date: dateStr,
            preview: preview + (content.length > 200 ? '...' : '')
          });
          return;
        }
        
        // Search for query matches
        if (content.toLowerCase().includes(queryLower)) {
          const lines = content.split('\n');
          const matchingLines = lines.filter(line => 
            line.toLowerCase().includes(queryLower)
          ).slice(0, 3);
          
          if (matchingLines.length > 0) {
            results.push({
              date: dateStr,
              matches: matchingLines
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    };
    
    // Search daily files
    try {
      const dailyFiles = await fs.readdir(dailyDir);
      for (const file of dailyFiles) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');
        if (isInRange(dateStr)) {
          await searchFile(path.join(dailyDir, file), dateStr);
        }
      }
    } catch {
      // No daily directory
    }
    
    // Search longterm files
    try {
      const longtermFiles = await fs.readdir(longtermDir);
      for (const file of longtermFiles) {
        if (!file.endsWith('.md')) continue;
        const dateStr = file.replace('.md', '');
        if (isInRange(dateStr)) {
          await searchFile(path.join(longtermDir, file), dateStr);
        }
      }
    } catch {
      // No longterm directory
    }
    
    // Sort by date (most recent first)
    results.sort((a, b) => b.date.localeCompare(a.date));
    
    if (results.length === 0) {
      const msg = queryLower 
        ? `No conversations matching "${query}" found between ${startDate} and ${endDate}.`
        : `No conversations found between ${startDate} and ${endDate}.`;
      return { found: false, message: msg };
    }
    
    return {
      found: true,
      dateRange: { start: startDate, end: endDate },
      query: query || null,
      totalDays: results.length,
      results: results.slice(0, 15)
    };
  };

  // List all memory dates
  const executeListMemoryDates = async (limit = 30) => {
    if (!currentUser?.username) {
      return { error: "Not logged in" };
    }
    
    const dailyDir = await getMemoryDailyDir(currentUser.username);
    const longtermDir = await getMemoryLongtermDir(currentUser.username);
    const allDates = new Set();
    
    // Get dates from daily
    try {
      const dailyFiles = await fs.readdir(dailyDir);
      for (const file of dailyFiles) {
        if (file.endsWith('.md')) {
          allDates.add(file.replace('.md', ''));
        }
      }
    } catch {
      // No daily directory
    }
    
    // Get dates from longterm
    try {
      const longtermFiles = await fs.readdir(longtermDir);
      for (const file of longtermFiles) {
        if (file.endsWith('.md')) {
          allDates.add(file.replace('.md', ''));
        }
      }
    } catch {
      // No longterm directory
    }
    
    // Sort dates (most recent first)
    const sortedDates = Array.from(allDates).sort().reverse();
    
    if (sortedDates.length === 0) {
      return { found: false, message: "No conversation history found." };
    }
    
    const oldestDate = sortedDates[sortedDates.length - 1];
    const newestDate = sortedDates[0];
    
    return {
      found: true,
      totalDays: sortedDates.length,
      oldestDate,
      newestDate,
      dates: sortedDates.slice(0, limit)
    };
  };

  // Get conversation summary for a date
  const executeGetConversationSummary = async (dateInput) => {
    if (!currentUser?.username) {
      return { error: "Not logged in" };
    }
    
    const dateStr = parseDateString(dateInput);
    if (!dateStr) {
      return { error: `Could not parse date: "${dateInput}"` };
    }
    
    const dailyDir = await getMemoryDailyDir(currentUser.username);
    const longtermDir = await getMemoryLongtermDir(currentUser.username);
    
    // Try longterm first (summaries are there), then daily
    let content = null;
    let source = null;
    
    try {
      const longtermPath = path.join(longtermDir, `${dateStr}.md`);
      content = await fs.readFile(longtermPath, "utf8");
      source = "longterm";
    } catch {
      try {
        const dailyPath = path.join(dailyDir, `${dateStr}.md`);
        content = await fs.readFile(dailyPath, "utf8");
        source = "daily";
      } catch {
        // No file found
      }
    }
    
    if (!content) {
      return { 
        found: false, 
        date: dateStr,
        message: `No conversations found for ${dateStr}.` 
      };
    }
    
    // Extract summary if it exists
    const summaryMatch = content.match(/## Summary\n([\s\S]*?)\n---/);
    
    if (summaryMatch) {
      return {
        found: true,
        date: dateStr,
        hasSummary: true,
        summary: summaryMatch[1].trim()
      };
    }
    
    // No summary - this is likely a recent file
    // Return a brief preview instead
    const preview = content.slice(0, 500).replace(/\n+/g, '\n').trim();
    return {
      found: true,
      date: dateStr,
      hasSummary: false,
      message: "No summary available yet (summaries are generated for older conversations).",
      preview: preview + (content.length > 500 ? '...' : '')
    };
  };

  // Documentation tools - for answering user questions about how to use Wovly
  const documentationTools = [
    {
      name: "fetch_documentation",
      description: "Fetch Wovly documentation to answer user questions about how to use features. Use when user asks detailed questions about skills, tasks, integrations, settings, troubleshooting, or how to do something specific in Wovly. Examples: 'how do I create a custom skill?', 'explain how tasks work', 'how do I connect Slack?'",
      input_schema: {
        type: "object",
        properties: {
          topic: { 
            type: "string", 
            description: "The topic to look up. Common topics: skills, tasks, integrations, chat, memory, settings, installation, troubleshooting, google-workspace, slack, imessage, whatsapp, browser-automation, credentials, security, faq" 
          }
        },
        required: ["topic"]
      }
    }
  ];

  // Documentation fetch execution function
  const executeDocumentationFetch = async (topic) => {
    try {
      // Fetch the llms.txt index to find the right page
      const indexRes = await fetch("https://wovly.mintlify.app/llms.txt");
      if (!indexRes.ok) {
        return { error: "Could not fetch documentation index" };
      }
      const index = await indexRes.text();
      
      // Normalize topic for matching
      const topicLower = topic.toLowerCase().trim();
      const lines = index.split('\n');
      
      // Find matching doc URLs based on topic
      const matches = [];
      for (const line of lines) {
        const lineLower = line.toLowerCase();
        // Check if the line contains the topic and has a URL
        if (lineLower.includes(topicLower) && line.includes('https://')) {
          const urlMatch = line.match(/https:\/\/[^\s\)]+/);
          if (urlMatch) {
            matches.push(urlMatch[0]);
          }
        }
      }
      
      // If no direct match, try partial matches
      if (matches.length === 0) {
        // Map common search terms to doc pages
        const topicMap = {
          'skill': 'skills',
          'task': 'tasks',
          'integration': 'overview',
          'google': 'google-workspace',
          'gmail': 'google-workspace',
          'calendar': 'google-workspace',
          'slack': 'slack',
          'imessage': 'imessage',
          'text': 'imessage',
          'sms': 'imessage',
          'whatsapp': 'whatsapp',
          'browser': 'browser-automation',
          'credential': 'credentials',
          'login': 'credentials',
          'memory': 'memory',
          'profile': 'memory',
          'setting': 'settings',
          'security': 'security',
          'privacy': 'security',
          'faq': 'faq',
          'help': 'faq',
          'troubleshoot': 'troubleshooting',
          'error': 'troubleshooting',
          'install': 'installation',
          'setup': 'quickstart',
          'start': 'quickstart',
          'voice': 'voice-mimic',
          'mimic': 'voice-mimic',
          'style': 'voice-mimic'
        };
        
        // Find the mapped topic
        for (const [key, value] of Object.entries(topicMap)) {
          if (topicLower.includes(key)) {
            // Find the URL containing this value
            for (const line of lines) {
              if (line.toLowerCase().includes(value) && line.includes('https://')) {
                const urlMatch = line.match(/https:\/\/[^\s\)]+/);
                if (urlMatch) {
                  matches.push(urlMatch[0]);
                  break;
                }
              }
            }
            break;
          }
        }
      }
      
      if (matches.length === 0) {
        // Return the full index so the LLM can help the user
        return { 
          found: false, 
          message: `No specific documentation found for "${topic}". Available topics in the documentation:`,
          index: index
        };
      }
      
      // Fetch the first matching doc page
      const docUrl = matches[0];
      const docRes = await fetch(docUrl);
      if (!docRes.ok) {
        return { error: `Could not fetch documentation page: ${docUrl}` };
      }
      const docContent = await docRes.text();
      
      return {
        found: true,
        topic: topic,
        url: docUrl,
        content: docContent
      };
    } catch (err) {
      console.error("[Documentation] Fetch error:", err.message);
      return { error: `Failed to fetch documentation: ${err.message}` };
    }
  };

  // iMessage tools
  // Contact name cache to avoid repeated lookups
  const contactNameCache = new Map();

  // Look up contact name from phone number or email using AppleScript
  const lookupContactName = (identifier) => {
    return new Promise((resolve) => {
      if (!identifier) {
        resolve(null);
        return;
      }

      // Check cache first
      if (contactNameCache.has(identifier)) {
        resolve(contactNameCache.get(identifier));
        return;
      }

      const { exec } = require("child_process");
      
      // Clean the identifier (remove non-numeric chars for phone matching)
      const cleanPhone = identifier.replace(/\D/g, "");
      const lastDigits = cleanPhone.slice(-10); // Last 10 digits for matching
      
      // AppleScript to search contacts
      const appleScript = `
        tell application "Contacts"
          set matchedName to ""
          repeat with aPerson in people
            repeat with aPhone in phones of aPerson
              set phoneDigits to do shell script "echo " & quoted form of (value of aPhone) & " | tr -cd '0-9'"
              if phoneDigits ends with "${lastDigits}" then
                set matchedName to (first name of aPerson & " " & last name of aPerson)
                exit repeat
              end if
            end repeat
            if matchedName is not "" then exit repeat
            repeat with anEmail in emails of aPerson
              if value of anEmail is "${identifier}" then
                set matchedName to (first name of aPerson & " " & last name of aPerson)
                exit repeat
              end if
            end repeat
            if matchedName is not "" then exit repeat
          end repeat
          return matchedName
        end tell
      `;

      exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, { timeout: 5000 }, (error, stdout) => {
        const name = stdout?.trim() || null;
        if (name && name !== " " && name.length > 1) {
          contactNameCache.set(identifier, name);
          resolve(name);
        } else {
          contactNameCache.set(identifier, null);
          resolve(null);
        }
      });
    });
  };

  // Batch lookup contact names for multiple identifiers
  const lookupContactNames = async (identifiers) => {
    const results = new Map();
    const uniqueIds = [...new Set(identifiers.filter(Boolean))];
    
    await Promise.all(uniqueIds.map(async (id) => {
      const name = await lookupContactName(id);
      results.set(id, name);
    }));
    
    return results;
  };

  const iMessageTools = [
    {
      name: "get_recent_messages",
      description: "Get recent text messages (iMessage/SMS) with sender names resolved from contacts. Use this when the user asks about their texts or messages they received.",
      input_schema: {
        type: "object",
        properties: {
          hours: { type: "number", description: "Hours back to look (default 24)" },
          contact: { type: "string", description: "Filter by contact name or phone number (e.g., 'Adaira' or '+1234567890')" },
          limit: { type: "number", description: "Max messages (default 50)" }
        },
        required: []
      }
    },
    {
      name: "search_messages",
      description: "Search through text messages with sender names resolved. Use to find specific messages or conversations.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term to find in message content" },
          contact: { type: "string", description: "Filter by contact name or phone number" },
          limit: { type: "number", description: "Max results (default 20)" }
        },
        required: ["query"]
      }
    },
    {
      name: "lookup_contact",
      description: "Look up a contact's phone number from Apple Contacts by name. Returns the contact's name and phone numbers. Use this FIRST when you need to text someone by name to get their phone number.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Contact name to search for (first name, last name, or full name)" }
        },
        required: ["name"]
      }
    },
    {
      name: "send_imessage",
      description: "Send a text message via iMessage or SMS. The recipient can be a contact name (will auto-lookup phone number) or a phone number directly. Always confirm with user first before sending.",
      input_schema: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Contact name (e.g., 'Adaira', 'John Smith') or phone number (e.g., '+15551234567')" },
          message: { type: "string", description: "The message content to send" }
        },
        required: ["recipient", "message"]
      }
    }
  ];

  // Weather tools (using Open-Meteo API - free, no API key required)
  const weatherTools = [
    {
      name: "get_weather_forecast",
      description: "Get weather forecast for a location. Use this when user asks about weather, forecast, temperature, rain, etc. Can specify a location name or coordinates.",
      input_schema: {
        type: "object",
        properties: {
          location: { type: "string", description: "Location name (e.g., 'Paris, France', 'New York')" },
          latitude: { type: "number", description: "Latitude coordinate (-90 to 90)" },
          longitude: { type: "number", description: "Longitude coordinate (-180 to 180)" },
          days: { type: "number", description: "Number of days to forecast (1-16, default 7)" }
        },
        required: []
      }
    },
    {
      name: "get_current_weather",
      description: "Get current weather conditions for a location. Use this for real-time weather.",
      input_schema: {
        type: "object",
        properties: {
          location: { type: "string", description: "Location name (e.g., 'San Francisco', 'London')" },
          latitude: { type: "number", description: "Latitude coordinate (-90 to 90)" },
          longitude: { type: "number", description: "Longitude coordinate (-180 to 180)" }
        },
        required: []
      }
    },
    {
      name: "search_location",
      description: "Find coordinates for a location by name. Use this to get latitude/longitude for weather lookups.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Location name to search (e.g., 'Tokyo', 'New York, NY')" }
        },
        required: ["query"]
      }
    }
  ];

  // Time and Reminder tools
  const timeTools = [
    {
      name: "get_current_time",
      description: "Get the current date and time. Use this for time-based reminders and scheduling checks. Returns current time, date, day of week, and hour.",
      input_schema: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "Optional timezone (default: local system time)" }
        }
      }
    },
    {
      name: "send_reminder",
      description: "Send a reminder message to the user in the chat. Use this for timed notifications and alerts. The message will appear in the chat window.",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The reminder message to display to the user" }
        },
        required: ["message"]
      }
    }
  ];

  // Execute Time tool
  const executeTimeTool = async (toolName, toolInput) => {
    console.log(`[Time] Executing ${toolName} with input:`, JSON.stringify(toolInput));
    try {
      switch (toolName) {
        case "get_current_time": {
          const now = new Date();
          const timeInfo = {
            time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
            time24: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
            hour: now.getHours(),
            minute: now.getMinutes(),
            iso: now.toISOString()
          };
          console.log(`[Time] Current time:`, timeInfo);
          return timeInfo;
        }
        case "send_reminder": {
          const message = toolInput.message;
          if (!message) {
            return { error: "Message is required for send_reminder" };
          }
          // Send the reminder to the chat window
          if (win && win.webContents) {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `🔔 **Reminder:** ${message}`,
              source: "task"
            });
          }
          console.log(`[Time] Sent reminder: ${message}`);
          return { success: true, message: `Reminder sent: ${message}` };
        }
        default:
          return { error: `Unknown time tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Time] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // Execute Weather tool (using Open-Meteo API)
  const executeWeatherTool = async (toolName, toolInput) => {
    console.log(`[Weather] Executing ${toolName} with input:`, JSON.stringify(toolInput));
    try {
      // Helper to geocode location name to coordinates
      const geocodeLocation = async (locationName) => {
        console.log(`[Weather] Geocoding location: ${locationName}`);
        
        // Try different variations of the location name
        const variations = [
          locationName,
          // Strip state/country suffix (e.g., "Boston, MA" -> "Boston")
          locationName.split(',')[0].trim(),
          // Replace comma with space
          locationName.replace(/,/g, ' ').trim()
        ];
        
        for (const variation of variations) {
          console.log(`[Weather] Trying geocode variation: ${variation}`);
          const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(variation)}&count=5&language=en&format=json`;
          const response = await fetch(url);
          
          if (!response.ok) {
            console.error(`[Weather] Geocoding API failed: ${response.status}`);
            continue;
          }
          
          const data = await response.json();
          
          if (data.results && data.results.length > 0) {
            // If original had state info, try to match it
            const originalLower = locationName.toLowerCase();
            let bestMatch = data.results[0];
            
            // Try to find a better match based on state/country
            if (originalLower.includes('ma') || originalLower.includes('massachusetts')) {
              const maMatch = data.results.find(r => r.admin1?.toLowerCase().includes('massachusetts'));
              if (maMatch) bestMatch = maMatch;
            } else if (originalLower.includes('tx') || originalLower.includes('texas')) {
              const txMatch = data.results.find(r => r.admin1?.toLowerCase().includes('texas'));
              if (txMatch) bestMatch = txMatch;
            } else if (originalLower.includes('ca') || originalLower.includes('california')) {
              const caMatch = data.results.find(r => r.admin1?.toLowerCase().includes('california'));
              if (caMatch) bestMatch = caMatch;
            } else if (originalLower.includes('ny') || originalLower.includes('new york')) {
              const nyMatch = data.results.find(r => r.admin1?.toLowerCase().includes('new york'));
              if (nyMatch) bestMatch = nyMatch;
            }
            
            console.log(`[Weather] Geocoded to: ${bestMatch.latitude}, ${bestMatch.longitude} (${bestMatch.name}, ${bestMatch.admin1 || bestMatch.country})`);
            return {
              latitude: bestMatch.latitude,
              longitude: bestMatch.longitude,
              name: bestMatch.name,
              country: bestMatch.country,
              admin1: bestMatch.admin1,
              timezone: bestMatch.timezone
            };
          }
        }
        
        console.error(`[Weather] Location not found after all variations: ${locationName}`);
        throw new Error(`Location not found: ${locationName}`);
      };

      switch (toolName) {
        case "search_location": {
          const { query } = toolInput;
          
          // Try different variations - strip state/country suffix if needed
          const variations = [
            query,
            query.split(',')[0].trim(),
            query.replace(/,/g, ' ').trim()
          ];
          
          for (const variation of variations) {
            console.log(`[Weather] Searching location variation: ${variation}`);
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(variation)}&count=5&language=en&format=json`;
            const response = await fetch(url);
            if (!response.ok) continue;
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
              return {
                locations: data.results.map(r => ({
                  name: r.name,
                  country: r.country,
                  admin1: r.admin1,
                  latitude: r.latitude,
                  longitude: r.longitude,
                  timezone: r.timezone,
                  population: r.population
                }))
              };
            }
          }
          
          return { error: `No locations found for: ${query}` };
        }

        case "get_current_weather": {
          let lat, lon, locationName;
          
          // Handle case where toolInput might be null/undefined
          if (!toolInput) {
            console.error("[Weather] No input provided to get_current_weather");
            return { error: "Please provide a location name or coordinates" };
          }
          
          if (toolInput.latitude !== undefined && toolInput.longitude !== undefined) {
            lat = toolInput.latitude;
            lon = toolInput.longitude;
            locationName = `${lat}, ${lon}`;
          } else if (toolInput.location) {
            const geo = await geocodeLocation(toolInput.location);
            lat = geo.latitude;
            lon = geo.longitude;
            locationName = geo.admin1 ? `${geo.name}, ${geo.admin1}` : `${geo.name}, ${geo.country}`;
          } else {
            console.error("[Weather] Neither location nor coordinates provided");
            return { error: "Please provide either a location name or coordinates" };
          }

          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
          
          const response = await fetch(url);
          if (!response.ok) throw new Error("Failed to fetch weather");
          const data = await response.json();
          
          const weatherCodes = {
            0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Fog", 48: "Depositing rime fog",
            51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
            61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
            71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
            80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
            95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
          };

          const current = data.current;
          return {
            location: locationName,
            temperature: `${Math.round(current.temperature_2m)}°F`,
            feels_like: `${Math.round(current.apparent_temperature)}°F`,
            conditions: weatherCodes[current.weather_code] || "Unknown",
            humidity: `${current.relative_humidity_2m}%`,
            wind: `${Math.round(current.wind_speed_10m)} mph`,
            precipitation: `${current.precipitation}" in last hour`,
            time: current.time
          };
        }

        case "get_weather_forecast": {
          let lat, lon, locationName;
          
          // Handle case where toolInput might be null/undefined
          if (!toolInput) {
            console.error("[Weather] No input provided to get_weather_forecast");
            return { error: "Please provide a location name or coordinates" };
          }
          
          const days = Math.min(toolInput.days || 7, 16);
          
          if (toolInput.latitude !== undefined && toolInput.longitude !== undefined) {
            lat = toolInput.latitude;
            lon = toolInput.longitude;
            locationName = `${lat}, ${lon}`;
          } else if (toolInput.location) {
            const geo = await geocodeLocation(toolInput.location);
            lat = geo.latitude;
            lon = geo.longitude;
            locationName = geo.admin1 ? `${geo.name}, ${geo.admin1}` : `${geo.name}, ${geo.country}`;
          } else {
            console.error("[Weather] Neither location nor coordinates provided");
            return { error: "Please provide either a location name or coordinates" };
          }

          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=${days}`;
          
          const response = await fetch(url);
          if (!response.ok) throw new Error("Failed to fetch forecast");
          const data = await response.json();
          
          const weatherCodes = {
            0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
            61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
            80: "Rain showers", 81: "Mod. rain showers", 82: "Heavy showers",
            95: "Thunderstorm", 96: "T-storm w/ hail", 99: "Severe t-storm"
          };

          const daily = data.daily;
          const forecast = [];
          
          for (let i = 0; i < daily.time.length; i++) {
            const date = new Date(daily.time[i]);
            forecast.push({
              date: daily.time[i],
              day: date.toLocaleDateString("en-US", { weekday: "short" }),
              conditions: weatherCodes[daily.weather_code[i]] || "Unknown",
              high: `${Math.round(daily.temperature_2m_max[i])}°F`,
              low: `${Math.round(daily.temperature_2m_min[i])}°F`,
              precipitation_chance: `${daily.precipitation_probability_max[i]}%`,
              precipitation: `${daily.precipitation_sum[i]}"`,
              wind_max: `${Math.round(daily.wind_speed_10m_max[i])} mph`,
              sunrise: daily.sunrise[i]?.split("T")[1],
              sunset: daily.sunset[i]?.split("T")[1]
            });
          }

          return {
            location: locationName,
            forecast_days: days,
            forecast
          };
        }

        default:
          return { error: `Unknown weather tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Weather] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // Slack tools
  const slackTools = [
    {
      name: "list_slack_channels",
      description: "List Slack channels and direct messages in the connected workspace.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "get_slack_messages",
      description: "Get recent messages from a Slack channel or DM. For DMs, you can pass a person's name and it will find their DM channel automatically.",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel name (e.g., #general), channel ID, user ID (e.g., U12345), or person's name (e.g., 'Chris Gorog') to get their DMs" },
          limit: { type: "number", description: "Number of messages to fetch (default 20)" }
        },
        required: ["channel"]
      }
    },
    {
      name: "send_slack_message",
      description: "Send a message to a Slack channel or user. Always confirm with user before sending.",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel name (e.g., #general), channel ID, or user ID" },
          message: { type: "string", description: "Message text to send" }
        },
        required: ["channel", "message"]
      }
    },
    {
      name: "search_slack_users",
      description: "Search for Slack users in the workspace.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (name or email)" }
        },
        required: []
      }
    }
  ];

  // Execute Slack tool
  const executeSlackTool = async (toolName, toolInput, accessToken) => {
    try {
      switch (toolName) {
        case "list_slack_channels": {
          const channels = await fetchSlackChannels(accessToken);
          return {
            channels: channels.map(c => ({
              id: c.id,
              name: c.name || c.user,
              type: c.is_channel ? "channel" : c.is_group ? "private" : c.is_im ? "dm" : "group_dm",
              is_member: c.is_member,
              num_members: c.num_members
            })).slice(0, 50)
          };
        }

        case "get_slack_messages": {
          let channelId = toolInput.channel;
          const limit = toolInput.limit || 20;

          // If channel starts with #, find the channel ID
          if (channelId.startsWith("#")) {
            const channels = await fetchSlackChannels(accessToken);
            const channel = channels.find(c => c.name === channelId.slice(1));
            if (!channel) {
              return { error: `Channel ${channelId} not found` };
            }
            channelId = channel.id;
          } 
          // If it's a user ID (starts with U), open DM channel
          else if (channelId.startsWith("U")) {
            console.log(`[Slack] Opening DM channel with user ID: ${channelId}`);
            const dmResponse = await fetch("https://slack.com/api/conversations.open", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ users: channelId })
            });
            const dmData = await dmResponse.json();
            if (dmData.ok && dmData.channel) {
              channelId = dmData.channel.id;
              console.log(`[Slack] DM channel ID: ${channelId}`);
            } else {
              return { error: `Failed to open DM with user: ${dmData.error}` };
            }
          }
          // If it doesn't look like a channel/DM ID (C/D/G prefix), treat as user name search
          else if (!channelId.match(/^[CDG][A-Z0-9]+$/)) {
            console.log(`[Slack] Searching for user: ${channelId}`);
            const users = await fetchSlackUsers(accessToken);
            const query = channelId.toLowerCase();
            const matchedUser = users.find(u => 
              !u.deleted && !u.is_bot && (
                (u.real_name || "").toLowerCase().includes(query) ||
                (u.name || "").toLowerCase().includes(query)
              )
            );
            
            if (!matchedUser) {
              return { error: `User "${channelId}" not found in Slack workspace` };
            }
            
            console.log(`[Slack] Found user: ${matchedUser.real_name || matchedUser.name} (${matchedUser.id})`);
            
            // Open DM channel with the user
            const dmResponse = await fetch("https://slack.com/api/conversations.open", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ users: matchedUser.id })
            });
            const dmData = await dmResponse.json();
            if (dmData.ok && dmData.channel) {
              channelId = dmData.channel.id;
              console.log(`[Slack] DM channel ID: ${channelId}`);
            } else {
              return { error: `Failed to open DM with ${matchedUser.real_name || matchedUser.name}: ${dmData.error}` };
            }
          }

          const messages = await fetchSlackMessages(accessToken, channelId, limit);
          
          // Get user info for names
          const users = await fetchSlackUsers(accessToken);
          const userMap = new Map(users.map(u => [u.id, u.real_name || u.name]));

          return {
            messages: messages.map(m => ({
              user: userMap.get(m.user) || m.user,
              text: m.text,
              timestamp: new Date(parseFloat(m.ts) * 1000).toISOString()
            }))
          };
        }

        case "send_slack_message": {
          let channelId = toolInput.channel;
          const message = toolInput.message;

          // If channel starts with #, find the channel ID
          if (channelId.startsWith("#")) {
            const channels = await fetchSlackChannels(accessToken);
            const channel = channels.find(c => c.name === channelId.slice(1));
            if (!channel) {
              return { error: `Channel ${channelId} not found` };
            }
            channelId = channel.id;
          }

          const sendResult = await sendSlackMessage(accessToken, channelId, message);
          return { 
            success: true, 
            message: `Message sent to ${toolInput.channel}`,
            channel: channelId,  // Return the resolved channel ID for conversation tracking
            ts: sendResult?.ts   // Slack message timestamp (can be used for thread replies)
          };
        }

        case "search_slack_users": {
          const users = await fetchSlackUsers(accessToken);
          const query = (toolInput.query || "").toLowerCase();
          
          let filtered = users.filter(u => !u.deleted && !u.is_bot);
          if (query) {
            filtered = filtered.filter(u => 
              (u.real_name || "").toLowerCase().includes(query) ||
              (u.name || "").toLowerCase().includes(query) ||
              (u.profile?.email || "").toLowerCase().includes(query)
            );
          }

          return {
            users: filtered.slice(0, 20).map(u => ({
              id: u.id,
              name: u.real_name || u.name,
              username: u.name,
              email: u.profile?.email,
              title: u.profile?.title
            }))
          };
        }

        default:
          return { error: `Unknown Slack tool: ${toolName}` };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Telegram Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Telegram bot token from settings
  const getTelegramToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return settings.telegramBotToken || null;
    } catch {
      return null;
    }
  };

  // Telegram tools
  const telegramTools = [
    {
      name: "send_telegram_message",
      description: "Send a message via Telegram bot. Always confirm with user before sending.",
      input_schema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "Chat ID or username (e.g., @username or numeric chat ID)" },
          message: { type: "string", description: "Message text to send" }
        },
        required: ["chat_id", "message"]
      }
    },
    {
      name: "get_telegram_updates",
      description: "Get recent messages received by the Telegram bot.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of updates to fetch (default 20, max 100)" }
        },
        required: []
      }
    },
    {
      name: "get_telegram_chat_info",
      description: "Get information about a Telegram chat or user.",
      input_schema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "Chat ID or username" }
        },
        required: ["chat_id"]
      }
    }
  ];

  // Execute Telegram tool
  const executeTelegramTool = async (toolName, toolInput) => {
    const botToken = await getTelegramToken();
    if (!botToken) {
      return { error: "Telegram not connected. Please set up Telegram in the Integrations page." };
    }

    const baseUrl = `https://api.telegram.org/bot${botToken}`;

    try {
      switch (toolName) {
        case "send_telegram_message": {
          const response = await fetch(`${baseUrl}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: toolInput.chat_id,
              text: toolInput.message,
              parse_mode: "Markdown"
            })
          });
          const data = await response.json();
          if (!data.ok) {
            return { error: data.description || "Failed to send message" };
          }
          return { 
            success: true, 
            message: `Message sent to ${toolInput.chat_id}`, 
            message_id: data.result.message_id,
            chat_id: toolInput.chat_id  // Return chat_id for conversation tracking
          };
        }

        case "get_telegram_updates": {
          const limit = Math.min(toolInput.limit || 20, 100);
          const response = await fetch(`${baseUrl}/getUpdates?limit=${limit}`);
          const data = await response.json();
          if (!data.ok) {
            return { error: data.description || "Failed to get updates" };
          }
          return {
            updates: data.result.map(u => ({
              update_id: u.update_id,
              message: u.message ? {
                message_id: u.message.message_id,
                from: u.message.from?.first_name || u.message.from?.username,
                chat_id: u.message.chat.id,
                chat_type: u.message.chat.type,
                text: u.message.text,
                date: new Date(u.message.date * 1000).toISOString()
              } : null
            })).filter(u => u.message)
          };
        }

        case "get_telegram_chat_info": {
          const response = await fetch(`${baseUrl}/getChat?chat_id=${encodeURIComponent(toolInput.chat_id)}`);
          const data = await response.json();
          if (!data.ok) {
            return { error: data.description || "Failed to get chat info" };
          }
          return {
            chat: {
              id: data.result.id,
              type: data.result.type,
              title: data.result.title,
              username: data.result.username,
              first_name: data.result.first_name,
              last_name: data.result.last_name,
              description: data.result.description
            }
          };
        }

        default:
          return { error: `Unknown Telegram tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Telegram] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Discord Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Discord access token from settings
  const getDiscordAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!settings.discordTokens) return null;
      
      // Check if token needs refresh
      if (settings.discordTokens.expires_at && Date.now() > settings.discordTokens.expires_at - 60000) {
        // Refresh the token
        const refreshed = await refreshDiscordToken(settings.discordTokens);
        if (refreshed) {
          settings.discordTokens = refreshed;
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          return refreshed.access_token;
        }
        return null;
      }
      return settings.discordTokens.access_token;
    } catch {
      return null;
    }
  };

  const refreshDiscordToken = async (tokens) => {
    try {
      const response = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: tokens.client_id,
          client_secret: tokens.client_secret,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token
        })
      });
      const data = await response.json();
      if (data.access_token) {
        return {
          ...tokens,
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + (data.expires_in * 1000)
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Discord tools
  const discordTools = [
    {
      name: "send_discord_message",
      description: "Send a message to a Discord channel or DM. Always confirm with user before sending.",
      input_schema: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Channel ID or user ID for DM" },
          message: { type: "string", description: "Message content to send" }
        },
        required: ["channel_id", "message"]
      }
    },
    {
      name: "get_discord_messages",
      description: "Get recent messages from a Discord channel.",
      input_schema: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Channel ID" },
          limit: { type: "number", description: "Number of messages to fetch (default 20, max 100)" }
        },
        required: ["channel_id"]
      }
    },
    {
      name: "list_discord_channels",
      description: "List channels in a Discord server (guild).",
      input_schema: {
        type: "object",
        properties: {
          guild_id: { type: "string", description: "Server/Guild ID" }
        },
        required: ["guild_id"]
      }
    },
    {
      name: "list_discord_servers",
      description: "List Discord servers (guilds) the bot/user has access to.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    }
  ];

  // Execute Discord tool
  const executeDiscordTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "Discord not connected. Please set up Discord in the Integrations page." };
    }

    const baseUrl = "https://discord.com/api/v10";
    const headers = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };

    try {
      switch (toolName) {
        case "send_discord_message": {
          const response = await fetch(`${baseUrl}/channels/${toolInput.channel_id}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ content: toolInput.message })
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to send message" };
          }
          const data = await response.json();
          return { 
            success: true, 
            message: `Message sent`, 
            message_id: data.id,
            channel_id: toolInput.channel_id  // Return channel_id for conversation tracking
          };
        }

        case "get_discord_messages": {
          const limit = Math.min(toolInput.limit || 20, 100);
          const response = await fetch(`${baseUrl}/channels/${toolInput.channel_id}/messages?limit=${limit}`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to get messages" };
          }
          const messages = await response.json();
          return {
            messages: messages.map(m => ({
              id: m.id,
              content: m.content,
              author: m.author.username,
              timestamp: m.timestamp
            }))
          };
        }

        case "list_discord_channels": {
          const response = await fetch(`${baseUrl}/guilds/${toolInput.guild_id}/channels`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to list channels" };
          }
          const channels = await response.json();
          return {
            channels: channels.filter(c => c.type === 0 || c.type === 2).map(c => ({
              id: c.id,
              name: c.name,
              type: c.type === 0 ? "text" : "voice"
            }))
          };
        }

        case "list_discord_servers": {
          const response = await fetch(`${baseUrl}/users/@me/guilds`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to list servers" };
          }
          const guilds = await response.json();
          return {
            servers: guilds.map(g => ({
              id: g.id,
              name: g.name,
              icon: g.icon
            }))
          };
        }

        default:
          return { error: `Unknown Discord tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Discord] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // X (Twitter) Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get X access token from settings
  const getXAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!settings.xTokens) return null;
      
      // Check if token needs refresh
      if (settings.xTokens.expires_at && Date.now() > settings.xTokens.expires_at - 60000) {
        const refreshed = await refreshXToken(settings.xTokens);
        if (refreshed) {
          settings.xTokens = refreshed;
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          return refreshed.access_token;
        }
        return null;
      }
      return settings.xTokens.access_token;
    } catch {
      return null;
    }
  };

  const refreshXToken = async (tokens) => {
    try {
      const response = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString("base64")}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token
        })
      });
      const data = await response.json();
      if (data.access_token) {
        return {
          ...tokens,
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + (data.expires_in * 1000)
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // X tools
  const xTools = [
    {
      name: "post_tweet",
      description: "Post a tweet to X (Twitter). Always confirm with user before posting.",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Tweet text (max 280 characters)" },
          reply_to: { type: "string", description: "Tweet ID to reply to (optional)" }
        },
        required: ["text"]
      }
    },
    {
      name: "get_x_timeline",
      description: "Get recent tweets from your home timeline.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of tweets to fetch (default 20, max 100)" }
        },
        required: []
      }
    },
    {
      name: "get_x_mentions",
      description: "Get recent mentions of your account.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of mentions to fetch (default 20)" }
        },
        required: []
      }
    },
    {
      name: "search_x_tweets",
      description: "Search for tweets on X.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Number of results (default 20, max 100)" }
        },
        required: ["query"]
      }
    },
    {
      name: "send_x_dm",
      description: "Send a direct message on X. Always confirm with user before sending.",
      input_schema: {
        type: "object",
        properties: {
          recipient_id: { type: "string", description: "User ID of the recipient" },
          message: { type: "string", description: "Message text" }
        },
        required: ["recipient_id", "message"]
      }
    }
  ];

  // Execute X tool
  const executeXTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "X (Twitter) not connected. Please set up X in the Integrations page." };
    }

    const baseUrl = "https://api.twitter.com/2";
    const headers = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };

    try {
      switch (toolName) {
        case "post_tweet": {
          const body = { text: toolInput.text };
          if (toolInput.reply_to) {
            body.reply = { in_reply_to_tweet_id: toolInput.reply_to };
          }
          const response = await fetch(`${baseUrl}/tweets`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.detail || err.title || "Failed to post tweet" };
          }
          const data = await response.json();
          return { success: true, tweet_id: data.data.id, message: "Tweet posted successfully" };
        }

        case "get_x_timeline": {
          const limit = Math.min(toolInput.limit || 20, 100);
          const response = await fetch(`${baseUrl}/users/me/timelines/reverse_chronological?max_results=${limit}&tweet.fields=created_at,author_id,text`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.detail || "Failed to get timeline" };
          }
          const data = await response.json();
          return {
            tweets: (data.data || []).map(t => ({
              id: t.id,
              text: t.text,
              created_at: t.created_at,
              author_id: t.author_id
            }))
          };
        }

        case "get_x_mentions": {
          // First get user ID
          const meResponse = await fetch(`${baseUrl}/users/me`, { headers });
          if (!meResponse.ok) {
            return { error: "Failed to get user info" };
          }
          const meData = await meResponse.json();
          const userId = meData.data.id;
          
          const limit = Math.min(toolInput.limit || 20, 100);
          const response = await fetch(`${baseUrl}/users/${userId}/mentions?max_results=${limit}&tweet.fields=created_at,author_id,text`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.detail || "Failed to get mentions" };
          }
          const data = await response.json();
          return {
            mentions: (data.data || []).map(t => ({
              id: t.id,
              text: t.text,
              created_at: t.created_at,
              author_id: t.author_id
            }))
          };
        }

        case "search_x_tweets": {
          const limit = Math.min(toolInput.limit || 20, 100);
          const response = await fetch(`${baseUrl}/tweets/search/recent?query=${encodeURIComponent(toolInput.query)}&max_results=${limit}&tweet.fields=created_at,author_id,text`, { headers });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.detail || "Failed to search tweets" };
          }
          const data = await response.json();
          return {
            tweets: (data.data || []).map(t => ({
              id: t.id,
              text: t.text,
              created_at: t.created_at,
              author_id: t.author_id
            }))
          };
        }

        case "send_x_dm": {
          const response = await fetch(`${baseUrl}/dm_conversations/with/${toolInput.recipient_id}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ text: toolInput.message })
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.detail || "Failed to send DM" };
          }
          const data = await response.json();
          return { success: true, message: "DM sent successfully", dm_id: data.data?.dm_event_id };
        }

        default:
          return { error: `Unknown X tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[X] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Notion Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Notion access token from settings
  const getNotionAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return settings.notionTokens?.access_token || null;
    } catch {
      return null;
    }
  };

  // Notion tools
  const notionTools = [
    {
      name: "search_notion",
      description: "Search for pages and databases in Notion.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          filter: { type: "string", enum: ["page", "database"], description: "Filter by object type (optional)" }
        },
        required: []
      }
    },
    {
      name: "get_notion_page",
      description: "Get the content of a Notion page.",
      input_schema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" }
        },
        required: ["page_id"]
      }
    },
    {
      name: "create_notion_page",
      description: "Create a new page in Notion.",
      input_schema: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "Parent page or database ID" },
          title: { type: "string", description: "Page title" },
          content: { type: "string", description: "Page content (plain text)" }
        },
        required: ["parent_id", "title"]
      }
    },
    {
      name: "query_notion_database",
      description: "Query a Notion database.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          filter: { type: "object", description: "Filter object (optional)" },
          sorts: { type: "array", description: "Sort array (optional)" }
        },
        required: ["database_id"]
      }
    },
    {
      name: "create_notion_database_item",
      description: "Add a new item to a Notion database.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          properties: { type: "object", description: "Property values for the new item" }
        },
        required: ["database_id", "properties"]
      }
    }
  ];

  // Execute Notion tool
  const executeNotionTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "Notion not connected. Please set up Notion in the Integrations page." };
    }

    const baseUrl = "https://api.notion.com/v1";
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    };

    try {
      switch (toolName) {
        case "search_notion": {
          const body = {};
          if (toolInput.query) body.query = toolInput.query;
          if (toolInput.filter) body.filter = { value: toolInput.filter, property: "object" };
          
          const response = await fetch(`${baseUrl}/search`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Search failed" };
          }
          const data = await response.json();
          return {
            results: data.results.slice(0, 20).map(r => ({
              id: r.id,
              type: r.object,
              title: r.properties?.title?.title?.[0]?.plain_text || r.properties?.Name?.title?.[0]?.plain_text || "Untitled",
              url: r.url
            }))
          };
        }

        case "get_notion_page": {
          // Get page metadata
          const pageResponse = await fetch(`${baseUrl}/pages/${toolInput.page_id}`, { headers });
          if (!pageResponse.ok) {
            const err = await pageResponse.json();
            return { error: err.message || "Failed to get page" };
          }
          const page = await pageResponse.json();
          
          // Get page content (blocks)
          const blocksResponse = await fetch(`${baseUrl}/blocks/${toolInput.page_id}/children?page_size=100`, { headers });
          const blocks = blocksResponse.ok ? await blocksResponse.json() : { results: [] };
          
          return {
            page: {
              id: page.id,
              title: page.properties?.title?.title?.[0]?.plain_text || "Untitled",
              url: page.url,
              created_time: page.created_time,
              last_edited_time: page.last_edited_time
            },
            content: blocks.results.map(b => ({
              type: b.type,
              text: b[b.type]?.rich_text?.map(t => t.plain_text).join("") || ""
            })).filter(b => b.text)
          };
        }

        case "create_notion_page": {
          const body = {
            parent: { page_id: toolInput.parent_id },
            properties: {
              title: { title: [{ text: { content: toolInput.title } }] }
            }
          };
          
          if (toolInput.content) {
            body.children = [{
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: toolInput.content } }]
              }
            }];
          }
          
          const response = await fetch(`${baseUrl}/pages`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to create page" };
          }
          const data = await response.json();
          return { success: true, page_id: data.id, url: data.url };
        }

        case "query_notion_database": {
          const body = {};
          if (toolInput.filter) body.filter = toolInput.filter;
          if (toolInput.sorts) body.sorts = toolInput.sorts;
          
          const response = await fetch(`${baseUrl}/databases/${toolInput.database_id}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Query failed" };
          }
          const data = await response.json();
          return {
            results: data.results.slice(0, 50).map(r => ({
              id: r.id,
              properties: Object.fromEntries(
                Object.entries(r.properties).map(([key, val]) => [
                  key,
                  val.title?.[0]?.plain_text || val.rich_text?.[0]?.plain_text || val.number || val.select?.name || val.date?.start || val.checkbox || JSON.stringify(val)
                ])
              )
            }))
          };
        }

        case "create_notion_database_item": {
          const response = await fetch(`${baseUrl}/pages`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              parent: { database_id: toolInput.database_id },
              properties: toolInput.properties
            })
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to create item" };
          }
          const data = await response.json();
          return { success: true, id: data.id, url: data.url };
        }

        default:
          return { error: `Unknown Notion tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Notion] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // GitHub Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get GitHub access token from settings
  const getGitHubAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return settings.githubTokens?.access_token || null;
    } catch {
      return null;
    }
  };

  // GitHub tools
  const githubTools = [
    {
      name: "list_github_repos",
      description: "List repositories for the authenticated user.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["all", "owner", "member"], description: "Type of repos (default: all)" },
          sort: { type: "string", enum: ["created", "updated", "pushed", "full_name"], description: "Sort by" }
        },
        required: []
      }
    },
    {
      name: "get_github_issues",
      description: "Get issues from a repository.",
      input_schema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state (default: open)" }
        },
        required: ["owner", "repo"]
      }
    },
    {
      name: "create_github_issue",
      description: "Create an issue in a repository.",
      input_schema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body/description" },
          labels: { type: "array", items: { type: "string" }, description: "Labels to add" }
        },
        required: ["owner", "repo", "title"]
      }
    },
    {
      name: "get_github_prs",
      description: "Get pull requests from a repository.",
      input_schema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "PR state (default: open)" }
        },
        required: ["owner", "repo"]
      }
    },
    {
      name: "search_github_code",
      description: "Search for code on GitHub.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (can include qualifiers like repo:owner/name)" }
        },
        required: ["query"]
      }
    },
    {
      name: "get_github_notifications",
      description: "Get notifications for the authenticated user.",
      input_schema: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Show all notifications (default: false, shows only unread)" }
        },
        required: []
      }
    }
  ];

  // Execute GitHub tool
  const executeGitHubTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "GitHub not connected. Please set up GitHub in the Integrations page." };
    }

    const baseUrl = "https://api.github.com";
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    try {
      switch (toolName) {
        case "list_github_repos": {
          const params = new URLSearchParams();
          if (toolInput.type) params.set("type", toolInput.type);
          if (toolInput.sort) params.set("sort", toolInput.sort);
          params.set("per_page", "30");
          
          const response = await fetch(`${baseUrl}/user/repos?${params}`, { headers });
          if (!response.ok) {
            return { error: "Failed to list repos" };
          }
          const repos = await response.json();
          return {
            repos: repos.map(r => ({
              name: r.full_name,
              description: r.description,
              private: r.private,
              stars: r.stargazers_count,
              language: r.language,
              updated_at: r.updated_at
            }))
          };
        }

        case "get_github_issues": {
          const state = toolInput.state || "open";
          const response = await fetch(`${baseUrl}/repos/${toolInput.owner}/${toolInput.repo}/issues?state=${state}&per_page=30`, { headers });
          if (!response.ok) {
            return { error: "Failed to get issues" };
          }
          const issues = await response.json();
          return {
            issues: issues.filter(i => !i.pull_request).map(i => ({
              number: i.number,
              title: i.title,
              state: i.state,
              author: i.user.login,
              labels: i.labels.map(l => l.name),
              created_at: i.created_at
            }))
          };
        }

        case "create_github_issue": {
          const body = {
            title: toolInput.title,
            body: toolInput.body || ""
          };
          if (toolInput.labels) body.labels = toolInput.labels;
          
          const response = await fetch(`${baseUrl}/repos/${toolInput.owner}/${toolInput.repo}/issues`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.message || "Failed to create issue" };
          }
          const issue = await response.json();
          return { success: true, number: issue.number, url: issue.html_url };
        }

        case "get_github_prs": {
          const state = toolInput.state || "open";
          const response = await fetch(`${baseUrl}/repos/${toolInput.owner}/${toolInput.repo}/pulls?state=${state}&per_page=30`, { headers });
          if (!response.ok) {
            return { error: "Failed to get PRs" };
          }
          const prs = await response.json();
          return {
            pull_requests: prs.map(pr => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              author: pr.user.login,
              created_at: pr.created_at,
              merged: pr.merged_at !== null
            }))
          };
        }

        case "search_github_code": {
          const response = await fetch(`${baseUrl}/search/code?q=${encodeURIComponent(toolInput.query)}&per_page=20`, { headers });
          if (!response.ok) {
            return { error: "Failed to search code" };
          }
          const data = await response.json();
          return {
            results: data.items.map(i => ({
              name: i.name,
              path: i.path,
              repo: i.repository.full_name,
              url: i.html_url
            }))
          };
        }

        case "get_github_notifications": {
          const all = toolInput.all ? "true" : "false";
          const response = await fetch(`${baseUrl}/notifications?all=${all}&per_page=30`, { headers });
          if (!response.ok) {
            return { error: "Failed to get notifications" };
          }
          const notifications = await response.json();
          return {
            notifications: notifications.map(n => ({
              id: n.id,
              reason: n.reason,
              unread: n.unread,
              title: n.subject.title,
              type: n.subject.type,
              repo: n.repository.full_name,
              updated_at: n.updated_at
            }))
          };
        }

        default:
          return { error: `Unknown GitHub tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[GitHub] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Asana Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Asana access token from settings
  const getAsanaAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!settings.asanaTokens) return null;
      
      // Check if token needs refresh
      if (settings.asanaTokens.expires_at && Date.now() > settings.asanaTokens.expires_at - 60000) {
        const refreshed = await refreshAsanaToken(settings.asanaTokens);
        if (refreshed) {
          settings.asanaTokens = refreshed;
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          return refreshed.access_token;
        }
        return null;
      }
      return settings.asanaTokens.access_token;
    } catch {
      return null;
    }
  };

  const refreshAsanaToken = async (tokens) => {
    try {
      const response = await fetch("https://app.asana.com/-/oauth_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: tokens.client_id,
          client_secret: tokens.client_secret,
          refresh_token: tokens.refresh_token
        })
      });
      const data = await response.json();
      if (data.access_token) {
        return {
          ...tokens,
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + (data.expires_in * 1000)
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Asana tools
  const asanaTools = [
    {
      name: "list_asana_workspaces",
      description: "List Asana workspaces the user has access to.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "list_asana_projects",
      description: "List projects in an Asana workspace.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" }
        },
        required: ["workspace_id"]
      }
    },
    {
      name: "get_asana_tasks",
      description: "Get tasks from an Asana project.",
      input_schema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project ID" },
          completed: { type: "boolean", description: "Include completed tasks (default: false)" }
        },
        required: ["project_id"]
      }
    },
    {
      name: "create_asana_task",
      description: "Create a task in Asana.",
      input_schema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project ID to add the task to" },
          name: { type: "string", description: "Task name" },
          notes: { type: "string", description: "Task description/notes" },
          due_on: { type: "string", description: "Due date (YYYY-MM-DD format)" },
          assignee: { type: "string", description: "Assignee user ID or email" }
        },
        required: ["project_id", "name"]
      }
    },
    {
      name: "update_asana_task",
      description: "Update an existing Asana task.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID" },
          name: { type: "string", description: "New task name" },
          notes: { type: "string", description: "New notes" },
          due_on: { type: "string", description: "New due date" },
          completed: { type: "boolean", description: "Mark as completed" }
        },
        required: ["task_id"]
      }
    },
    {
      name: "complete_asana_task",
      description: "Mark an Asana task as complete.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to complete" }
        },
        required: ["task_id"]
      }
    }
  ];

  // Execute Asana tool
  const executeAsanaTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "Asana not connected. Please set up Asana in the Integrations page." };
    }

    const baseUrl = "https://app.asana.com/api/1.0";
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };

    try {
      switch (toolName) {
        case "list_asana_workspaces": {
          const response = await fetch(`${baseUrl}/workspaces`, { headers });
          if (!response.ok) {
            return { error: "Failed to list workspaces" };
          }
          const data = await response.json();
          return {
            workspaces: data.data.map(w => ({
              id: w.gid,
              name: w.name
            }))
          };
        }

        case "list_asana_projects": {
          const response = await fetch(`${baseUrl}/workspaces/${toolInput.workspace_id}/projects`, { headers });
          if (!response.ok) {
            return { error: "Failed to list projects" };
          }
          const data = await response.json();
          return {
            projects: data.data.map(p => ({
              id: p.gid,
              name: p.name
            }))
          };
        }

        case "get_asana_tasks": {
          const completed = toolInput.completed ? "true" : "false";
          const response = await fetch(`${baseUrl}/projects/${toolInput.project_id}/tasks?opt_fields=name,notes,due_on,completed,assignee.name&completed_since=${completed === "true" ? "now" : ""}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get tasks" };
          }
          const data = await response.json();
          return {
            tasks: data.data.map(t => ({
              id: t.gid,
              name: t.name,
              notes: t.notes,
              due_on: t.due_on,
              completed: t.completed,
              assignee: t.assignee?.name
            }))
          };
        }

        case "create_asana_task": {
          const taskData = {
            name: toolInput.name,
            projects: [toolInput.project_id]
          };
          if (toolInput.notes) taskData.notes = toolInput.notes;
          if (toolInput.due_on) taskData.due_on = toolInput.due_on;
          if (toolInput.assignee) taskData.assignee = toolInput.assignee;
          
          const response = await fetch(`${baseUrl}/tasks`, {
            method: "POST",
            headers,
            body: JSON.stringify({ data: taskData })
          });
          if (!response.ok) {
            const err = await response.json();
            return { error: err.errors?.[0]?.message || "Failed to create task" };
          }
          const data = await response.json();
          return { success: true, task_id: data.data.gid, name: data.data.name };
        }

        case "update_asana_task": {
          const taskData = {};
          if (toolInput.name) taskData.name = toolInput.name;
          if (toolInput.notes !== undefined) taskData.notes = toolInput.notes;
          if (toolInput.due_on) taskData.due_on = toolInput.due_on;
          if (toolInput.completed !== undefined) taskData.completed = toolInput.completed;
          
          const response = await fetch(`${baseUrl}/tasks/${toolInput.task_id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ data: taskData })
          });
          if (!response.ok) {
            return { error: "Failed to update task" };
          }
          return { success: true, message: "Task updated" };
        }

        case "complete_asana_task": {
          const response = await fetch(`${baseUrl}/tasks/${toolInput.task_id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ data: { completed: true } })
          });
          if (!response.ok) {
            return { error: "Failed to complete task" };
          }
          return { success: true, message: "Task marked as complete" };
        }

        default:
          return { error: `Unknown Asana tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Asana] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Reddit Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Reddit access token from settings
  const getRedditAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!settings.redditTokens) return null;
      
      // Check if token needs refresh
      if (settings.redditTokens.expires_at && Date.now() > settings.redditTokens.expires_at - 60000) {
        const refreshed = await refreshRedditToken(settings.redditTokens);
        if (refreshed) {
          settings.redditTokens = refreshed;
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          return refreshed.access_token;
        }
        return null;
      }
      return settings.redditTokens.access_token;
    } catch {
      return null;
    }
  };

  const refreshRedditToken = async (tokens) => {
    try {
      const response = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString("base64")}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token
        })
      });
      const data = await response.json();
      if (data.access_token) {
        return {
          ...tokens,
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + (data.expires_in * 1000)
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Reddit tools
  const redditTools = [
    {
      name: "get_reddit_feed",
      description: "Get posts from Reddit home feed.",
      input_schema: {
        type: "object",
        properties: {
          sort: { type: "string", enum: ["hot", "new", "top", "rising"], description: "Sort order (default: hot)" },
          limit: { type: "number", description: "Number of posts (default 25, max 100)" }
        },
        required: []
      }
    },
    {
      name: "get_subreddit_posts",
      description: "Get posts from a specific subreddit.",
      input_schema: {
        type: "object",
        properties: {
          subreddit: { type: "string", description: "Subreddit name (without r/)" },
          sort: { type: "string", enum: ["hot", "new", "top", "rising"], description: "Sort order" },
          limit: { type: "number", description: "Number of posts (default 25)" }
        },
        required: ["subreddit"]
      }
    },
    {
      name: "get_reddit_comments",
      description: "Get comments on a Reddit post.",
      input_schema: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "Post ID (the thing after t3_)" },
          subreddit: { type: "string", description: "Subreddit name" },
          limit: { type: "number", description: "Number of comments (default 25)" }
        },
        required: ["post_id", "subreddit"]
      }
    },
    {
      name: "create_reddit_post",
      description: "Create a post on Reddit. Always confirm with user before posting.",
      input_schema: {
        type: "object",
        properties: {
          subreddit: { type: "string", description: "Subreddit to post to" },
          title: { type: "string", description: "Post title" },
          text: { type: "string", description: "Post text (for self posts)" },
          url: { type: "string", description: "URL to link (for link posts)" }
        },
        required: ["subreddit", "title"]
      }
    },
    {
      name: "create_reddit_comment",
      description: "Add a comment to a Reddit post. Always confirm with user before posting.",
      input_schema: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "Parent thing ID (t1_ for comment, t3_ for post)" },
          text: { type: "string", description: "Comment text" }
        },
        required: ["parent_id", "text"]
      }
    },
    {
      name: "get_reddit_messages",
      description: "Get Reddit inbox messages.",
      input_schema: {
        type: "object",
        properties: {
          where: { type: "string", enum: ["inbox", "unread", "sent"], description: "Message location (default: inbox)" }
        },
        required: []
      }
    }
  ];

  // Execute Reddit tool
  const executeRedditTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "Reddit not connected. Please set up Reddit in the Integrations page." };
    }

    const baseUrl = "https://oauth.reddit.com";
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": "Wovly/1.0"
    };

    try {
      switch (toolName) {
        case "get_reddit_feed": {
          const sort = toolInput.sort || "hot";
          const limit = Math.min(toolInput.limit || 25, 100);
          const response = await fetch(`${baseUrl}/${sort}?limit=${limit}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get feed" };
          }
          const data = await response.json();
          return {
            posts: data.data.children.map(p => ({
              id: p.data.id,
              title: p.data.title,
              subreddit: p.data.subreddit,
              author: p.data.author,
              score: p.data.score,
              num_comments: p.data.num_comments,
              url: p.data.url,
              selftext: p.data.selftext?.slice(0, 500)
            }))
          };
        }

        case "get_subreddit_posts": {
          const sort = toolInput.sort || "hot";
          const limit = Math.min(toolInput.limit || 25, 100);
          const response = await fetch(`${baseUrl}/r/${toolInput.subreddit}/${sort}?limit=${limit}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get subreddit posts" };
          }
          const data = await response.json();
          return {
            posts: data.data.children.map(p => ({
              id: p.data.id,
              title: p.data.title,
              author: p.data.author,
              score: p.data.score,
              num_comments: p.data.num_comments,
              url: p.data.url,
              selftext: p.data.selftext?.slice(0, 500)
            }))
          };
        }

        case "get_reddit_comments": {
          const limit = Math.min(toolInput.limit || 25, 100);
          const response = await fetch(`${baseUrl}/r/${toolInput.subreddit}/comments/${toolInput.post_id}?limit=${limit}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get comments" };
          }
          const data = await response.json();
          const comments = data[1]?.data?.children || [];
          return {
            comments: comments.filter(c => c.kind === "t1").map(c => ({
              id: c.data.id,
              author: c.data.author,
              body: c.data.body?.slice(0, 500),
              score: c.data.score,
              created_utc: c.data.created_utc
            }))
          };
        }

        case "create_reddit_post": {
          const formData = new URLSearchParams();
          formData.append("sr", toolInput.subreddit);
          formData.append("title", toolInput.title);
          formData.append("kind", toolInput.url ? "link" : "self");
          if (toolInput.url) formData.append("url", toolInput.url);
          if (toolInput.text) formData.append("text", toolInput.text);
          
          const response = await fetch(`${baseUrl}/api/submit`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body: formData
          });
          if (!response.ok) {
            return { error: "Failed to create post" };
          }
          const data = await response.json();
          if (data.json?.errors?.length > 0) {
            return { error: data.json.errors[0][1] };
          }
          return { success: true, url: data.json?.data?.url, id: data.json?.data?.id };
        }

        case "create_reddit_comment": {
          const formData = new URLSearchParams();
          formData.append("thing_id", toolInput.parent_id);
          formData.append("text", toolInput.text);
          
          const response = await fetch(`${baseUrl}/api/comment`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body: formData
          });
          if (!response.ok) {
            return { error: "Failed to create comment" };
          }
          const data = await response.json();
          if (data.json?.errors?.length > 0) {
            return { error: data.json.errors[0][1] };
          }
          return { success: true, message: "Comment posted" };
        }

        case "get_reddit_messages": {
          const where = toolInput.where || "inbox";
          const response = await fetch(`${baseUrl}/message/${where}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get messages" };
          }
          const data = await response.json();
          return {
            messages: data.data.children.map(m => ({
              id: m.data.id,
              subject: m.data.subject,
              author: m.data.author,
              body: m.data.body?.slice(0, 500),
              created_utc: m.data.created_utc,
              new: m.data.new
            }))
          };
        }

        default:
          return { error: `Unknown Reddit tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Reddit] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Spotify Integration
  // ─────────────────────────────────────────────────────────────────────────────

  // Get Spotify access token from settings
  const getSpotifyAccessToken = async () => {
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!settings.spotifyTokens) return null;
      
      // Check if token needs refresh
      if (settings.spotifyTokens.expires_at && Date.now() > settings.spotifyTokens.expires_at - 60000) {
        const refreshed = await refreshSpotifyToken(settings.spotifyTokens);
        if (refreshed) {
          settings.spotifyTokens = refreshed;
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          return refreshed.access_token;
        }
        return null;
      }
      return settings.spotifyTokens.access_token;
    } catch {
      return null;
    }
  };

  const refreshSpotifyToken = async (tokens) => {
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString("base64")}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token
        })
      });
      const data = await response.json();
      if (data.access_token) {
        return {
          ...tokens,
          access_token: data.access_token,
          expires_at: Date.now() + (data.expires_in * 1000)
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Spotify tools
  const spotifyTools = [
    {
      name: "get_spotify_now_playing",
      description: "Get the currently playing track on Spotify.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "spotify_play",
      description: "Start or resume playback on Spotify. Requires Spotify Premium.",
      input_schema: {
        type: "object",
        properties: {
          uri: { type: "string", description: "Spotify URI to play (optional, resumes current if not specified)" }
        },
        required: []
      }
    },
    {
      name: "spotify_pause",
      description: "Pause Spotify playback. Requires Spotify Premium.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "spotify_next",
      description: "Skip to next track on Spotify. Requires Spotify Premium.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "spotify_previous",
      description: "Go to previous track on Spotify. Requires Spotify Premium.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "search_spotify",
      description: "Search for tracks, artists, albums, or playlists on Spotify.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          type: { type: "string", enum: ["track", "artist", "album", "playlist"], description: "Type to search for (default: track)" },
          limit: { type: "number", description: "Number of results (default 10, max 50)" }
        },
        required: ["query"]
      }
    },
    {
      name: "get_spotify_playlists",
      description: "Get the user's Spotify playlists.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of playlists (default 20, max 50)" }
        },
        required: []
      }
    }
  ];

  // Execute Spotify tool
  const executeSpotifyTool = async (toolName, toolInput, accessToken) => {
    if (!accessToken) {
      return { error: "Spotify not connected. Please set up Spotify in the Integrations page." };
    }

    const baseUrl = "https://api.spotify.com/v1";
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };

    try {
      switch (toolName) {
        case "get_spotify_now_playing": {
          const response = await fetch(`${baseUrl}/me/player/currently-playing`, { headers });
          if (response.status === 204) {
            return { playing: false, message: "Nothing currently playing" };
          }
          if (!response.ok) {
            return { error: "Failed to get now playing" };
          }
          const data = await response.json();
          return {
            playing: data.is_playing,
            track: {
              name: data.item?.name,
              artist: data.item?.artists?.map(a => a.name).join(", "),
              album: data.item?.album?.name,
              duration_ms: data.item?.duration_ms,
              progress_ms: data.progress_ms
            }
          };
        }

        case "spotify_play": {
          const body = toolInput.uri ? { uris: [toolInput.uri] } : undefined;
          const response = await fetch(`${baseUrl}/me/player/play`, {
            method: "PUT",
            headers,
            body: body ? JSON.stringify(body) : undefined
          });
          if (response.status === 204 || response.ok) {
            return { success: true, message: "Playback started" };
          }
          const err = await response.json();
          return { error: err.error?.message || "Failed to start playback" };
        }

        case "spotify_pause": {
          const response = await fetch(`${baseUrl}/me/player/pause`, {
            method: "PUT",
            headers
          });
          if (response.status === 204 || response.ok) {
            return { success: true, message: "Playback paused" };
          }
          return { error: "Failed to pause playback" };
        }

        case "spotify_next": {
          const response = await fetch(`${baseUrl}/me/player/next`, {
            method: "POST",
            headers
          });
          if (response.status === 204 || response.ok) {
            return { success: true, message: "Skipped to next track" };
          }
          return { error: "Failed to skip track" };
        }

        case "spotify_previous": {
          const response = await fetch(`${baseUrl}/me/player/previous`, {
            method: "POST",
            headers
          });
          if (response.status === 204 || response.ok) {
            return { success: true, message: "Went to previous track" };
          }
          return { error: "Failed to go to previous track" };
        }

        case "search_spotify": {
          const type = toolInput.type || "track";
          const limit = Math.min(toolInput.limit || 10, 50);
          const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(toolInput.query)}&type=${type}&limit=${limit}`, { headers });
          if (!response.ok) {
            return { error: "Search failed" };
          }
          const data = await response.json();
          const key = `${type}s`;
          return {
            results: (data[key]?.items || []).map(item => ({
              name: item.name,
              uri: item.uri,
              ...(type === "track" ? { artist: item.artists?.map(a => a.name).join(", "), album: item.album?.name } : {}),
              ...(type === "artist" ? { genres: item.genres, followers: item.followers?.total } : {}),
              ...(type === "album" ? { artist: item.artists?.map(a => a.name).join(", "), release_date: item.release_date } : {}),
              ...(type === "playlist" ? { owner: item.owner?.display_name, tracks: item.tracks?.total } : {})
            }))
          };
        }

        case "get_spotify_playlists": {
          const limit = Math.min(toolInput.limit || 20, 50);
          const response = await fetch(`${baseUrl}/me/playlists?limit=${limit}`, { headers });
          if (!response.ok) {
            return { error: "Failed to get playlists" };
          }
          const data = await response.json();
          return {
            playlists: data.items.map(p => ({
              id: p.id,
              name: p.name,
              uri: p.uri,
              tracks: p.tracks?.total,
              public: p.public
            }))
          };
        }

        default:
          return { error: `Unknown Spotify tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[Spotify] Error executing ${toolName}:`, err.message);
      return { error: err.message };
    }
  };

  // Task tools - for creating and managing background tasks
  const taskTools = [
    {
      name: "create_task",
      description: "IMPORTANT: Only call this AFTER the user has explicitly confirmed they want to create the task. Do NOT call this immediately - first describe your proposed plan in plain text and ask 'Would you like me to create this task?' Then WAIT for the user to say yes/confirm/go ahead before calling this tool. This creates an autonomous background task that runs independently. CRITICAL: When you call create_task, do NOT also call send_email, send_imessage, or any other action tool - the task executor will handle ALL steps automatically. If you send a message AND create a task, duplicate messages will be sent.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short descriptive title for the task (e.g., 'Schedule lunch with Jeff')" },
          originalRequest: { type: "string", description: "The user's original request verbatim - copy exactly what they said" },
          messagingChannel: { 
            type: "string", 
            enum: ["imessage", "email", "slack", "telegram", "discord", "x"],
            description: "REQUIRED: Which messaging channel to use. Detect from keywords in user's request: 'text'/'message'/'sms' = imessage, 'email'/'mail' = email, 'slack' = slack, 'telegram' = telegram, 'discord' = discord, 'tweet'/'x'/'twitter' = x" 
          },
          plan: { 
            type: "array", 
            items: { type: "string" }, 
            description: "Step-by-step plan to accomplish the task. Be specific about what each step does." 
          },
          context: { 
            type: "object", 
            description: "Key context needed for the task - emails, names, durations, dates, etc. Store anything the task needs to remember." 
          }
        },
        required: ["title", "originalRequest", "messagingChannel", "plan"]
      }
    },
    {
      name: "list_tasks",
      description: "List all existing tasks with their current status.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "cancel_task",
      description: "Cancel an existing task by its ID.",
      input_schema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The ID of the task to cancel" }
        },
        required: ["taskId"]
      }
    }
  ];

  // Execute task tool
  const executeTaskTool = async (toolName, toolInput) => {
    try {
      switch (toolName) {
        case "create_task": {
          const task = await createTask(toolInput, currentUser?.username);
          
          // Send initial notification that task is starting
          if (win && win.webContents) {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `🚀 **Task Started: ${task.title}**\n\nExecuting step 1: ${task.plan[0] || "Starting..."}`,
              source: "task"
            });
          }
          
          // Auto-start the task immediately (don't await - let it run in background)
          setTimeout(async () => {
            console.log(`[Tasks] Auto-starting task: ${task.id}`);
            await executeTaskStep(task.id, currentUser?.username);
          }, 100);
          
          return {
            success: true,
            taskId: task.id,
            message: `Task "${task.title}" created and started! The first step is now executing.`,
            plan: task.plan
          };
        }
        case "list_tasks": {
          const tasks = await listTasks(currentUser?.username);
          return {
            tasks: tasks.map(t => ({
              id: t.id,
              title: t.title,
              status: t.status,
              currentStep: t.currentStep.step,
              totalSteps: t.plan.length,
              lastUpdated: t.lastUpdated
            }))
          };
        }
        case "cancel_task": {
          const result = await cancelTask(toolInput.taskId);
          if (result.error) {
            return { error: result.error };
          }
          return { success: true, message: `Task cancelled successfully` };
        }
        default:
          return { error: `Unknown task tool: ${toolName}` };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  // Execute Google tool
  const executeGoogleTool = async (toolName, toolInput, accessToken) => {
    try {
      switch (toolName) {
        case "get_calendar_events": {
          // Get today's date in local timezone if not specified
          const today = new Date();
          const dateStr = toolInput.date || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const days = toolInput.days || 1;
          
          // Parse date in local timezone (not UTC)
          // "2026-01-31" should be midnight Jan 31 LOCAL time, not UTC
          const [year, month, day] = dateStr.split('-').map(Number);
          const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
          const endDate = new Date(year, month - 1, day + days, 0, 0, 0, 0);
          
          console.log(`[Calendar] Requested date: ${dateStr}, local start: ${startDate.toLocaleString()}, local end: ${endDate.toLocaleString()}`);
          
          return await fetchCalendarEvents(accessToken, startDate, endDate);
        }

        case "create_calendar_event": {
          const { title, start, end, description, location, attendees, sendNotifications = true } = toolInput;
          
          // Build event body
          const eventBody = {
            summary: title,
            start: { dateTime: start },
            end: { dateTime: end },
            description,
            location
          };
          
          // Add attendees if provided
          if (attendees && attendees.length > 0) {
            eventBody.attendees = attendees.map(email => ({ email }));
          }
          
          // Build URL with sendUpdates parameter
          const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
          if (attendees && attendees.length > 0) {
            url.searchParams.set("sendUpdates", sendNotifications ? "all" : "none");
          }
          
          const response = await fetch(url.toString(), {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(eventBody)
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("Calendar API error:", errorData);
            throw new Error(errorData.error?.message || "Failed to create event");
          }
          
          const event = await response.json();
          const attendeeCount = attendees?.length || 0;
          const attendeeMsg = attendeeCount > 0 ? ` with ${attendeeCount} attendee(s) invited` : "";
          return { 
            success: true, 
            eventId: event.id, 
            htmlLink: event.htmlLink,
            message: `Created event: ${title}${attendeeMsg}` 
          };
        }

        case "delete_calendar_event": {
          const { eventId } = toolInput;
          
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
            {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${accessToken}` }
            }
          );
          
          if (!response.ok && response.status !== 204) throw new Error("Failed to delete event");
          return { success: true, message: "Event deleted" };
        }

        case "search_emails": {
          const { query, maxResults = 10 } = toolInput;
          
          const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
          url.searchParams.set("q", query);
          url.searchParams.set("maxResults", maxResults.toString());
          
          const response = await fetch(url.toString(), {
            headers: { "Authorization": `Bearer ${accessToken}` }
          });
          
          if (!response.ok) throw new Error("Failed to search emails");
          const data = await response.json();
          return { messages: data.messages || [], resultCount: data.resultSizeEstimate || 0 };
        }

        case "get_email_content": {
          const { messageId } = toolInput;
          
          const response = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
            { headers: { "Authorization": `Bearer ${accessToken}` } }
          );
          
          if (!response.ok) throw new Error("Failed to get email");
          const email = await response.json();
          
          const headers = email.payload?.headers || [];
          const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
          
          let body = "";
          const extractBody = (part) => {
            if (part.body?.data) {
              body = Buffer.from(part.body.data, "base64").toString("utf8");
            }
            if (part.parts) {
              for (const p of part.parts) {
                if (p.mimeType === "text/plain") extractBody(p);
              }
            }
          };
          extractBody(email.payload);
          
          return {
            id: email.id,
            threadId: email.threadId, // For replying in the same thread
            messageId: getHeader("Message-ID"), // For In-Reply-To header
            subject: getHeader("Subject"),
            from: getHeader("From"),
            to: getHeader("To"),
            date: getHeader("Date"),
            body: body.substring(0, 2000)
          };
        }

        case "send_email": {
          const { to, subject, body, cc, bcc, threadId, replyToMessageId } = toolInput;
          
          let emailContent = `To: ${to}\r\n`;
          if (cc) emailContent += `Cc: ${cc}\r\n`;
          if (bcc) emailContent += `Bcc: ${bcc}\r\n`;
          
          // For replies, add In-Reply-To and References headers to maintain thread
          if (replyToMessageId) {
            emailContent += `In-Reply-To: ${replyToMessageId}\r\n`;
            emailContent += `References: ${replyToMessageId}\r\n`;
          }
          
          emailContent += `Subject: ${subject}\r\n`;
          emailContent += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
          emailContent += body;
          
          const encodedEmail = Buffer.from(emailContent).toString("base64")
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          
          // Build request body - include threadId for replies
          const requestBody = { raw: encodedEmail };
          if (threadId) {
            requestBody.threadId = threadId;
          }
          
          const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
          });
          
          if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Failed to send email: ${errData}`);
          }
          
          const result = await response.json();
          return { 
            success: true, 
            message: `Email sent to ${to}`,
            messageId: result.id,
            threadId: result.threadId
          };
        }

        case "list_drive_files": {
          const { query, maxResults = 10 } = toolInput;
          
          const url = new URL("https://www.googleapis.com/drive/v3/files");
          url.searchParams.set("pageSize", maxResults.toString());
          if (query) url.searchParams.set("q", `name contains '${query}'`);
          
          const response = await fetch(url.toString(), {
            headers: { "Authorization": `Bearer ${accessToken}` }
          });
          
          if (!response.ok) throw new Error("Failed to list files");
          const data = await response.json();
          return { files: data.files || [] };
        }

        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  // Execute profile tool
  const executeProfileTool = async (toolName, toolInput) => {
    try {
      const profilePath = await getUserProfilePath(currentUser?.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      const profile = parseUserProfile(markdown);

      if (toolName === "get_user_profile") {
        return profile;
      }

      if (toolName === "update_user_profile") {
        // Handle addNote
        if (toolInput.addNote) {
          if (!profile.notes) {
            profile.notes = [];
          }
          // Check if similar note already exists
          const existingIndex = profile.notes.findIndex(n => 
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
            profile.notes = profile.notes.filter(n => 
              !n.toLowerCase().includes(toolInput.removeNote.toLowerCase())
            );
          }
          delete toolInput.removeNote;
        }

        // Update other fields
        const { addNote, removeNote, ...otherFields } = toolInput;
        Object.assign(profile, otherFields);
        
        // Check if we should advance onboarding from profile stage to task_demo
        // Requires: first name (not default), and at least one of: occupation, city, or homeLife
        const hasBasicInfo = profile.firstName && profile.firstName !== "User" && profile.firstName !== "";
        const hasContextInfo = profile.occupation || profile.city || profile.homeLife;
        if (profile.onboardingStage === "profile" && hasBasicInfo && hasContextInfo) {
          console.log("[Onboarding] Profile info collected, advancing to task_demo stage");
          profile.onboardingStage = "task_demo";
        }
        
        const newMarkdown = serializeUserProfile(profile);
        await fs.writeFile(profilePath, newMarkdown, "utf8");
        return { success: true, profile, message: "Profile updated successfully" };
      }

      return { error: "Unknown profile tool" };
    } catch (err) {
      return { error: err.message };
    }
  };

  // Execute iMessage tool
  const executeIMessageTool = async (toolName, toolInput) => {
    const { exec } = require("child_process");
    const dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db");

    if (process.platform !== "darwin") {
      return { error: "iMessage is only available on macOS" };
    }

    try {
      await fs.access(dbPath);
    } catch {
      return { error: "Cannot access Messages database. Grant Full Disk Access." };
    }

    // Helper to find contacts by name - returns structured contact data
    const findContactsByName = (name) => {
      return new Promise((resolve) => {
        const searchName = name.toLowerCase().replace(/'/g, "''");
        console.log(`[iMessage] Looking up contact: ${name}`);
        
        // Try using the 'contacts' CLI tool first (more reliable, less permissions issues)
        // This uses Spotlight's metadata which doesn't require Automation permission
        exec(`mdfind -onlyin ~/Library/Application\\ Support/AddressBook "kMDItemKind == 'Contact' && kMDItemDisplayName == '*${name}*'cd"`, { timeout: 5000 }, (mdError, mdStdout) => {
          // If mdfind works and finds something, we still need AppleScript to get phone numbers
          // So let's try a simpler AppleScript approach
          
          // Simpler AppleScript - searches by name property directly
          const appleScript = `
            set output to ""
            tell application "Contacts"
              try
                set foundPeople to (every person whose name contains "${searchName}")
                repeat with aPerson in foundPeople
                  set personName to name of aPerson
                  set phoneInfo to ""
                  repeat with aPhone in phones of aPerson
                    try
                      set phoneInfo to phoneInfo & (label of aPhone) & ":" & (value of aPhone) & ","
                    end try
                  end repeat
                  if phoneInfo is not "" then
                    set output to output & personName & "|" & phoneInfo & ";"
                  end if
                end repeat
              end try
            end tell
            return output
          `;
          
          exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
              // Check for specific permission errors
              const errorMsg = error.message || stderr || "";
              console.error(`[iMessage] Contact lookup error: ${errorMsg}`);
              
              if (errorMsg.includes("not allowed") || errorMsg.includes("permission") || errorMsg.includes("(-1743)")) {
                console.error(`[iMessage] Permission denied. Grant Automation permission for Contacts in System Settings > Privacy & Security > Automation`);
              }
              
              resolve([]);
              return;
            }
          
            const output = stdout.trim();
            console.log(`[iMessage] Contact lookup raw output: ${output}`);
            
            if (!output || output === "" || output === "{}") {
              console.log(`[iMessage] No contacts found for "${name}"`);
              resolve([]);
              return;
            }
            
            // Parse the output - new format: "Name|label:number,label:number,;Name2|label:number,;"
            const contacts = [];
            // Split by semicolon to get individual contacts
            const entries = output.split(";").filter(e => e.trim());
            
            for (const entry of entries) {
              const parts = entry.trim().split("|");
              if (parts.length >= 2) {
                const contactName = parts[0].trim();
                const phonesStr = parts.slice(1).join("|");
                
                // Extract phone numbers - format: "label:number,"
                const phones = [];
                const phoneMatches = phonesStr.match(/([^:,]+):([^,]+)/g) || [];
                for (const pm of phoneMatches) {
                  const colonIdx = pm.indexOf(":");
                  if (colonIdx > -1) {
                    const label = pm.substring(0, colonIdx).trim();
                    const number = pm.substring(colonIdx + 1).trim();
                    if (number) {
                      phones.push({
                        label: label || "phone",
                        number: number
                      });
                    }
                  }
                }
                
                // Also try to extract any remaining phone numbers
                const extraPhones = phonesStr.match(/\+?\d[\d\s()-]{6,}/g) || [];
                for (const phone of extraPhones) {
                  const cleanPhone = phone.replace(/[\s()-]/g, "");
                  if (!phones.some(p => p.number.replace(/[\s()-]/g, "") === cleanPhone)) {
                    phones.push({ label: "phone", number: cleanPhone });
                  }
                }
                
                if (phones.length > 0) {
                  contacts.push({ name: contactName, phones });
                }
              }
            }
            
            console.log(`[iMessage] Found ${contacts.length} contacts:`, JSON.stringify(contacts));
            resolve(contacts);
          });
        });
      });
    };
    
    // Legacy helper for backward compatibility
    const findPhoneByName = async (name) => {
      const contacts = await findContactsByName(name);
      if (contacts.length > 0) {
        // Return first phone number of first contact
        return contacts.flatMap(c => c.phones.map(p => p.number));
      }
      return [];
    };

    try {
      switch (toolName) {
        case "get_recent_messages": {
          const hours = toolInput.hours || 24;
          const contactFilter = toolInput.contact || null;
          const limit = toolInput.limit || 50;

          const cutoffDate = new Date();
          cutoffDate.setHours(cutoffDate.getHours() - hours);
          const appleEpoch = new Date("2001-01-01T00:00:00Z").getTime();
          const cutoffTimestamp = (cutoffDate.getTime() - appleEpoch) * 1000000;

          let whereClause = `m.date > ${cutoffTimestamp}`;
          
          // If contact filter provided, try to resolve it to phone numbers
          let contactPhones = [];
          if (contactFilter) {
            // Check if it's a name (contains letters) or a phone number
            if (/[a-zA-Z]/.test(contactFilter)) {
              contactPhones = await findPhoneByName(contactFilter);
            }
            
            if (contactPhones.length > 0) {
              // Match any of the found phone numbers
              const phoneConditions = contactPhones.map(phone => {
                const digits = phone.replace(/\D/g, "");
                return `h.id LIKE '%${digits.slice(-10)}%'`;
              }).join(" OR ");
              whereClause += ` AND (${phoneConditions})`;
            } else {
              // Fall back to direct matching
              const cleanContact = contactFilter.replace(/'/g, "''").replace(/\D/g, "");
              whereClause += ` AND (h.id LIKE '%${cleanContact}%' OR h.id LIKE '%${contactFilter.replace(/'/g, "''")}%')`;
            }
          }

          const query = `SELECT m.text, m.is_from_me, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date, h.id as contact FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE ${whereClause} ORDER BY m.date DESC LIMIT ${limit};`;

          return new Promise((resolve) => {
            exec(`sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout) => {
              if (error) {
                resolve({ error: `Query failed: ${error.message}` });
                return;
              }
              try {
                const rows = stdout.trim() ? JSON.parse(stdout) : [];
                
                // Get unique contact identifiers and resolve names
                const contactIds = rows.filter(r => !r.is_from_me && r.contact).map(r => r.contact);
                const contactNames = await lookupContactNames(contactIds);
                
                const messages = rows.map(row => {
                  const contactName = row.contact ? contactNames.get(row.contact) : null;
                  return {
                    text: row.text || "(attachment)",
                    from: row.is_from_me ? "Me" : (contactName || row.contact || "Unknown"),
                    phone: row.is_from_me ? null : row.contact,
                    date: row.date,
                    direction: row.is_from_me ? "sent" : "received"
                  };
                });
                resolve({ messages, count: messages.length });
              } catch (e) {
                resolve({ error: "Failed to parse results: " + e.message });
              }
            });
          });
        }

        case "search_messages": {
          const searchQuery = toolInput.query.replace(/'/g, "''");
          const contactFilter = toolInput.contact || null;
          const limit = toolInput.limit || 20;

          let whereClause = `m.text LIKE '%${searchQuery}%'`;
          
          // Handle contact filter
          if (contactFilter) {
            let contactPhones = [];
            if (/[a-zA-Z]/.test(contactFilter)) {
              contactPhones = await findPhoneByName(contactFilter);
            }
            
            if (contactPhones.length > 0) {
              const phoneConditions = contactPhones.map(phone => {
                const digits = phone.replace(/\D/g, "");
                return `h.id LIKE '%${digits.slice(-10)}%'`;
              }).join(" OR ");
              whereClause += ` AND (${phoneConditions})`;
            } else {
              const cleanContact = contactFilter.replace(/'/g, "''").replace(/\D/g, "");
              whereClause += ` AND (h.id LIKE '%${cleanContact}%')`;
            }
          }

          const query = `SELECT m.text, m.is_from_me, datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as date, h.id as contact FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE ${whereClause} ORDER BY m.date DESC LIMIT ${limit};`;

          return new Promise((resolve) => {
            exec(`sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout) => {
              if (error) {
                resolve({ error: `Search failed: ${error.message}` });
                return;
              }
              try {
                const rows = stdout.trim() ? JSON.parse(stdout) : [];
                
                // Resolve contact names
                const contactIds = rows.filter(r => !r.is_from_me && r.contact).map(r => r.contact);
                const contactNames = await lookupContactNames(contactIds);
                
                const messages = rows.map(row => {
                  const contactName = row.contact ? contactNames.get(row.contact) : null;
                  return {
                    text: row.text,
                    from: row.is_from_me ? "Me" : (contactName || row.contact || "Unknown"),
                    phone: row.is_from_me ? null : row.contact,
                    date: row.date,
                    direction: row.is_from_me ? "sent" : "received"
                  };
                });
                resolve({ messages, count: messages.length, searchQuery: toolInput.query });
              } catch (e) {
                resolve({ error: "Failed to parse results: " + e.message });
              }
            });
          });
        }

        case "lookup_contact": {
          const { name } = toolInput;
          console.log(`[iMessage] lookup_contact called for: ${name}`);
          
          const contacts = await findContactsByName(name);
          
          if (contacts.length === 0) {
            return { 
              found: false, 
              message: `No contacts found matching "${name}"`,
              suggestion: "Try a different spelling or partial name"
            };
          }
          
          return {
            found: true,
            searchedFor: name,
            contacts: contacts.map(c => ({
              name: c.name,
              phones: c.phones
            })),
            hint: "Use the phone number to send a message with send_imessage"
          };
        }

        case "send_imessage": {
          let { recipient, message } = toolInput;
          const originalRecipient = recipient;
          
          console.log(`[iMessage] send_imessage called - recipient: ${recipient}, message: ${message}`);

          // If recipient looks like a name (has letters and no @ or +), try to find their phone number
          if (/[a-zA-Z]/.test(recipient) && !/[@+]/.test(recipient)) {
            console.log(`[iMessage] Recipient looks like a name, looking up contact...`);
            const contacts = await findContactsByName(recipient);
            
            if (contacts.length > 0 && contacts[0].phones.length > 0) {
              // Use the first phone number found (prefer mobile)
              const mobilePhone = contacts[0].phones.find(p => 
                p.label.toLowerCase().includes('mobile') || 
                p.label.toLowerCase().includes('iphone') ||
                p.label.toLowerCase().includes('cell')
              );
              recipient = mobilePhone ? mobilePhone.number : contacts[0].phones[0].number;
              console.log(`[iMessage] Resolved "${originalRecipient}" to ${recipient} (${contacts[0].name})`);
            } else {
              console.log(`[iMessage] Could not find phone number for "${recipient}"`);
              return { 
                error: `Could not find a phone number for "${recipient}". Please use lookup_contact first to find their number.`,
                suggestion: "Try using lookup_contact to find the correct contact and phone number"
              };
            }
          }

          // Clean up phone number - remove spaces, dashes, parentheses
          if (/^\+?\d/.test(recipient)) {
            recipient = recipient.replace(/[\s()-]/g, "");
          }

          return new Promise((resolve) => {
            const escapedMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const escapedRecipient = recipient.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

            // Try multiple approaches for sending
            const appleScript = `
              tell application "Messages"
                -- Try to find existing conversation first
                set targetBuddy to null
                try
                  set targetService to 1st service whose service type = iMessage
                  set targetBuddy to buddy "${escapedRecipient}" of targetService
                on error
                  -- Try SMS service if iMessage fails
                  try
                    set targetService to 1st service whose service type = SMS
                    set targetBuddy to buddy "${escapedRecipient}" of targetService
                  end try
                end try
                
                if targetBuddy is not null then
                  send "${escapedMessage}" to targetBuddy
                  return "sent"
                else
                  return "no buddy found"
                end if
              end tell
            `;

            exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, { timeout: 15000 }, async (error, stdout) => {
              if (error) {
                console.error(`[iMessage] Send failed: ${error.message}`);
                resolve({ error: `Failed to send message: ${error.message}` });
              } else if (stdout.trim() === "no buddy found") {
                resolve({ error: `Could not find a conversation with "${recipient}". They may not be in your Messages contacts.` });
              } else {
                console.log(`[iMessage] Message sent successfully to ${recipient}`);
                
                // Capture the chat_id for this conversation so we can track replies in THIS thread only
                const chatId = await getIMessageChatId(recipient);
                if (chatId) {
                  console.log(`[iMessage] Captured chat_id ${chatId} for conversation with ${recipient}`);
                }
                
                resolve({ 
                  success: true, 
                  message: `Message sent to ${originalRecipient}${originalRecipient !== recipient ? ` (${recipient})` : ""}`,
                  sentTo: recipient,
                  chatId: chatId  // Include chat_id for thread-specific reply tracking
                });
              }
            });
          });
        }

        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Full Task Executor (with access to all tools)
  // ─────────────────────────────────────────────────────────────────────────────

  setTaskExecutor(async (taskId) => {
    console.log(`[Tasks] Executing step for task: ${taskId}`);
    
    const task = await getTask(taskId, currentUser?.username);
    if (!task) {
      console.error(`[Tasks] Task ${taskId} not found`);
      return { error: "Task not found" };
    }

    // Skip if task is not in an executable state
    if (task.status !== "active" && task.status !== "waiting") {
      console.log(`[Tasks] Task ${taskId} is not in executable state: ${task.status}`);
      return { skipped: true, reason: `Task status is ${task.status}` };
    }

    // Get settings for API keys
    const settingsPath = await getSettingsPath(currentUser?.username);
    let apiKeys = {};
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      apiKeys = settings.apiKeys || {};
    } catch {
      console.error("[Tasks] No API keys configured");
      await updateTask(taskId, {
        status: "failed",
        logEntry: "No API keys configured"
      }, currentUser?.username);
      return { error: "No API keys configured" };
    }

    if (!apiKeys.anthropic) {
      await updateTask(taskId, {
        status: "failed",
        logEntry: "Anthropic API key required for task execution"
      }, currentUser?.username);
      return { error: "Anthropic API key required" };
    }

    // ────────────────────────────────────────────────────────────────────────────
    // WAIT_FOR_REPLY FOLLOW-UP MODE - When needs_followup is set
    // ────────────────────────────────────────────────────────────────────────────
    
    if (task.contextMemory?.needs_followup && task.contextMemory?.wait_for_reply_active) {
      console.log(`[Tasks] Handling wait_for_reply follow-up for task ${taskId}`);
      
      const ctx = task.contextMemory;
      const isTimeout = ctx.followup_is_timeout || false;
      const currentFollowupCount = ctx.followup_count || 0;
      
      try {
        // Generate the follow-up message using LLM
        const followupMessage = await generateFollowupMessage({
          originalRequest: ctx.original_request,
          previousReply: ctx.last_reply_content || "",
          reason: ctx.followup_reason || "No specific information provided",
          followupCount: currentFollowupCount,
          isTimeout: isTimeout
        }, apiKeys);
        
        console.log(`[Tasks] Generated follow-up message: "${followupMessage.substring(0, 100)}..."`);
        
        // Send the follow-up message
        const sendResult = await sendFollowupMessage({
          platform: ctx.waiting_via,
          contact: ctx.waiting_for_contact,
          message: followupMessage,
          conversationId: ctx.conversation_id,
          task: task
        }, currentUser?.username);
        
        if (sendResult.success) {
          console.log(`[Tasks] Follow-up sent successfully to ${ctx.waiting_for_contact}`);
          
          // Update task - clear needs_followup, update timing, increment counter
          const pollIntervalMs = (ctx.poll_interval_minutes || 5) * 60000;
          await updateTask(taskId, {
            status: "waiting",
            nextCheck: Date.now() + pollIntervalMs,
            contextMemory: {
              ...ctx,
              needs_followup: false,
              followup_is_timeout: false,
              followup_count: currentFollowupCount + 1,
              last_followup_time: new Date().toISOString(),
              last_followup_message: followupMessage
            },
            logEntry: `Sent follow-up #${currentFollowupCount + 1} to ${ctx.waiting_for_contact}: "${followupMessage.substring(0, 100)}..."`
          }, currentUser?.username);
          
          // Notify user
          if (mainWindow && !task.notificationsDisabled) {
            mainWindow.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `📨 **Task: ${task.title}**\n\nSent follow-up #${currentFollowupCount + 1} to ${ctx.waiting_for_contact} via ${ctx.waiting_via}:\n\n> ${followupMessage}\n\nContinuing to wait for reply...`,
              source: "task"
            });
          }
          
          return { success: true, action: "followup_sent", contact: ctx.waiting_for_contact };
        } else {
          console.error(`[Tasks] Failed to send follow-up: ${sendResult.error}`);
          
          await updateTask(taskId, {
            contextMemory: {
              ...ctx,
              needs_followup: false,
              followup_send_error: sendResult.error
            },
            logEntry: `Failed to send follow-up: ${sendResult.error}`
          }, currentUser?.username);
          
          return { error: sendResult.error };
        }
        
      } catch (err) {
        console.error(`[Tasks] Error handling follow-up: ${err.message}`);
        await updateTask(taskId, {
          contextMemory: {
            ...task.contextMemory,
            needs_followup: false,
            followup_error: err.message
          },
          logEntry: `Error handling follow-up: ${err.message}`
        }, currentUser?.username);
        return { error: err.message };
      }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // DIRECT EXECUTION MODE - When structured plan with tool calls is available
    // ────────────────────────────────────────────────────────────────────────────
    
    if (task.structuredPlan && task.structuredPlan.length > 0 && task.structuredPlan[0].tool) {
      console.log(`[Tasks] Using DIRECT EXECUTION mode for task ${taskId}`);
      console.log(`[Tasks] Structured plan has ${task.structuredPlan.length} steps`);
      
      // Use shared tool builder - ensures tasks have same tools as chat
      const { tools: directExecTools, executeTool: directExecExecuteTool } = await loadIntegrationsAndBuildTools({
        includeProfileTools: false,
        includeTaskTools: false,
        includeMemoryTools: false
      });
      
      const toolsByName = {};
      for (const t of directExecTools) {
        toolsByName[t.name] = t;
      }
      
      const results = {};
      let lastResult = null;
      let lastScreenshot = null;
      
      try {
        // Determine which step to resume from (skip already-completed steps)
        const resumeFromStep = task.currentStep?.step || 1;
        const isResuming = resumeFromStep > 1;
        if (isResuming) {
          console.log(`[Tasks] Resuming direct execution from step ${resumeFromStep}`);
        }
        
        // Execute each step in the structured plan
        for (const planStep of task.structuredPlan) {
          const { step_id, tool, args, output_var, description } = planStep;
          
          // Skip already-completed steps when resuming
          if (step_id < resumeFromStep) {
            console.log(`[Tasks] Skipping already-completed step ${step_id}`);
            continue;
          }
          
          console.log(`[Tasks] Direct exec step ${step_id}: [${tool}] ${description}`);
          
          // Log step to task
          await updateTask(taskId, {
            currentStep: { step: step_id, description, state: "executing" },
            logEntry: `Executing step ${step_id}: ${description}`
          }, currentUser?.username);
          
          // Skip internal control tools for tasks (they don't make sense in direct mode)
          if (tool === "complete_task" || tool === "goto_step" || tool === "update_task_state") {
            console.log(`[Tasks] Skipping control tool: ${tool}`);
            continue;
          }
          
          // Check if tool exists
          if (!toolsByName[tool]) {
            console.log(`[Tasks] Unknown tool: ${tool}, skipping step`);
            results[`step_${step_id}`] = { error: `Unknown tool: ${tool}` };
            continue;
          }
          
          // Substitute variables from previous results
          let resolvedArgs = { ...args };
          if (args) {
            const argsStr = JSON.stringify(args);
            const substituted = argsStr.replace(/\{\{step_(\d+)\.(\w+)\}\}/g, (match, stepNum, field) => {
              const prevResult = results[`step_${stepNum}`];
              if (prevResult && prevResult[field] !== undefined) {
                const value = prevResult[field];
                // Handle arrays and objects by stringifying them nicely
                if (Array.isArray(value)) {
                  // For message arrays, format them readably
                  if (value.length > 0 && typeof value[0] === 'object') {
                    return value.map(item => {
                      if (item.text && item.from && item.date) {
                        // Format message objects
                        return `[${item.date}] ${item.from}: ${item.text}`;
                      }
                      return JSON.stringify(item);
                    }).join('\\n');
                  }
                  return value.join(', ');
                } else if (typeof value === 'object' && value !== null) {
                  return JSON.stringify(value);
                }
                return String(value);
              }
              // Try common field name variations (messages vs recent_messages, etc.)
              // This handles LLM generating templates with slightly different field names
              const fieldVariations = {
                'recent_messages': 'messages',
                'imessages': 'messages',
                'slack_messages': 'messages',
                'email_messages': 'messages',
                'telegram_messages': 'messages',
                'discord_messages': 'messages',
                'text_messages': 'messages',
                'sms_messages': 'messages',
                'messages': 'recent_messages',
                'formatted_messages': 'formatted',
                'formatted': 'formatted_messages',
                'result': 'message',
                'message': 'result',
                'content': 'text',
                'text': 'content',
                'body': 'text',
                'data': 'result'
              };
              
              // Helper to format value for string substitution
              const formatValueForSubstitution = (value) => {
                if (Array.isArray(value)) {
                  if (value.length > 0 && typeof value[0] === 'object') {
                    return value.map(item => {
                      if (item.text && item.from && item.date) {
                        return `[${item.date}] ${item.from}: ${item.text}`;
                      }
                      return JSON.stringify(item);
                    }).join('\\n');
                  }
                  return value.join(', ');
                } else if (typeof value === 'object' && value !== null) {
                  return JSON.stringify(value);
                }
                return String(value);
              };
              
              // Try direct variation mapping first
              if (prevResult && fieldVariations[field] && prevResult[fieldVariations[field]] !== undefined) {
                const value = prevResult[fieldVariations[field]];
                console.log(`[Tasks] Using field variation: ${field} -> ${fieldVariations[field]}`);
                return formatValueForSubstitution(value);
              }
              
              // Fallback: if field ends with "_messages" or "messages", try just "messages"
              if (prevResult && (field.endsWith('_messages') || field.endsWith('messages')) && prevResult.messages !== undefined) {
                console.log(`[Tasks] Using fallback: ${field} -> messages`);
                return formatValueForSubstitution(prevResult.messages);
              }
              
              // Last resort: try the first array field in the result
              if (prevResult) {
                const arrayField = Object.entries(prevResult).find(([k, v]) => Array.isArray(v));
                if (arrayField) {
                  console.log(`[Tasks] Using first array field: ${field} -> ${arrayField[0]}`);
                  return formatValueForSubstitution(arrayField[1]);
                }
              }
              
              console.log(`[Tasks] Template variable not found: step_${stepNum}.${field}, available:`, prevResult ? Object.keys(prevResult) : 'no result');
              return match;
            });
            try {
              resolvedArgs = JSON.parse(substituted);
            } catch (e) {
              console.log(`[Tasks] Failed to parse substituted args: ${e.message}`);
              console.log(`[Tasks] Substituted string was: ${substituted.slice(0, 500)}`);
            }
          }
          
          console.log(`[Tasks] Direct exec tool ${tool} with args:`, JSON.stringify(resolvedArgs).slice(0, 200));
          
          // Execute the tool
          const taskContext = { 
            taskId, 
            autoSend: task.autoSend || false,
            contextMemory: task.contextMemory || {}
          };
          
          const toolResult = await directExecExecuteTool(tool, resolvedArgs, taskContext);
          
          // Store result
          if (output_var) {
            results[output_var] = toolResult;
          }
          results[`step_${step_id}`] = toolResult;
          lastResult = toolResult;
          
          // Capture screenshot if browser tool returned one
          if (toolResult && toolResult.screenshot) {
            lastScreenshot = toolResult.screenshot;
          }
          
          // Capture conversation_id from ANY messaging tool for later use by wait_for_reply
          // Each platform returns its own identifier: threadId (email), chatId (iMessage), channel (Slack), chat_id (Telegram), channel_id (Discord)
          const conversationIdFromResult = toolResult?.threadId || toolResult?.chatId || toolResult?.channel || toolResult?.chat_id || toolResult?.channel_id;
          const isMessagingTool = ["send_email", "send_imessage", "send_slack_message", "send_telegram_message", "send_discord_message"].includes(tool);
          
          // Debug logging for messaging tools
          if (isMessagingTool) {
            console.log(`[Tasks] DEBUG: ${tool} result:`, JSON.stringify(toolResult).slice(0, 300));
            console.log(`[Tasks] DEBUG: conversationIdFromResult = ${conversationIdFromResult}`);
          }
          
          if (toolResult && conversationIdFromResult && isMessagingTool) {
            console.log(`[Tasks] Captured conversation_id from ${tool}: ${conversationIdFromResult}`);
            task.contextMemory = {
              ...task.contextMemory,
              conversation_id: conversationIdFromResult,
              // Also store platform-specific fields for debugging
              [`last_${tool.replace('send_', '')}_conversation_id`]: conversationIdFromResult,
              last_message_id: toolResult.messageId || toolResult.message_id,
              // Store original subject for email threading (strip "Re: " prefix if present)
              ...(tool === 'send_email' && resolvedArgs?.subject ? { 
                original_subject: resolvedArgs.subject.replace(/^Re:\s*/i, '') 
              } : {})
            };
            // Persist to database immediately so it's available for wait_for_reply
            await updateTask(taskId, {
              contextMemory: task.contextMemory
            }, currentUser?.username);
          }
          
          // Handle special tool results
          if (toolResult && toolResult.pending) {
            console.log(`[Tasks] Message pending approval in task ${taskId}`);
            return { success: true, pendingMessage: true, message: toolResult.message };
          }
          
          if (toolResult && toolResult.action === "wait_for_user_input") {
            console.log(`[Tasks] Task ${taskId} waiting for user input: ${toolResult.question}`);
            await updateTask(taskId, {
              status: "waiting_for_input",
              contextMemory: {
                ...task.contextMemory,
                pendingClarification: toolResult.question,
                clarificationTimestamp: new Date().toISOString(),
                saveResponseAs: toolResult.save_response_as || null
              },
              logEntry: `Asked user: "${toolResult.question}" - waiting for response`
            }, currentUser?.username);
            return { success: true, waitingForInput: true, question: toolResult.question };
          }
          
          // Handle wait_for_reply action - sets up polling for message replies
          if (toolResult && toolResult.action === "wait_for_reply") {
            const pollIntervalMs = (toolResult.poll_interval_minutes || 5) * 60000;
            
            // Helper to check if a value is an unresolved template
            const isUnresolvedTemplate = (val) => 
              typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}');
            
            // Check if conversation_id is an unresolved template variable (e.g., "{{step_1.threadId}}")
            // If so, fall back to the captured value in contextMemory (also checking if THAT is valid)
            let effectiveConversationId = toolResult.conversation_id;
            
            if (!effectiveConversationId || isUnresolvedTemplate(effectiveConversationId)) {
              // Fall back to contextMemory, but ONLY if contextMemory value is also valid
              const ctxConvId = task.contextMemory?.conversation_id;
              if (ctxConvId && !isUnresolvedTemplate(ctxConvId)) {
                effectiveConversationId = ctxConvId;
                console.log(`[Tasks] conversation_id "${toolResult.conversation_id}" not valid, using captured value: ${effectiveConversationId}`);
              } else {
                // Both are invalid - use null (will match any message from contact)
                effectiveConversationId = null;
                console.log(`[Tasks] No valid conversation_id available (from tool: "${toolResult.conversation_id}", from context: "${ctxConvId}") - will match any message from contact`);
              }
            }
            
            console.log(`[Tasks] Task ${taskId} waiting for reply from ${toolResult.contact} via ${toolResult.platform}`);
            console.log(`[Tasks] Poll interval: ${pollIntervalMs}ms, Followup after: ${toolResult.followup_after_hours}h, Max: ${toolResult.max_followups}`);
            console.log(`[Tasks] Using conversation_id: ${effectiveConversationId || '(none - will match any email from contact)'}`);
            
            
            await updateTask(taskId, {
              status: "waiting",
              nextCheck: Date.now() + pollIntervalMs,
              currentStep: { 
                step: step_id, 
                description: `Waiting for reply from ${toolResult.contact}`,
                state: "waiting" 
              },
              contextMemory: {
                ...task.contextMemory,
                // Core wait_for_reply context
                wait_for_reply_active: true,
                waiting_via: toolResult.platform,
                waiting_for_contact: toolResult.contact,
                original_request: toolResult.original_request,
                success_criteria: toolResult.success_criteria,
                conversation_id: effectiveConversationId,
                // Timing
                first_message_time: task.contextMemory?.first_message_time || new Date().toISOString(),
                last_message_time: new Date().toISOString(),
                poll_interval_minutes: toolResult.poll_interval_minutes || 5,
                followup_after_hours: toolResult.followup_after_hours || 24,
                last_followup_time: null,
                // Follow-up tracking
                max_followups: toolResult.max_followups || 3,
                followup_count: task.contextMemory?.followup_count || 0,
                // Reply tracking
                new_reply_detected: false
              },
              logEntry: `Waiting for reply from ${toolResult.contact} via ${toolResult.platform} (poll: ${toolResult.poll_interval_minutes || 5}min, followup: ${toolResult.followup_after_hours || 24}h)`
            }, currentUser?.username);
            
            return { success: true, waitingForReply: true, contact: toolResult.contact, platform: toolResult.platform };
          }
          
          // Small delay between browser operations to let pages render
          if (tool.startsWith("browser_")) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // All steps completed - mark task as done
        console.log(`[Tasks] Direct execution completed for task ${taskId}`);
        
        await updateTask(taskId, {
          status: "completed",
          currentStep: { step: task.structuredPlan.length, state: "completed" },
          logEntry: `Task completed via direct execution (${task.structuredPlan.length} steps)`
        }, currentUser?.username);
        
        // Notify user
        if (win && !win.isDestroyed() && !task.notificationsDisabled) {
          addTaskUpdate(taskId, `✅ Task completed!`, {
            toChat: true,
            emoji: "✅",
            taskTitle: task.title
          });
        }
        
        return { success: true, completed: true, directExecution: true };
        
      } catch (err) {
        console.error(`[Tasks] Direct execution error for ${taskId}:`, err.message);
        await updateTask(taskId, {
          status: "failed",
          logEntry: `Direct execution failed: ${err.message}`
        }, currentUser?.username);
        return { error: err.message };
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────────
    // STANDARD LLM-BASED EXECUTION - Fallback when no structured plan
    // ────────────────────────────────────────────────────────────────────────────

    // Task state management tool (specific to task executor)
    const taskStateManagementTool = {
      name: "update_task_state",
      description: "Update the task state after completing actions. ALWAYS call this at the end of execution to report what happened and set the next state.",
      input_schema: {
        type: "object",
        properties: {
          logMessage: { type: "string", description: "What happened during this execution (be specific)" },
          nextStatus: { 
            type: "string", 
            enum: ["active", "waiting", "waiting_for_input", "completed", "failed"],
            description: "active=continue to next step now, waiting=wait for external event (set pollIntervalMs), waiting_for_input=need user clarification (ask in logMessage), completed=all done, failed=error" 
          },
          nextStep: { type: "number", description: "The next step number (current step + 1 if advancing)" },
          pollIntervalMs: { type: "number", description: "If waiting, milliseconds until next check. Use 3600000 for 1 hour, 86400000 for 1 day" },
          contextUpdates: { type: "object", description: "Key-value pairs to remember for future steps" },
          notifyUser: { type: "string", description: "Message to show the user in chat (optional)" },
          clarificationQuestion: { type: "string", description: "If waiting_for_input, the specific question to ask the user" },
          modifyPlan: { type: "array", items: { type: "string" }, description: "Optional: New steps to replace the remaining plan based on new information" }
        },
        required: ["logMessage", "nextStatus"]
      }
    };

    // Use shared tool builder - ensures tasks have same tools as chat
    const { tools: integrationTools, executeTool, googleAccessToken, slackAccessToken, weatherEnabled } = await loadIntegrationsAndBuildTools({
      includeProfileTools: false,  // Tasks don't need profile tools
      includeTaskTools: false,     // Tasks don't create other tasks
      includeMemoryTools: false    // Tasks don't need memory search
    });
    
    // Combine task-specific tool with integration tools
    const executorTools = [taskStateManagementTool, ...integrationTools];

    // Build system prompt with current date
    const now = new Date();
    const currentDateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    
    // Determine messaging channel for this task
    const taskMessagingChannel = task.messagingChannel || task.contextMemory?.messaging_channel;
    const channelTools = {
      imessage: "send_imessage (for text/SMS)",
      email: "send_email (for email/Gmail)",
      slack: "send_slack_message (for Slack)",
      telegram: "send_telegram_message (for Telegram)",
      discord: "send_discord_message (for Discord)",
      x: "post_tweet or send_x_dm (for X/Twitter)"
    };
    
    // Check for skill constraints
    const skillName = task.contextMemory?.skill_name;
    const skillConstraints = task.contextMemory?.skill_constraints;
    
    const systemPrompt = `You are an autonomous Task Executor Agent. You execute tasks step by step on behalf of the user.

CURRENT DATE/TIME: ${currentDateStr} at ${now.toLocaleTimeString()}
(Use this date for all scheduling - do NOT use dates from old context data)

TASK INFORMATION:
- Task ID: ${task.id}
- Title: ${task.title}
- Original Request: "${task.originalRequest}"
- Current Step: ${task.currentStep.step} of ${task.plan.length}
${taskMessagingChannel ? `\n*** MESSAGING CHANNEL: ${taskMessagingChannel.toUpperCase()} ***
YOU MUST USE: ${channelTools[taskMessagingChannel] || taskMessagingChannel}
DO NOT USE email if the channel is imessage. DO NOT USE imessage if the channel is email.` : ""}
${skillName ? `\n*** SKILL: ${skillName} ***
CONSTRAINTS YOU MUST FOLLOW:
${skillConstraints ? skillConstraints.split("; ").map(c => `- ${c}`).join("\n") : "None"}` : ""}

PLAN:
${task.plan.map((step, i) => `${i + 1}. ${step}${i + 1 === task.currentStep.step ? " ← CURRENT STEP" : ""}`).join("\n")}

SAVED CONTEXT:
${Object.entries(task.contextMemory).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "None yet"}

RECENT LOG:
${task.executionLog.slice(-3).map(e => `- ${e.message}`).join("\n") || "Task just started"}

INSTRUCTIONS:
1. Execute the CURRENT STEP using the available tools
2. ***MANDATORY*** After completing the step's action, you MUST call update_task_state with:
   - logMessage: A DETAILED summary of what you found/did. This is shown to the user!
   - nextStatus: "waiting" if waiting for a response, "active" to continue, "completed" if all done
   - nextStep: current step + 1 if advancing
   - pollIntervalMs: if waiting (e.g., 60000 = 1 minute)
   - contextUpdates: Save any important info for later steps

*** YOU MUST ALWAYS CALL update_task_state - DO NOT END WITHOUT IT ***

CRITICAL - User Notifications:
- The logMessage you provide in update_task_state is shown directly to the user in the chat
- ALWAYS write logMessage as if speaking to the user: "I sent an email to X asking about Y" or "I found the calendar link in Chris's message: [link]"
- Include relevant details, quotes from messages, or findings that the user would want to know
- If you have a question for the user or need their input, include it in the logMessage

CRITICAL - ANALYSIS STEPS (filtering, checking, analyzing):
- When analyzing emails/messages: Report what you found! "I reviewed 5 emails: 2 were spam (newsletter, promotion), 3 were legitimate (from Alice about project X, from Bob asking about Y, from Carol with meeting request)"
- When filtering: Explain your decisions! "Filtered out 3 spam emails. Kept 2 that need attention: Email from John about deadline, Email from Sarah requesting feedback"
- DO NOT just read content and move on - SUMMARIZE your findings for the user
- Save important findings in contextUpdates for later steps

3. CRITICAL - When SENDING a message and waiting for a reply:
   - Set contextUpdates.waiting_via = the messaging channel you used:
     * "email" if you used send_email
     * "imessage" if you used send_imessage
     * "slack" if you used send_slack_message
   - Set contextUpdates.waiting_for_contact = the contact identifier (email address, phone/name, or Slack user)
   - Set contextUpdates.last_message_time = current ISO date ("${new Date().toISOString()}")
   - Use pollIntervalMs: 60000 (1 minute) - all lightweight checks are free
   - Set nextStatus: "waiting" to wait for the reply

4. IMPORTANT - Use the MESSAGING CHANNEL specified above (if any):
   - If MESSAGING CHANNEL says IMESSAGE → use send_imessage (NEVER send_email or send_slack_message)
   - If MESSAGING CHANNEL says EMAIL → use send_email (NEVER send_imessage or send_slack_message)
   - If MESSAGING CHANNEL says SLACK → use send_slack_message (NEVER send_imessage or send_email)
   - If MESSAGING CHANNEL says TELEGRAM → use send_telegram_message
   - If MESSAGING CHANNEL says DISCORD → use send_discord_message
   - If MESSAGING CHANNEL says X → use send_x_dm for DMs or post_tweet for public tweets
   - Use the SAME channel throughout the entire task - NEVER switch channels
   - IGNORE any defaults - strictly follow the MESSAGING CHANNEL
   - CRITICAL: Even if you know the contact on another platform, DO NOT use it. Stay on the specified channel.

5. CRITICAL - REPLY DETECTED: If the SAVED CONTEXT shows "new_reply_detected: true":
   *** A REPLY HAS BEEN RECEIVED - YOU MUST PROCESS IT NOW ***
   - First, use list_emails or get_recent_messages to READ the new message content
   - Process the reply content to determine if it SATISFIES THE CURRENT STEP'S REQUIREMENTS
   - Clear the reply flag: contextUpdates.new_reply_detected = false
   - DECISION POINT:
     a) If the reply SATISFIES the step's requirement (e.g., definitive answer received):
        → Advance: nextStatus: "active", nextStep = current step + 1
     b) If the reply DOES NOT satisfy the requirement (e.g., unclear answer, needs follow-up):
        → STAY on current step: nextStep = current step (same number)
        → Take the appropriate action (send follow-up, ask for clarification)
        → Set nextStatus: "waiting" to wait for the next reply

6. CONDITIONAL STEP HANDLING:
   - Many steps have CONDITIONS that must be met before advancing (e.g., "wait for definitive answer", "until confirmed")
   - DO NOT advance just because you received a reply - evaluate if the CONDITION is satisfied
   - Example: Step "Follow up until definitive answer" → if answer is vague, send follow-up and STAY on this step
   - Example: Step "Wait for confirmation" → if response is "maybe", don't advance, ask for clear yes/no
   - Save evaluation reasoning in logMessage so user understands why you're staying or advancing

7. AUTO-PROGRESSION: After completing each step that doesn't require waiting:
   - ONLY advance to next step if the current step's requirement is FULLY SATISFIED
   - This ensures the task continues immediately without waiting for the scheduler
   - Only use nextStatus: "waiting" when you need to wait for an external response

7. TASK TYPE HANDLING:
   ${task.taskType === "continuous" || task.contextMemory?.task_type === "continuous" ? `
   *** THIS IS A CONTINUOUS/MONITORING TASK ***
   - Monitoring condition: ${task.contextMemory?.monitoring_condition || "Check context for details"}
   - Trigger action: ${task.contextMemory?.trigger_action || "Alert user when condition is met"}
   
   CONTINUOUS TASK RULES:
   - This task runs INDEFINITELY - it should NEVER be marked as "completed"
   - After completing the final step, LOOP BACK to step 1 by setting nextStep: 1
   - Use nextStatus: "waiting" with pollIntervalMs to wait before the next monitoring cycle
   - Recommended poll intervals: weather (3600000 = 1 hour), emails (60000 = 1 minute), prices (300000 = 5 min)
   - ONLY notify user when the monitoring condition is actually triggered (e.g., rain detected, email received)
   - Keep logMessage brief for routine checks: "Checked weather - no rain expected"
   ` : `
   *** THIS IS A DISCRETE TASK ***
   - Success criteria: ${task.contextMemory?.success_criteria || "Complete all steps in the plan"}
   
   DISCRETE TASK RULES:
   - This task has a clear end goal
   - EACH STEP may have its own success condition - evaluate before advancing
   - Common step conditions to watch for:
     * "until definitive answer" → stay on step until clear answer received
     * "follow up if not responded" → stay on step if no clear response
     * "confirm" → stay until explicit confirmation received
     * "if X then Y" → only advance after condition X is satisfied
   - Mark as "completed" ONLY when all steps are done AND success criteria is met
   - The final step should verify the success criteria before marking complete
   `}

8. CREDENTIAL SECURITY (CRITICAL):
   - NEVER include actual passwords or credentials in logMessage or any output
   - When using browser automation to log into websites, use secure placeholders:
     * Username: {{credential:domain.com:username}}
     * Password: {{credential:domain.com:password}}
   - The actual credentials are injected locally and NEVER pass through this task log
   - If login fails, inform user to check their credentials in the Credentials page
   - NEVER ask users for their password or store passwords in task context

9. MID-TASK CLARIFICATION:
   - If a step cannot be completed without user input, use nextStatus: "waiting_for_input"
   - Set clarificationQuestion to the SPECIFIC question you need answered
   - Examples: "Which Igor do you mean? I found: Igor Petrov (work), Igor Santos (personal)", "Which messaging platform should I use: iMessage, Slack, or email?"
   - The user will respond in chat, and the task will resume with their answer
   - After receiving user input, you may need to MODIFY the remaining plan using modifyPlan

10. DYNAMIC PLAN MODIFICATION:
   - If information learned during execution changes what needs to be done, use modifyPlan
   - modifyPlan replaces ALL remaining steps from the current step onwards
   - Example: If step 1 discovers the contact is only on Slack (not iMessage), update remaining steps accordingly
   - Include clear, actionable step descriptions just like the original plan

IMPORTANT: You MUST call update_task_state before finishing. Always advance to the next step after completing the current one.`;

    // Build user message - make it clear if a reply was received or user provided input
    const replyDetected = task.contextMemory?.new_reply_detected;
    const waitingVia = task.contextMemory?.waiting_via;
    const waitingFor = task.contextMemory?.waiting_for_contact;
    const userResponse = task.contextMemory?.userResponse;
    
    let userPrompt;
    
    // Case 1: User just responded to a clarification question
    if (userResponse) {
      userPrompt = `📝 USER PROVIDED INPUT IN RESPONSE TO YOUR QUESTION!

The user responded: "${userResponse}"

Your current step is ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"

ACTION REQUIRED:
1. Use the user's response to continue with the current step
2. If the response changes what needs to be done, use modifyPlan to update remaining steps
3. Execute the action(s) needed for this step using the new information
4. Call update_task_state with:
   - logMessage describing what you did with the user's input
   - contextUpdates.userResponse = null (clear the response after using it)
   - Set nextStatus and nextStep appropriately

IMPORTANT: The user took the time to respond, so make good use of their input!`;
    }
    // Case 2: External reply detected (email, slack, etc.)
    else if (replyDetected && waitingVia && waitingFor) {
      userPrompt = `🔔 A REPLY HAS BEEN RECEIVED from ${waitingFor} via ${waitingVia}!

Your current step is ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"

ACTION REQUIRED:
1. First, READ the reply using ${waitingVia === "email" ? "list_emails with from:" + waitingFor : waitingVia === "slack" ? "list_slack_messages" : "get_recent_messages"}
2. EVALUATE: Does this reply SATISFY the current step's requirements?
   - If step asks for "definitive answer" - is the answer clear and specific?
   - If step asks for "confirmation" - did they clearly confirm?
   - If step asks to "follow up until X" - has X been achieved?
3. Call update_task_state with:
   - logMessage describing what they replied AND your evaluation
   - IF reply SATISFIES step requirement:
     → nextStatus: "active", nextStep: ${task.currentStep.step + 1}
   - IF reply DOES NOT satisfy (vague, unclear, needs follow-up):
     → Send follow-up message
     → nextStatus: "waiting", nextStep: ${task.currentStep.step} (STAY on same step)
   - contextUpdates.new_reply_detected = false

IMPORTANT: Only advance if the step's condition is truly met. A reply alone doesn't mean success.`;
    } 
    // Case 3: Normal step execution
    else {
      userPrompt = `Execute step ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"\n\nDo the action required for this step, then call update_task_state with the results.`;
    }
    
    const messages = [
      { 
        role: "user", 
        content: userPrompt
      }
    ];

    try {
      let currentMessages = [...messages];
      
      // Agentic loop - up to 15 iterations (enough for complex multi-step actions)
      for (let iteration = 0; iteration < 15; iteration++) {
        console.log(`[Tasks] Executor iteration ${iteration + 1} for task ${taskId}`);
        
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: executorTools
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API error: ${errText}`);
        }

        const result = await response.json();
        
        // Check for tool use
        const toolUseBlocks = result.content.filter(b => b.type === "tool_use");
        
        // Log any text content (LLM reasoning) - this helps debug what the LLM is thinking
        const textContent = result.content.find(b => b.type === "text")?.text || "";
        if (textContent) {
          console.log(`[Tasks] LLM reasoning: ${textContent.slice(0, 300)}${textContent.length > 300 ? '...' : ''}`);
        }
        
        if (toolUseBlocks.length === 0) {
          // No tools called - check if we got a text response
          console.log(`[Tasks] No tools called, LLM response: ${textContent.slice(0, 200)}`);
          
          // If the LLM gave a meaningful response without calling update_task_state,
          // save it to the execution log so the user can see it
          if (textContent.length > 10) {
            await updateTask(taskId, {
              logEntry: `Analysis: ${textContent.slice(0, 500)}`
            }, currentUser?.username);
          }
          break;
        }

        // Process tool calls
        const toolResults = [];
        
        for (const toolUse of toolUseBlocks) {
          console.log(`[Tasks] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
          let toolResult;

          if (toolUse.name === "update_task_state") {
            // Apply state update
            const input = toolUse.input;
            const updates = {
              status: input.nextStatus,
              logEntry: input.logMessage
            };

            if (input.nextStep) {
              updates.currentStep = {
                step: input.nextStep,
                description: task.plan[input.nextStep - 1] || "",
                state: input.nextStatus,
                pollInterval: input.pollIntervalMs || null
              };
            }

            if (input.pollIntervalMs && input.nextStatus === "waiting") {
              updates.nextCheck = Date.now() + input.pollIntervalMs;
            }

            if (input.contextUpdates) {
              updates.contextMemory = { ...task.contextMemory, ...input.contextUpdates };
              
              // Check if the LLM drafted a message ready for approval
              // This happens when contextUpdates includes ready_for_user_approval: true and drafted_reply
              if (input.contextUpdates.ready_for_user_approval && input.contextUpdates.drafted_reply) {
                console.log(`[Tasks] LLM drafted a message ready for approval, creating pendingMessage`);
                
                // Determine the platform and recipient from context
                // IMPORTANT: Use task.messagingChannel as primary source (set at task creation)
                const platform = task.messagingChannel || input.contextUpdates.messaging_channel || task.contextMemory?.messaging_channel || 'imessage';
                const recipient = input.contextUpdates.actionable_message_from || task.contextMemory?.actionable_message_from || 'recipient';
                
                // Map platform to tool name
                const platformToTool = {
                  imessage: 'send_imessage',
                  email: 'send_email',
                  slack: 'send_slack_message',
                  telegram: 'send_telegram_message',
                  discord: 'send_discord_message',
                  x: 'send_x_dm'
                };
                
                // Create pending message entry
                const pendingMessage = {
                  id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  toolName: platformToTool[platform] || 'send_imessage',
                  platform: platform === 'imessage' ? 'iMessage' : platform.charAt(0).toUpperCase() + platform.slice(1),
                  recipient: recipient,
                  subject: '',
                  message: input.contextUpdates.drafted_reply,
                  created: new Date().toISOString(),
                  toolInput: JSON.stringify({
                    recipient: recipient,
                    message: input.contextUpdates.drafted_reply
                  })
                };
                
                // Initialize pendingMessages if needed
                if (!task.pendingMessages) {
                  task.pendingMessages = [];
                }
                
                // Add to pending messages
                task.pendingMessages.push(pendingMessage);
                updates.pendingMessages = task.pendingMessages;
                updates.status = "waiting_approval";
                
                // Clear the context flags so we don't create duplicate pending messages
                updates.contextMemory.ready_for_user_approval = false;
                updates.contextMemory.draft_pending_id = pendingMessage.id;
                
                console.log(`[Tasks] Created pending message: ${pendingMessage.id} for ${recipient} via ${platform}`);
                
                // Notify UI about the pending message
                if (win && !win.isDestroyed()) {
                  win.webContents.send('task:pendingMessage', {
                    taskId,
                    message: pendingMessage
                  });
                }
              }
            }

            // Handle plan modification if provided
            if (input.modifyPlan && Array.isArray(input.modifyPlan) && input.modifyPlan.length > 0) {
              // Keep steps before current step, replace the rest with new plan
              const currentStepIndex = task.currentStep.step - 1;
              const existingSteps = task.plan.slice(0, currentStepIndex);
              updates.plan = [...existingSteps, ...input.modifyPlan];
              console.log(`[Tasks] Plan modified: ${existingSteps.length} existing steps + ${input.modifyPlan.length} new steps`);
            }

            // Handle clarification question
            if (input.clarificationQuestion && input.nextStatus === "waiting_for_input") {
              updates.contextMemory = {
                ...(updates.contextMemory || task.contextMemory),
                pendingClarification: input.clarificationQuestion,
                clarificationTimestamp: new Date().toISOString()
              };
            }

            await updateTask(taskId, updates, currentUser?.username);

            // NOTIFICATIONS - Only alert on final states (completed, failed) unless disabled
            console.log(`[Tasks] Notification check: win=${!!win}, status=${input.nextStatus}, notificationsDisabled=${task.notificationsDisabled}`);
            
            // Check if notifications are disabled for this task
            if (win && !task.notificationsDisabled) {
              let notificationMessage = null;
              let notificationEmoji = "📋";
              
              // Only send chat notifications for FINAL states
              if (input.nextStatus === "completed") {
                notificationEmoji = "✅";
                notificationMessage = `Task completed!\n\n${input.logMessage}`;
              }
              else if (input.nextStatus === "failed") {
                notificationEmoji = "❌";
                notificationMessage = `Task failed: ${input.logMessage}`;
              }
              // Waiting for user input still needs notification (user action required)
              else if (input.nextStatus === "waiting_for_input") {
                notificationEmoji = "❓";
                const question = input.clarificationQuestion || "I need more information to continue.";
                notificationMessage = `${input.logMessage}\n\n**Question:** ${question}\n\nPlease reply in the chat to continue the task.`;
              }
              // Waiting for user approval still needs notification (user action required)
              else if (input.nextStatus === "waiting_approval" || updates.status === "waiting_approval") {
                notificationEmoji = "📨";
                const recipient = input.contextUpdates?.actionable_message_from || task.contextMemory?.actionable_message_from || "contact";
                notificationMessage = `${input.logMessage}\n\n**Action Required:** I've drafted a reply to ${recipient}. Please review and approve or edit the message in the Tasks panel.`;
              }
              
              // Send notification to chat only for important states
              if (notificationMessage) {
                console.log(`[Tasks] Notification message: ${notificationMessage.slice(0, 50)}...`);
                addTaskUpdate(taskId, notificationMessage);
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: `${notificationEmoji} **Task: ${task.title}**\n\n${notificationMessage}`,
                  source: "task"
                });
                console.log(`[Tasks] Notification SENT to chat`);
              } else {
                // Still log the update for the task panel, just don't send to chat
                if (input.logMessage) {
                  addTaskUpdate(taskId, input.logMessage);
                }
              }
            } else if (win && task.notificationsDisabled && input.logMessage) {
              // Notifications disabled but still add to task panel log
              addTaskUpdate(taskId, input.logMessage);
              console.log(`[Tasks] Notification SKIPPED - notifications disabled for task`);
            } else {
              console.log(`[Tasks] Notification SKIPPED - no window`);
            }

            console.log(`[Tasks] Task ${taskId} state updated: status=${input.nextStatus}, step=${input.nextStep || task.currentStep.step}`);
            toolResult = { success: true, message: "Task state updated" };
            
            // If status is "active", immediately continue to next step (don't wait for scheduler)
            if (input.nextStatus === "active" && input.nextStep && input.nextStep <= task.plan.length) {
              console.log(`[Tasks] Auto-continuing to step ${input.nextStep} for task ${taskId}`);
              // Schedule immediate continuation (use setTimeout to avoid deep recursion)
              setTimeout(() => executeTaskStep(taskId, currentUser?.username), 100);
            }
            
            // State was updated, we can exit the loop
            return { success: true, stateUpdate: input };
            
          } else {
            // Use shared tool executor for all other tools
            // Pass task context so message confirmations can be stored in the task
            const taskContext = { 
              taskId, 
              autoSend: task.autoSend || false,
              contextMemory: task.contextMemory || {}  // Include for name lookups in message previews
            };
            toolResult = await executeTool(toolUse.name, toolUse.input, taskContext);
            
            // Capture conversation_id from ANY messaging tool for later use by wait_for_reply
            const conversationIdFromResult = toolResult?.threadId || toolResult?.chatId || toolResult?.channel || toolResult?.chat_id || toolResult?.channel_id;
            const isMessagingTool = ["send_email", "send_imessage", "send_slack_message", "send_telegram_message", "send_discord_message"].includes(toolUse.name);
            
            if (toolResult && conversationIdFromResult && isMessagingTool) {
              console.log(`[Tasks] Captured conversation_id from ${toolUse.name}: ${conversationIdFromResult}`);
              task.contextMemory = {
                ...task.contextMemory,
                conversation_id: conversationIdFromResult,
                [`last_${toolUse.name.replace('send_', '')}_conversation_id`]: conversationIdFromResult,
                last_message_id: toolResult.messageId || toolResult.message_id,
                // Store original subject for email threading (strip "Re: " prefix if present)
                ...(toolUse.name === 'send_email' && toolUse.input?.subject ? { 
                  original_subject: toolUse.input.subject.replace(/^Re:\s*/i, '') 
                } : {})
              };
              await updateTask(taskId, {
                contextMemory: task.contextMemory
              }, currentUser?.username);
            }
            
            // If a message is pending approval, update task status and return
            if (toolResult && toolResult.pending) {
              console.log(`[Tasks] Message pending approval in task ${taskId}`);
              return { success: true, pendingMessage: true, message: toolResult.message };
            }
            
            // Handle special actions from task primitive tools
            if (toolResult && toolResult.action === "wait_for_user_input") {
              // Tool asked a question and wants to wait for user response
              console.log(`[Tasks] Task ${taskId} waiting for user input: ${toolResult.question}`);
              
              await updateTask(taskId, {
                status: "waiting_for_input",
                contextMemory: {
                  ...task.contextMemory,
                  pendingClarification: toolResult.question,
                  clarificationTimestamp: new Date().toISOString(),
                  saveResponseAs: toolResult.save_response_as || null
                },
                logEntry: `Asked user: "${toolResult.question}" - waiting for response`
              }, currentUser?.username);
              
              return { success: true, waitingForInput: true, question: toolResult.question };
            }
            
            // Handle wait_for_reply action - sets up polling for message replies
            if (toolResult && toolResult.action === "wait_for_reply") {
              const pollIntervalMs = (toolResult.poll_interval_minutes || 5) * 60000;
              
              // Helper to check if a value is an unresolved template
              const isUnresolvedTemplate = (val) => 
                typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}');
              
              // Check if conversation_id is an unresolved template variable (e.g., "{{step_1.threadId}}")
              // If so, fall back to the captured value in contextMemory (also checking if THAT is valid)
              let effectiveConversationId = toolResult.conversation_id;
              
              if (!effectiveConversationId || isUnresolvedTemplate(effectiveConversationId)) {
                // Fall back to contextMemory, but ONLY if contextMemory value is also valid
                const ctxConvId = task.contextMemory?.conversation_id;
                if (ctxConvId && !isUnresolvedTemplate(ctxConvId)) {
                  effectiveConversationId = ctxConvId;
                  console.log(`[Tasks] conversation_id "${toolResult.conversation_id}" not valid, using captured value: ${effectiveConversationId}`);
                } else {
                  // Both are invalid - use null (will match any message from contact)
                  effectiveConversationId = null;
                  console.log(`[Tasks] No valid conversation_id available (from tool: "${toolResult.conversation_id}", from context: "${ctxConvId}") - will match any message from contact`);
                }
              }
              
              console.log(`[Tasks] Task ${taskId} waiting for reply from ${toolResult.contact} via ${toolResult.platform}`);
              console.log(`[Tasks] Poll interval: ${pollIntervalMs}ms, Followup after: ${toolResult.followup_after_hours}h, Max: ${toolResult.max_followups}`);
              console.log(`[Tasks] Using conversation_id: ${effectiveConversationId || '(none - will match any email from contact)'}`);
              
              await updateTask(taskId, {
                status: "waiting",
                nextCheck: Date.now() + pollIntervalMs,
                currentStep: { 
                  step: task.currentStep.step, 
                  description: `Waiting for reply from ${toolResult.contact}`,
                  state: "waiting" 
                },
                contextMemory: {
                  ...task.contextMemory,
                  wait_for_reply_active: true,
                  waiting_via: toolResult.platform,
                  waiting_for_contact: toolResult.contact,
                  original_request: toolResult.original_request,
                  success_criteria: toolResult.success_criteria,
                  conversation_id: effectiveConversationId,
                  first_message_time: task.contextMemory?.first_message_time || new Date().toISOString(),
                  last_message_time: new Date().toISOString(),
                  poll_interval_minutes: toolResult.poll_interval_minutes || 5,
                  followup_after_hours: toolResult.followup_after_hours || 24,
                  last_followup_time: null,
                  max_followups: toolResult.max_followups || 3,
                  followup_count: task.contextMemory?.followup_count || 0,
                  new_reply_detected: false
                },
                logEntry: `Waiting for reply from ${toolResult.contact} via ${toolResult.platform}`
              }, currentUser?.username);
              
              return { success: true, waitingForReply: true, contact: toolResult.contact, platform: toolResult.platform };
            }
            
            // Handle save_variable action - update task context memory
            if (toolResult && toolResult.action === "save_variable") {
              console.log(`[Tasks] Saving variable ${toolResult.name} = ${toolResult.value}`);
              await updateTask(taskId, {
                contextMemory: {
                  ...task.contextMemory,
                  [toolResult.name]: toolResult.value
                }
              }, currentUser?.username);
              // Refresh task for next iteration
              task = await getTask(taskId, currentUser?.username);
            }
            
            // Handle complete_task action
            if (toolResult && toolResult.action === "complete_task") {
              console.log(`[Tasks] Task ${taskId} completed: ${toolResult.summary}`);
              await updateTask(taskId, {
                status: "completed",
                currentStep: { ...task.currentStep, state: "completed" },
                logEntry: `Task completed: ${toolResult.summary}`
              }, currentUser?.username);
              
              // Notify user
              if (win && !win.isDestroyed()) {
                addTaskUpdate(taskId, `✅ ${toolResult.summary}`, {
                  toChat: true,
                  emoji: "✅",
                  taskTitle: task.title
                });
              }
              
              return { success: true, completed: true, summary: toolResult.summary };
            }
            
            // Handle goto_step action
            if (toolResult && toolResult.action === "goto_step") {
              console.log(`[Tasks] Task ${taskId} jumping to step ${toolResult.step_number}`);
              await updateTask(taskId, {
                currentStep: { step: toolResult.step_number, state: "executing" },
                logEntry: `Jumped to step ${toolResult.step_number}${toolResult.reason ? `: ${toolResult.reason}` : ''}`
              }, currentUser?.username);
              // Continue execution at new step
              setTimeout(() => executeTaskStep(taskId, currentUser?.username), 100);
              return { success: true, jumpedToStep: toolResult.step_number };
            }
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult)
          });
        }

        // Continue the conversation with tool results
        currentMessages.push({ role: "assistant", content: result.content });
        currentMessages.push({ role: "user", content: toolResults });
      }

      // If we exited without updating state, the LLM completed the step but forgot to call update_task_state
      // Auto-advance to the next step to keep the task moving
      console.log(`[Tasks] LLM completed without calling update_task_state - auto-advancing task ${taskId}`);
      
      const currentStep = task.currentStep.step;
      const nextStep = currentStep + 1;
      
      if (nextStep <= task.plan.length) {
        // Advance to next step
        await updateTask(taskId, {
          currentStep: { step: nextStep, state: "executing" },
          status: "active",
          logEntry: `Step ${currentStep} completed (auto-advanced). Moving to step ${nextStep}: ${task.plan[nextStep - 1]}`
        }, currentUser?.username);
        
        console.log(`[Tasks] Auto-advanced from step ${currentStep} to step ${nextStep}`);
        
        // Log update to task panel (no chat notification for step progress)
        if (win && !win.isDestroyed()) {
          const notificationMessage = `Step ${currentStep} completed. Moving to step ${nextStep}: ${task.plan[nextStep - 1]}`;
          addTaskUpdate(taskId, notificationMessage);
        }
        
        // Continue to next step after a short delay
        setTimeout(() => executeTaskStep(taskId, currentUser?.username), 500);
        return { success: true, autoAdvanced: true };
      } else {
        // This was the last step - mark task as completed
        await updateTask(taskId, {
          status: "completed",
          currentStep: { ...task.currentStep, state: "completed" },
          logEntry: `Task completed (all ${task.plan.length} steps finished)`
        }, currentUser?.username);
        
        console.log(`[Tasks] Task ${taskId} completed (auto-completed after last step)`);
        
        // Notify user of completion
        if (win && !win.isDestroyed()) {
          addTaskUpdate(taskId, `Task completed! All ${task.plan.length} steps finished.`, {
            toChat: true,
            emoji: "✅",
            taskTitle: task.title
          });
        }
        
        return { success: true, completed: true };
      }

    } catch (err) {
      console.error(`[Tasks] Execution error for ${taskId}:`, err.message);
      await updateTask(taskId, {
        status: "failed",
        logEntry: `Execution failed: ${err.message}`
      }, currentUser?.username);
      return { error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Decomposition System - For Complex Multi-Step Queries
  // ─────────────────────────────────────────────────────────────────────────────

  // Fast models for classification (cheaper/faster)
  const CLASSIFIER_MODELS = {
    anthropic: "claude-3-5-haiku-20241022",
    openai: "gpt-4o-mini",
    google: "gemini-1.5-flash"
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Skill Generation - Create skills from natural language descriptions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a skill from a natural language description
   * @param {string} userRequest - User's request describing the skill
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} Skill object with name, description, keywords, procedure, constraints
   */
  async function generateSkillFromDescription(userRequest, apiKeys, activeProvider) {
    const prompt = `You are helping create a skill (a reusable procedure) for an AI assistant called Wovly.

USER REQUEST:
"${userRequest}"

Based on this request, generate a skill with the following structure. Be specific and actionable.

A skill provides:
1. Domain knowledge to guide the AI when decomposing tasks (procedure)
2. Constraints the AI must follow when executing the task

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "name": "Short descriptive name (e.g., 'Email Thread Monitoring', 'Daily Standup Reminder')",
  "description": "2-3 sentence description of what this skill does and when it should be triggered",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],
  "procedure": [
    "Step 1: Specific action to take",
    "Step 2: Another specific action",
    "Step 3: Continue with the workflow",
    "Step 4: Handle outcomes/responses",
    "Step 5: Complete or repeat as needed"
  ],
  "constraints": [
    "Important rule or limitation",
    "Another constraint to follow"
  ]
}`;

    try {
      let response;
      
      if (activeProvider === "anthropic" && apiKeys.anthropic) {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
          })
        });
        
        if (!response.ok) {
          throw new Error(`Anthropic API error: ${await response.text()}`);
        }
        
        const data = await response.json();
        const text = data.content[0]?.text || "";
        return JSON.parse(text);
        
      } else if (apiKeys.openai) {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        
        if (!response.ok) {
          throw new Error(`OpenAI API error: ${await response.text()}`);
        }
        
        const data = await response.json();
        const text = data.choices[0]?.message?.content || "";
        return JSON.parse(text);
        
      } else if (apiKeys.google) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeys.google}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        
        if (!response.ok) {
          throw new Error(`Google API error: ${await response.text()}`);
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return JSON.parse(text);
        
      } else {
        return { error: "No API key available for skill generation" };
      }
    } catch (err) {
      console.error("[Skills] Error generating skill:", err.message);
      return { error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Input Type Detection - Classify input as query/command/information
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Detects if user input is a query, command, or informational statement
   * @param {string} input - User's message
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} { type: "query"|"command"|"information", confidence: number, reason: string }
   */
  async function detectInputType(input, apiKeys, activeProvider) {
    const prompt = `Classify this user input into one of three types:
"${input}"

Types:
- "query": User is asking a question or requesting information (e.g., "What's the weather?", "What's on my calendar?")
- "command": User wants to perform an action or task (e.g., "Send email to John", "Schedule a meeting", "Find flights to London")
- "information": User is sharing personal facts, relationships, or context they want remembered for future conversations

Examples of "information" (statements of fact to remember):
- "Igor is my contractor working on the house" → contact/relationship info
- "Connie is my mother. Daddee is my father" → family relationships
- "Curly is the name of my children's school" → place info
- "My wife's birthday is March 15" → date/personal info
- "Brightwheel is the app for my daughter's daycare" → context info
- "I'm allergic to peanuts" → preference/health info
- "The house renovation is currently on hold due to permits" → situation update

Key indicators of "information":
- Declarative statements (not questions)
- Defines relationships ("X is my...")
- Shares personal facts, dates, preferences
- Provides context about people, places, or situations
- Does NOT ask for action or information

Respond with ONLY JSON (no markdown):
{
  "type": "query" | "command" | "information",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

    try {
      if (apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.anthropic,
            max_tokens: 256,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[InputType] Classified as: ${result.type} (confidence: ${result.confidence})`);
            return result;
          }
        }
      }

      if (apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.openai,
            max_tokens: 256,
            messages: [
              { role: "system", content: "You classify user input. Respond with only JSON." },
              { role: "user", content: prompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[InputType] Classified as: ${result.type} (confidence: ${result.confidence})`);
            return result;
          }
        }
      }

      // Default to command if classification fails
      return { type: "command", confidence: 0.5, reason: "Classification failed, defaulting to command" };
    } catch (err) {
      console.error("[InputType] Error:", err.message);
      return { type: "command", confidence: 0.5, reason: "Error during classification" };
    }
  }

  /**
   * Extracts structured facts from an informational statement
   * @param {string} input - User's informational statement
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} { facts: [{ category, summary, entities, subject }] }
   */
  async function extractFacts(input, apiKeys, activeProvider) {
    const prompt = `Extract facts from this statement to save to a user profile:
"${input}"

Categories:
- contact_info: Info about a person (name, role, relationship to user)
- place_info: Info about locations, schools, workplaces, businesses
- date_info: Birthdays, anniversaries, important dates
- preference_info: Likes, dislikes, allergies, preferences
- context_info: Project status, ongoing situations, current events in user's life

For each fact, provide:
- category: One of the above
- summary: A clear one-line note suitable for a profile (e.g., "Igor is my contractor working on house renovation")
- entities: Key entities extracted (name, relationship, date, etc.)
- subject: The main subject this fact is about (for conflict detection)

Respond with ONLY JSON (no markdown):
{
  "facts": [
    {
      "category": "contact_info",
      "summary": "Igor is my contractor working on the house renovation",
      "entities": { "name": "Igor", "role": "contractor", "project": "house renovation" },
      "subject": "Igor"
    }
  ]
}`;

    try {
      if (apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.anthropic,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[ExtractFacts] Extracted ${result.facts?.length || 0} facts`);
            return result;
          }
        }
      }

      if (apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.openai,
            max_tokens: 1024,
            messages: [
              { role: "system", content: "You extract facts from statements. Respond with only JSON." },
              { role: "user", content: prompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[ExtractFacts] Extracted ${result.facts?.length || 0} facts`);
            return result;
          }
        }
      }

      return { facts: [] };
    } catch (err) {
      console.error("[ExtractFacts] Error:", err.message);
      return { facts: [] };
    }
  }

  /**
   * Detects conflicts between new facts and existing profile notes
   * @param {Array} newFacts - Array of new facts to save
   * @param {Array} existingNotes - Array of existing profile notes
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} { conflicts: [...], nonConflictingFactIndexes: [...] }
   */
  async function detectFactConflicts(newFacts, existingNotes, apiKeys, activeProvider) {
    if (!existingNotes || existingNotes.length === 0) {
      return { 
        conflicts: [], 
        nonConflictingFactIndexes: newFacts.map((_, i) => i) 
      };
    }

    if (!newFacts || newFacts.length === 0) {
      return { conflicts: [], nonConflictingFactIndexes: [] };
    }

    const prompt = `Compare these NEW facts against EXISTING profile notes and identify conflicts.

NEW FACTS:
${newFacts.map((f, i) => `${i + 1}. ${f.summary}`).join('\n')}

EXISTING PROFILE NOTES:
${existingNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

A CONFLICT exists when:
- Same subject (person, place, thing) has CONTRADICTORY information
- Example CONFLICT: "Wife's birthday is March 3rd" vs "Wife's birthday is April 10th" (different dates for same event)
- Example CONFLICT: "Igor is my contractor" vs "Igor is my neighbor" (different relationships)
- Example CONFLICT: "Connie is my mother" vs "Connie is my aunt" (different relationships)

NOT a conflict (complementary info):
- "Igor is my contractor" and "Igor is working on the house renovation" (adds detail, doesn't contradict)
- "Wife's birthday is March 3rd" and "Wife's name is Sarah" (different attributes)

Respond with ONLY JSON (no markdown):
{
  "conflicts": [
    {
      "newFactIndex": 0,
      "existingNoteIndex": 2,
      "newFact": "the new fact text",
      "existingNote": "the existing note text",
      "subject": "what/who the conflict is about",
      "conflictDescription": "You previously said X, but now you're saying Y. Which is correct?"
    }
  ],
  "nonConflictingFactIndexes": [1, 3]
}

If no conflicts found, return empty conflicts array and all fact indexes in nonConflictingFactIndexes.`;

    try {
      if (apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.anthropic,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[ConflictDetect] Found ${result.conflicts?.length || 0} conflicts`);
            return result;
          }
        }
      }

      if (apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.openai,
            max_tokens: 1024,
            messages: [
              { role: "system", content: "You detect conflicts in user profile information. Respond with only JSON." },
              { role: "user", content: prompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[ConflictDetect] Found ${result.conflicts?.length || 0} conflicts`);
            return result;
          }
        }
      }

      // Default: no conflicts
      return { 
        conflicts: [], 
        nonConflictingFactIndexes: newFacts.map((_, i) => i) 
      };
    } catch (err) {
      console.error("[ConflictDetect] Error:", err.message);
      return { 
        conflicts: [], 
        nonConflictingFactIndexes: newFacts.map((_, i) => i) 
      };
    }
  }

  /**
   * Intelligent Query Understanding - Pre-decomposition phase
   * Extracts entities, resolves ambiguities using context, and enriches the query
   * 
   * @param {string} query - The raw user query
   * @param {Object} context - Context for understanding
   * @param {Object} context.profile - User profile (city, name, preferences)
   * @param {Object} context.conversationContext - Recent conversation history
   * @param {Array} context.calendarEvents - Today's calendar events
   * @param {Date} context.currentDate - Current date/time
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} Understanding result with enriched query and extracted entities
   */
  async function understandQuery(query, context, apiKeys, activeProvider) {
    const { profile, conversationContext, calendarEvents, currentDate, sessionMessages } = context;
    
    // Get available credentials for security context
    const availableCredentials = await getAvailableCredentialDomains();
    
    // Format current date for the prompt
    const dateStr = currentDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    // Format calendar events for context
    let calendarStr = "No events today";
    if (calendarEvents && calendarEvents.length > 0) {
      calendarStr = calendarEvents.map(e => {
        const startTime = e.start ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'All day';
        return `- ${startTime}: ${e.title}${e.location ? ` at ${e.location}` : ''}`;
      }).join("\n");
    }
    
    // Format profile notes/preferences
    let preferencesStr = "";
    if (profile?.notes && profile.notes.length > 0) {
      preferencesStr = profile.notes.map(n => `- ${n}`).join("\n");
    }
    
    // Format immediate context from current session (last 2-3 exchanges)
    // This is critical for resolving follow-up questions and references like "those", "that", etc.
    let immediateContext = "";
    if (sessionMessages && sessionMessages.length > 0) {
      // Get the last 6 messages (up to 3 user-assistant pairs) excluding the current query
      const previousMessages = sessionMessages.slice(-7, -1); // Exclude the current message
      if (previousMessages.length > 0) {
        immediateContext = previousMessages.map(m => {
          const role = m.role === 'assistant' ? 'Assistant' : 'User';
          // Truncate very long messages but keep enough context
          const content = m.content.length > 1500 ? m.content.slice(0, 1500) + '...[truncated]' : m.content;
          return `${role}: ${content}`;
        }).join("\n\n");
      }
    }
    
    // Format recent conversation for additional context (from memory files)
    let recentConversation = "";
    if (conversationContext?.todayMessages) {
      // Get last 500 chars of today's messages for context
      const messages = conversationContext.todayMessages;
      recentConversation = messages.length > 500 ? messages.slice(-500) : messages;
    }

    const understandingPrompt = `You are a query understanding system. Your job is to extract entities, resolve ambiguities, and enrich the user's query using available context.

## CRITICAL SECURITY RULES - READ FIRST
**NEVER ask for login credentials, passwords, usernames, or API keys.** This is a major security violation.
- If a website/service needs login, check if credentials exist (listed below)
- If credentials exist for the domain → proceed without asking
- If credentials DON'T exist → the enriched query should note the user needs to add credentials in the Credentials page
- ABSOLUTELY NO clarification questions about passwords, usernames, or login details

## Saved Credentials Available
${availableCredentials.length > 0 ? `The user has saved credentials for: ${availableCredentials.join(', ')}` : 'No saved credentials'}
If the query involves logging into one of these sites, proceed - credentials are available.

## Current Context
Today is ${dateStr}.
Current time: ${currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.

## User Profile
- Name: ${profile?.firstName || 'Unknown'} ${profile?.lastName || ''}
- Location/City: ${profile?.city || 'Unknown'}
- Occupation: ${profile?.occupation || 'Unknown'}
${preferencesStr ? `\nUser Preferences/Notes:\n${preferencesStr}` : ''}

## Today's Calendar
${calendarStr}

## Immediate Conversation Context (MOST IMPORTANT FOR FOLLOW-UPS)
${immediateContext || 'This is the first message in this conversation'}

**CRITICAL: Use this context to resolve ANY references in the user's query:**
- "those messages" / "these messages" → messages the assistant just mentioned
- "that" / "those" / "these" / "it" → items/entities from assistant's last response
- "the dates" / "the times" → dates/times of items just discussed
- "him" / "her" / "them" → people mentioned in recent exchange
- "that person" / "the person" → the person just mentioned

## Earlier Conversation (for additional context)
${recentConversation || 'No earlier messages'}

## User Query
"${query}"

## Your Task
Analyze the query and extract/resolve the following:

1. **DATES**: Any date/time references
   - Relative dates ("Monday", "tomorrow", "next week") → exact dates
   - Relative times ("after my meeting", "in 2 hours") → exact times
   - Calculate based on today being ${dateStr}

2. **LOCATIONS**: Any location references
   - If travel query and no origin specified → use user's city as default origin
   - Resolve vague references ("home", "work", "there")
   - Include airport codes when relevant for travel

3. **PEOPLE**: Any person references
   - Resolve pronouns ("him", "her", "them") using conversation context
   - Identify names mentioned

4. **QUANTITIES**: Numbers and amounts
   - Number of travelers (default to 1 if not specified for travel)
   - Number of items, tickets, etc.

5. **MISSING PARAMETERS**: What's needed but not provided
   - For travel: return date (suggest default if one-way not explicit)
   - For meetings: duration, attendees
   - For messages: recipients

6. **REFERENCES** (CRITICAL for follow-up questions):
   - "those", "these", "that", "it", "the [noun]" → resolve to specific entities from immediate conversation
   - "those messages" → identify which specific messages were just discussed by the assistant
   - "that person" / "him" / "her" → identify who was just mentioned
   - "the dates" / "the times" → dates/times of items the assistant just mentioned
   - If the assistant just mentioned specific items/messages/people/data, assume demonstrative references point to those
   - This is the MOST IMPORTANT resolution for follow-up questions

7. **ENRICHED QUERY**: Rewrite the query with all ambiguities resolved, especially references

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "original_query": "the original query",
  "enriched_query": "fully resolved query with specific dates, locations, references resolved, etc.",
  "entities": {
    "dates": [
      { "raw": "original text", "resolved": "YYYY-MM-DD", "type": "departure|return|meeting|deadline", "reasoning": "how you resolved it" }
    ],
    "times": [
      { "raw": "original text", "resolved": "HH:MM", "type": "start|end", "reasoning": "how you resolved it" }
    ],
    "locations": {
      "origin": { "raw": "original or null", "resolved": "city name", "code": "airport code if travel", "source": "query|profile|context" },
      "destination": { "raw": "original", "resolved": "city name", "code": "airport code if travel" }
    },
    "people": [
      { "raw": "original reference", "resolved": "full name", "source": "query|context" }
    ],
    "quantities": [
      { "type": "travelers|items|etc", "value": number, "inferred": true/false }
    ],
    "references": [
      { "raw": "those messages", "resolved": "the 3 messages from Igor about house access", "type": "messages|items|data", "source": "immediate_context" }
    ]
  },
  "ambiguities_resolved": [
    { "type": "date|location|person|quantity|reference", "raw": "original", "resolved": "resolved value", "reasoning": "explanation" }
  ],
  "missing_parameters": [
    { "param": "parameter name", "handling": "default_value|ask_user", "suggested_value": "value if defaulting", "question": "question if asking user" }
  ],
  "context_applied": [
    "description of context used"
  ],
  "clarification_needed": false,
  "clarification_questions": []
}

IMPORTANT RULES:

## ACTION-FIRST PRINCIPLE (CRITICAL)
- DEFAULT TO ACTION, NOT CLARIFICATION. If you can make a reasonable assumption, MAKE IT and proceed.
- Only set clarification_needed=true when execution is IMPOSSIBLE without user input.
- NEVER ask generic questions like "what specific details are you looking for?" - be specific or don't ask at all.

## SECURITY: FORBIDDEN CLARIFICATION QUESTIONS
NEVER, UNDER ANY CIRCUMSTANCES, ask for:
- Passwords or login credentials
- Usernames or email addresses for login
- API keys or tokens
- Any authentication information
If login is needed: check Saved Credentials above. If credentials exist, proceed. If not, mention the Credentials page.

## When to NOT ask for clarification:
- **Login/credential requests** → NEVER ask, use saved credentials or mention Credentials page
- Message retrieval queries (e.g., "messages from Igor") → proceed with available platforms
- Contact lookups → just look up the contact
- Calendar queries → just fetch the calendar
- Search queries → just search
- Any query where you can take meaningful action → TAKE ACTION

## When clarification IS appropriate (rare):
- Multiple people with same name AND it affects results significantly
- Travel queries where origin is truly unknown AND not inferable from profile
- Ambiguous time references that could mean very different things

## Specific Query Type Guidance:
- "messages from [person]" → enrich to: "Retrieve latest messages from [person] across available messaging platforms (iMessage, Slack, WhatsApp)"
- "what did [person] say about X" → enrich to: "Search messages from [person] for content about X"
- "[person]'s contact" → enrich to: "Look up contact information for [person]"

## Reference Resolution:
- FOLLOW-UP QUESTIONS: If the query uses "those", "these", "that", "it", ALWAYS check the Immediate Conversation Context to resolve the reference. Do NOT ask for clarification.
- Example: If assistant just listed "3 messages from Igor about house access" and user asks "what were the dates of those messages?", resolve to "What are the dates of the 3 messages from Igor about house access that were just discussed?"

## Other Rules:
- For travel queries without return date, default to round-trip with 1-week return unless "one-way" is mentioned
- Always resolve relative dates to exact dates based on today's date
- Be specific in the enriched_query - include dates, times, and all resolved entities`;

    try {
      // Use Anthropic if available (preferred)
      if (apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.anthropic,
            max_tokens: 2048,
            messages: [{ role: "user", content: understandingPrompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[QueryUnderstanding] Enriched query: "${result.enriched_query}"`);
            console.log(`[QueryUnderstanding] Entities:`, JSON.stringify(result.entities, null, 2));
            console.log(`[QueryUnderstanding] Context applied:`, result.context_applied);
            if (result.clarification_needed) {
              console.log(`[QueryUnderstanding] Clarification needed:`, result.clarification_questions);
            }
            return result;
          }
        }
      }
      
      // Fallback to OpenAI
      if (apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.openai,
            max_tokens: 2048,
            messages: [
              { role: "system", content: "You are a query understanding assistant. Respond with only JSON." },
              { role: "user", content: understandingPrompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[QueryUnderstanding] Enriched query: "${result.enriched_query}"`);
            return result;
          }
        }
      }

      // Default passthrough if understanding fails
      console.log("[QueryUnderstanding] Understanding failed, using original query");
      return {
        original_query: query,
        enriched_query: query,
        entities: { dates: [], times: [], locations: {}, people: [], quantities: [] },
        ambiguities_resolved: [],
        missing_parameters: [],
        context_applied: [],
        clarification_needed: false,
        clarification_questions: []
      };

    } catch (err) {
      console.error("[QueryUnderstanding] Error:", err.message);
      return {
        original_query: query,
        enriched_query: query,
        entities: { dates: [], times: [], locations: {}, people: [], quantities: [] },
        ambiguities_resolved: [],
        missing_parameters: [],
        context_applied: [],
        clarification_needed: false,
        clarification_questions: []
      };
    }
  }

  /**
   * Classifies query complexity using a fast LLM call
   * @param {string} query - The user's query
   * @param {Object} apiKeys - Available API keys
   * @param {string} activeProvider - The active LLM provider
   * @returns {Object} Classification result with complexity, requires_waiting, estimated_steps
   */
  async function classifyQueryComplexity(query, apiKeys, activeProvider) {
    const classificationPrompt = `Classify this user query for complexity:
"${query}"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "complexity": "simple" or "multi_step" or "complex_async",
  "reason": "brief 5-10 word explanation",
  "requires_waiting": true/false,
  "estimated_steps": number
}

Classification rules:
- "simple": ONLY truly single actions with NO data dependencies. Examples: "what's the weather?", "what time is it?", "what's on my calendar today?"
- "multi_step": ANY query that involves:
  * Looking up a contact AND then doing something with that contact (messages, email, etc.)
  * Searching/retrieving data AND then filtering or analyzing it
  * Multiple sequential actions where output of one step informs the next
  * Message retrieval from a person (requires: lookup contact → search messages → filter results)
  * Examples: "messages from Igor", "find Chris's email and reply", "what did John say about the project?"
- "complex_async": Requires waiting for external events, human responses, or monitoring. Examples: "wait for John's reply", "monitor Slack for messages"

IMPORTANT - These are ALWAYS multi_step:
- "messages from [person]" - requires contact lookup + message search + filtering
- "what did [person] say about X" - requires contact lookup + message search + content analysis
- "[person]'s latest messages" - requires contact lookup + message retrieval
- "find [something] and [do action with it]" - two dependent steps

Set requires_waiting=true ONLY if the task needs to wait for: email replies, message responses, external API callbacks, or human input between steps.

IMPORTANT: Browser automation (page loads, clicking buttons, form submissions) is NOT waiting. These are immediate automated actions.`;

    try {
      // Use Anthropic if available (preferred)
      if (apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.anthropic,
            max_tokens: 256,
            messages: [{ role: "user", content: classificationPrompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || "{}";
          // Extract JSON from response (handle potential markdown wrapping)
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[QueryDecomposition] Classified as: ${result.complexity} (${result.estimated_steps} steps, waiting: ${result.requires_waiting})`);
            return result;
          }
        }
      }
      
      // Fallback to OpenAI if available
      if (apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: CLASSIFIER_MODELS.openai,
            max_tokens: 256,
            messages: [
              { role: "system", content: "You are a query classifier. Respond with only JSON." },
              { role: "user", content: classificationPrompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[QueryDecomposition] Classified as: ${result.complexity} (${result.estimated_steps} steps, waiting: ${result.requires_waiting})`);
            return result;
          }
        }
      }

      // Default to simple if classification fails
      console.log("[QueryDecomposition] Classification failed, defaulting to simple");
      return { complexity: "simple", reason: "classification failed", requires_waiting: false, estimated_steps: 1 };

    } catch (err) {
      console.error("[QueryDecomposition] Classification error:", err.message);
      return { complexity: "simple", reason: "error occurred", requires_waiting: false, estimated_steps: 1 };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Decomposition Functions
  // ─────────────────────────────────────────────────────────────────────────────
  // NOTE: decomposeQuery, architectDecompose, builderMapToTools, validateDecomposition,
  // formatDecomposedSteps, and related functions are now imported from ./src/llm/decomposition.js
  // They use the Architect-Builder pattern for more reliable task decomposition.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Executes decomposed steps inline with context passing
   * @param {Object} decomposition - The decomposition result
   * @param {Array} messages - Chat message history
   * @param {Object} toolExecutor - Object with executeTool function
   * @param {Object} apiKeys - Available API keys
   * @param {Object} models - Model configuration
   * @param {string} activeProvider - The active LLM provider
   * @param {string} systemPrompt - The system prompt to use
   * @param {Function} sendProgress - Optional callback to send progress updates
   * @returns {Object} Result with ok, response, and step results
   */
  async function executeDecomposedSteps(decomposition, messages, toolExecutor, apiKeys, models, activeProvider, systemPrompt, sendProgress) {
    const { steps, title } = decomposition;
    const stepResults = [];
    let accumulatedContext = {};
    
    console.log(`[QueryDecomposition] ========== EXECUTE DECOMPOSED STEPS ==========`);
    console.log(`[QueryDecomposition] Title: "${title}"`);
    console.log(`[QueryDecomposition] Steps count: ${steps?.length || 0}`);
    console.log(`[QueryDecomposition] Active provider: ${activeProvider}`);
    console.log(`[QueryDecomposition] Has Anthropic key: ${!!apiKeys?.anthropic}`);
    console.log(`[QueryDecomposition] Has OpenAI key: ${!!apiKeys?.openai}`);
    console.log(`[QueryDecomposition] Tools count: ${toolExecutor?.tools?.length || 0}`);

    // Enhanced system prompt for step execution
    const stepSystemPrompt = `${systemPrompt}

## EXECUTION CONTEXT
You are executing a multi-step plan. Current plan: "${title}"

Steps:
${formatDecomposedSteps(steps)}

## INSTRUCTIONS
- Execute ONLY the current step indicated
- Use the tools specified for that step
- Be concise in your responses
- After completing a step, summarize what you found/did
- Pass relevant information to the next step via your response`;

    // Build conversation with accumulated context
    let currentMessages = [...messages];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;
      
      console.log(`[QueryDecomposition] Executing step ${stepNum}/${steps.length}: ${step.action}`);
      
      // Send progress update if callback provided
      if (sendProgress) {
        sendProgress({
          type: "step_progress",
          currentStep: stepNum,
          totalSteps: steps.length,
          stepAction: step.action,
          status: "executing"
        });
      }

      // Add step instruction to messages
      const stepInstruction = stepNum === 1 
        ? `Execute step ${stepNum}: ${step.action}`
        : `Continue with step ${stepNum}: ${step.action}\n\nContext from previous steps:\n${JSON.stringify(accumulatedContext, null, 2)}`;

      const stepMessages = [
        ...currentMessages,
        { role: "user", content: stepInstruction }
      ];

      // Execute this step using the main chat flow (with tool calling)
      try {
        let stepResponse = null;
        
        console.log(`[QueryDecomposition] Step ${stepNum}: Provider=${activeProvider}, HasKey=${!!apiKeys[activeProvider]}`);
        
        // Use Anthropic
        if (activeProvider === "anthropic" && apiKeys.anthropic) {
          const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
          let iterationMessages = stepMessages.map(m => ({ role: m.role, content: m.content }));
          
          console.log(`[QueryDecomposition] Step ${stepNum}: Calling Anthropic API with model ${anthropicModel}...`);
          
          for (let iteration = 0; iteration < 5; iteration++) {
            console.log(`[QueryDecomposition] Step ${stepNum}: API iteration ${iteration + 1}`);
            const response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKeys.anthropic,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: anthropicModel,
                max_tokens: 4096,
                system: stepSystemPrompt,
                tools: toolExecutor.tools,
                messages: iterationMessages
              })
            });

            if (!response.ok) {
              const error = await response.text();
              console.error(`[QueryDecomposition] Step ${stepNum}: API error - ${error}`);
              throw new Error(`API error: ${error}`);
            }

            const data = await response.json();
            console.log(`[QueryDecomposition] Step ${stepNum}: API response stop_reason=${data.stop_reason}`);

            if (data.stop_reason === "end_turn" || !data.content.some(b => b.type === "tool_use")) {
              const textBlock = data.content.find(b => b.type === "text");
              stepResponse = textBlock?.text || "";
              console.log(`[QueryDecomposition] Step ${stepNum}: Got text response (${stepResponse?.length || 0} chars)`);
              break;
            }

            // Handle tool calls
            const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
            const toolResults = [];

            for (const toolUse of toolUseBlocks) {
              console.log(`[QueryDecomposition] Step ${stepNum} tool: ${toolUse.name}`);
              const result = await toolExecutor.executeTool(toolUse.name, toolUse.input);
              // Remove screenshotDataUrl to prevent token explosion
              const { screenshotDataUrl, ...resultForLLM } = result;
              
              // Store tool results in accumulated context
              accumulatedContext[`step${stepNum}_${toolUse.name}`] = resultForLLM;
              
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(resultForLLM)
              });
            }

            iterationMessages.push({ role: "assistant", content: data.content });
            iterationMessages.push({ role: "user", content: toolResults });
          }
        }
        // Use OpenAI
        else if (activeProvider === "openai" && apiKeys.openai) {
          const openaiModel = models.openai || "gpt-4o";
          const openaiTools = toolExecutor.tools.map(t => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.input_schema }
          }));

          let iterationMessages = [
            { role: "system", content: stepSystemPrompt },
            ...stepMessages.map(m => ({ role: m.role, content: m.content }))
          ];

          for (let iteration = 0; iteration < 5; iteration++) {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKeys.openai}`
              },
              body: JSON.stringify({
                model: openaiModel,
                messages: iterationMessages,
                tools: openaiTools
              })
            });

            if (!response.ok) {
              const error = await response.text();
              throw new Error(`API error: ${error}`);
            }

            const data = await response.json();
            const choice = data.choices[0];

            if (choice.finish_reason === "stop" || !choice.message.tool_calls) {
              stepResponse = choice.message.content || "";
              break;
            }

            iterationMessages.push(choice.message);

            for (const toolCall of choice.message.tool_calls) {
              const toolInput = JSON.parse(toolCall.function.arguments);
              console.log(`[QueryDecomposition] Step ${stepNum} tool: ${toolCall.function.name}`);
              const result = await toolExecutor.executeTool(toolCall.function.name, toolInput);
              // Remove screenshotDataUrl to prevent token explosion
              const { screenshotDataUrl, ...resultForLLM } = result;
              
              accumulatedContext[`step${stepNum}_${toolCall.function.name}`] = resultForLLM;

              iterationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(resultForLLM)
              });
            }
          }
        }
        // Fallback for Google (no tool support yet)
        else if (apiKeys.google) {
          console.log(`[QueryDecomposition] Step ${stepNum}: Using Google (no tool support)`);
          stepResponse = "Google Gemini does not yet support tool calling for decomposed execution.";
        }
        // No provider available
        else {
          console.error(`[QueryDecomposition] Step ${stepNum}: NO PROVIDER AVAILABLE!`);
          console.error(`[QueryDecomposition] Provider: ${activeProvider}, Keys: anthropic=${!!apiKeys.anthropic}, openai=${!!apiKeys.openai}, google=${!!apiKeys.google}`);
          stepResponse = "Error: No LLM provider available for this step.";
        }

        console.log(`[QueryDecomposition] Step ${stepNum}: Final response = "${stepResponse?.substring(0, 100) || 'null'}..."`);
        
        stepResults.push({
          step: stepNum,
          action: step.action,
          response: stepResponse,
          success: true
        });

        // Add step result to accumulated context
        accumulatedContext[`step${stepNum}_result`] = stepResponse;

        // Update current messages for next step
        currentMessages.push({ role: "user", content: stepInstruction });
        currentMessages.push({ role: "assistant", content: stepResponse || "" });

        // Send progress update
        if (sendProgress) {
          sendProgress({
            type: "step_progress",
            currentStep: stepNum,
            totalSteps: steps.length,
            stepAction: step.action,
            status: "completed",
            result: stepResponse
          });
        }

      } catch (err) {
        console.error(`[QueryDecomposition] Step ${stepNum} error:`, err.message);
        stepResults.push({
          step: stepNum,
          action: step.action,
          response: null,
          error: err.message,
          success: false
        });

        if (sendProgress) {
          sendProgress({
            type: "step_progress",
            currentStep: stepNum,
            totalSteps: steps.length,
            stepAction: step.action,
            status: "error",
            error: err.message
          });
        }

        // Continue to next step or fail? For now, continue
      }
    }

    // Generate final summary
    const successfulSteps = stepResults.filter(r => r.success).length;
    const lastResult = stepResults[stepResults.length - 1];
    
    let finalResponse = `## Task Complete: ${title}\n\n`;
    finalResponse += `Completed ${successfulSteps}/${steps.length} steps.\n\n`;
    
    if (lastResult?.response) {
      finalResponse += `**Final Result:**\n${lastResult.response}`;
    }

    console.log(`[QueryDecomposition] Execution complete: ${successfulSteps}/${steps.length} steps successful`);

    return {
      ok: true,
      response: finalResponse,
      stepResults,
      decomposition
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CDP Browser Tools - Direct Chrome DevTools Protocol control
  // ─────────────────────────────────────────────────────────────────────────────
  
  const cdpBrowserTools = [
    {
      name: "browser_navigate",
      description: "Navigate to a URL in the browser. Returns a visual snapshot with clickable element refs. Use this to open websites, search pages, etc.",
      input_schema: {
        type: "object",
        properties: {
          url: { 
            type: "string", 
            description: "The URL to navigate to (e.g., 'https://google.com' or 'https://zillow.com/homes/palo-alto')" 
          }
        },
        required: ["url"]
      }
    },
    {
      name: "browser_click",
      description: "Click an element on the page by its ref (e.g., 'e23'). Get refs from browser_snapshot. After clicking, a new snapshot is returned.",
      input_schema: {
        type: "object",
        properties: {
          ref: { 
            type: "string", 
            description: "Element ref from the snapshot (e.g., 'e5', 'e23')" 
          }
        },
        required: ["ref"]
      }
    },
    {
      name: "browser_type",
      description: "Type text into an input field. Optionally specify a ref to focus that element first. If no ref, types into the currently focused element.",
      input_schema: {
        type: "object",
        properties: {
          text: { 
            type: "string", 
            description: "The text to type" 
          },
          ref: { 
            type: "string", 
            description: "Optional: Element ref to focus first before typing" 
          }
        },
        required: ["text"]
      }
    },
    {
      name: "browser_press",
      description: "Press a keyboard key (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown'). Use after typing to submit forms.",
      input_schema: {
        type: "object",
        properties: {
          key: { 
            type: "string", 
            description: "Key to press (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp')" 
          }
        },
        required: ["key"]
      }
    },
    {
      name: "browser_snapshot",
      description: "Get a visual snapshot of the current page. Returns a screenshot and list of clickable elements with refs. Use this to see what's on the page and get element refs for clicking/typing.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "browser_scroll",
      description: "Scroll the page up or down to see more content.",
      input_schema: {
        type: "object",
        properties: {
          direction: { 
            type: "string", 
            enum: ["up", "down"],
            description: "Direction to scroll" 
          },
          amount: { 
            type: "number", 
            description: "Pixels to scroll (default: 500)" 
          }
        },
        required: ["direction"]
      }
    },
    {
      name: "browser_back",
      description: "Go back to the previous page in browser history.",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "browser_fill_credential",
      description: "Securely fill a login form field with a saved credential. Use this for login forms when the user has saved credentials for the domain. The actual credential value is never exposed.",
      input_schema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "The domain to get credentials for (e.g., 'mybrightwheel.com', 'amazon.com')"
          },
          field: {
            type: "string",
            enum: ["username", "password"],
            description: "Which credential field to fill: 'username' or 'password'"
          },
          ref: {
            type: "string",
            description: "Element ref of the input field to fill (e.g., 'e5')"
          }
        },
        required: ["domain", "field", "ref"]
      }
    }
  ];

  /**
   * Execute CDP browser tool
   */
  const executeCdpBrowserTool = async (toolName, toolInput) => {
    try {
      if (!currentUser?.username) {
        return { error: "Not logged in - browser automation requires authentication" };
      }
      const controller = await getBrowserController(currentUser.username);
      const sessionId = toolInput.sessionId || "default";
      
      switch (toolName) {
        case "browser_navigate": {
          if (!toolInput.url) {
            return { error: "URL is required" };
          }
          const snapshot = await controller.navigate(sessionId, toolInput.url);
          return {
            success: true,
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50), // Limit elements to save tokens
            screenshotDataUrl: snapshot.screenshot,
            message: `Navigated to ${snapshot.url}. Found ${snapshot.elementCount} interactive elements. A screenshot is attached.`
          };
        }
        
        case "browser_click": {
          if (!toolInput.ref) {
            return { error: "Element ref is required (e.g., 'e5')" };
          }
          await controller.click(sessionId, toolInput.ref);
          // Wait for any navigation/updates
          await new Promise(resolve => setTimeout(resolve, 500));
          // Return new snapshot
          const snapshot = await controller.snapshot(sessionId);
          return {
            success: true,
            clicked: toolInput.ref,
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: `Clicked ${toolInput.ref}. Page updated. Screenshot attached.`
          };
        }
        
        case "browser_type": {
          if (!toolInput.text) {
            return { error: "Text is required" };
          }
          const typeResult = await controller.type(sessionId, toolInput.text, toolInput.ref);
          
          // Get a snapshot to verify typing worked
          await new Promise(resolve => setTimeout(resolve, 300));
          const snapshot = await controller.snapshot(sessionId);
          
          return {
            success: true,
            typed: toolInput.text.substring(0, 50) + (toolInput.text.length > 50 ? '...' : ''),
            focused: typeResult.focused,
            url: snapshot.url,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: typeResult.focused 
              ? `Typed "${toolInput.text.substring(0, 30)}..." into the input. Screenshot shows current state. Use browser_press with 'Enter' to submit.`
              : `Warning: Could not confirm focus on input element. Text may not have been typed. Check the screenshot and try clicking the input field first with browser_click.`
          };
        }
        
        case "browser_press": {
          if (!toolInput.key) {
            return { error: "Key is required (e.g., 'Enter')" };
          }
          await controller.press(sessionId, toolInput.key);
          // Wait for any updates after key press
          await new Promise(resolve => setTimeout(resolve, 500));
          // Return snapshot if Enter was pressed (likely form submission)
          if (toolInput.key === 'Enter') {
            const snapshot = await controller.snapshot(sessionId);
            return {
              success: true,
              pressed: toolInput.key,
              url: snapshot.url,
              title: snapshot.title,
              elementCount: snapshot.elementCount,
              elements: snapshot.elements.slice(0, 50),
              screenshotDataUrl: snapshot.screenshot,
              message: `Pressed ${toolInput.key}. Page may have updated. Screenshot attached.`
            };
          }
          return {
            success: true,
            pressed: toolInput.key,
            message: `Pressed ${toolInput.key}`
          };
        }
        
        case "browser_snapshot": {
          const snapshot = await controller.snapshot(sessionId);
          return {
            success: true,
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: `Current page: ${snapshot.title}. Found ${snapshot.elementCount} interactive elements. Screenshot attached.`
          };
        }
        
        case "browser_scroll": {
          const direction = toolInput.direction || 'down';
          const amount = toolInput.amount || 500;
          await controller.scroll(sessionId, direction, amount);
          // Return snapshot after scroll
          const snapshot = await controller.snapshot(sessionId);
          return {
            success: true,
            scrolled: direction,
            url: snapshot.url,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: `Scrolled ${direction}. Screenshot attached.`
          };
        }
        
        case "browser_back": {
          const snapshot = await controller.goBack(sessionId);
          return {
            success: true,
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: `Went back to ${snapshot.url}. Screenshot attached.`
          };
        }
        
        case "browser_fill_credential": {
          const { domain, field, ref } = toolInput;
          if (!domain || !field || !ref) {
            return { error: "domain, field, and ref are all required" };
          }
          
          // Load credentials for this domain
          const credentials = await loadCredentials();
          const cred = credentials[domain];
          
          if (!cred) {
            return { 
              error: `No credentials found for domain: ${domain}`,
              suggestion: `The user needs to add credentials for ${domain} in the Credentials page of the app.`
            };
          }
          
          let valueToFill;
          if (field === 'username') {
            valueToFill = cred.username;
            if (!valueToFill) {
              return { error: `No username saved for ${domain}` };
            }
          } else if (field === 'password') {
            valueToFill = cred.password;
            if (!valueToFill) {
              return { error: `No password saved for ${domain}` };
            }
          } else {
            return { error: `Invalid field: ${field}. Must be 'username' or 'password'` };
          }
          
          // Use the controller to type the credential value
          // First click the ref to focus, then type
          // Pass sensitive=true for passwords to mask in logs
          await controller.click(sessionId, ref);
          await controller.type(sessionId, valueToFill, null, field === 'password');
          
          console.log(`[BrowserController] Filled ${field} credential for ${domain} into ${ref}`);
          
          return {
            success: true,
            message: `Securely filled ${field} for ${domain} into field ${ref}. The actual credential value is not shown for security.`,
            // Note: Don't include the value or screenshot here - just confirm it worked
          };
        }
        
        default:
          return { error: `Unknown browser tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[BrowserController] Error executing ${toolName}:`, err.message);
      return { 
        error: err.message,
        suggestion: "Try browser_snapshot to see the current page state, or browser_navigate to a new URL."
      };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared Tool Builder - Used by both Chat and Task Executor
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Builds the list of available tools based on enabled integrations
   * @param {Object} options - Configuration options
   * @param {string} options.googleAccessToken - Google OAuth token (if available)
   * @param {string} options.slackAccessToken - Slack OAuth token (if available)
   * @param {boolean} options.weatherEnabled - Whether weather is enabled
   * @param {boolean} options.iMessageEnabled - Whether iMessage is enabled
   * @param {boolean} options.includeProfileTools - Include profile management tools
   * @param {boolean} options.includeTaskTools - Include task management tools
   * @param {boolean} options.includeMemoryTools - Include memory search tools
   * @param {Array} options.additionalTools - Extra tools to include
   * @returns {Object} { tools: Array, executeTool: Function }
   */
  const buildToolsAndExecutor = (options = {}) => {
    const {
      googleAccessToken = null,
      slackAccessToken = null,
      weatherEnabled = true,
      iMessageEnabled = false,
      browserEnabled = false, // CDP browser automation
      // New integrations
      telegramToken = null,
      discordAccessToken = null,
      xAccessToken = null,
      notionAccessToken = null,
      githubAccessToken = null,
      asanaAccessToken = null,
      redditAccessToken = null,
      spotifyAccessToken = null,
      includeProfileTools = true,
      includeTaskTools = true,
      includeMemoryTools = true,
      additionalTools = []
    } = options;

    // Build tools list
    const tools = [];
    
    if (includeProfileTools) tools.push(...profileTools);
    if (includeTaskTools) tools.push(...taskTools);
    if (includeMemoryTools) tools.push(...memoryTools);
    
    // Time tools - always available (get_current_time, parse_time, etc.)
    tools.push(...timeTools);
    
    // Task primitive tools - always available for task execution (save_variable, evaluate_condition, notify_user, etc.)
    tools.push(...taskPrimitiveTools);
    
    // Documentation tools - always available for help questions
    tools.push(...documentationTools);
    if (googleAccessToken) tools.push(...googleWorkspaceTools);
    if (iMessageEnabled) tools.push(...iMessageTools);
    if (weatherEnabled) tools.push(...weatherTools);
    if (slackAccessToken) tools.push(...slackTools);
    
    // New integrations
    if (telegramToken) tools.push(...telegramTools);
    if (discordAccessToken) tools.push(...discordTools);
    if (xAccessToken) tools.push(...xTools);
    if (notionAccessToken) tools.push(...notionTools);
    if (githubAccessToken) tools.push(...githubTools);
    if (asanaAccessToken) tools.push(...asanaTools);
    if (redditAccessToken) tools.push(...redditTools);
    if (spotifyAccessToken) tools.push(...spotifyTools);
    
    // Browser tools (CDP-based direct control)
    if (browserEnabled) {
      tools.push(...cdpBrowserTools);
      console.log("[Tools] Browser tools enabled");
    }
    
    if (additionalTools.length > 0) tools.push(...additionalTools);

    // Tool execution router
    // taskContext is optional - if provided, message confirmations will use task-based approval
    const executeTool = async (toolName, toolInput, taskContext = null) => {
      // ─────────────────────────────────────────────────────────────────────
      // MESSAGE CONFIRMATION SAFEGUARD
      // All message-sending tools require explicit user approval
      // ─────────────────────────────────────────────────────────────────────
      if (TOOLS_REQUIRING_CONFIRMATION.includes(toolName)) {
        try {
          console.log(`[Confirmation] Tool ${toolName} requires user confirmation${taskContext ? ` (task: ${taskContext.taskId})` : ''}`);
          const result = await requestMessageConfirmation(toolName, toolInput, taskContext);
          
          // Check if message was stored as pending in a task
          if (result && typeof result === 'object' && result.pendingInTask) {
            return { 
              pending: true,
              message: `Message queued for approval in task. Check the Tasks panel to review and send.`,
              taskId: result.taskId,
              messageId: result.messageId
            };
          }
          
          if (!result) {
            return { 
              error: 'Message not sent - user did not approve',
              cancelled: true
            };
          }
          console.log(`[Confirmation] User approved ${toolName}, proceeding with send`);
        } catch (err) {
          console.log(`[Confirmation] Message cancelled: ${err.message}`);
          return { 
            error: `Message not sent: ${err.message}`,
            cancelled: true
          };
        }
      }
      
      // Profile tools
      if (profileTools.find(t => t.name === toolName)) {
        return await executeProfileTool(toolName, toolInput);
      }
      // Task tools
      if (taskTools.find(t => t.name === toolName)) {
        return await executeTaskTool(toolName, toolInput);
      }
      // Memory tools
      if (memoryTools.find(t => t.name === toolName)) {
        switch (toolName) {
          case "search_memory":
            return await executeMemorySearch(toolInput.query, toolInput.date_range);
          case "get_conversations_for_date":
            return await executeGetConversationsForDate(toolInput.date);
          case "search_memory_between_dates":
            return await executeSearchMemoryBetweenDates(toolInput.query, toolInput.start_date, toolInput.end_date);
          case "list_memory_dates":
            return await executeListMemoryDates(toolInput.limit);
          case "get_conversation_summary":
            return await executeGetConversationSummary(toolInput.date);
          default:
            return { error: `Unknown memory tool: ${toolName}` };
        }
      }
      // Documentation tools
      if (documentationTools.find(t => t.name === toolName)) {
        return await executeDocumentationFetch(toolInput.topic);
      }
      // Google tools
      if (googleAccessToken && googleWorkspaceTools.find(t => t.name === toolName)) {
        return await executeGoogleTool(toolName, toolInput, googleAccessToken);
      }
      // iMessage tools
      if (iMessageEnabled && iMessageTools.find(t => t.name === toolName)) {
        return await executeIMessageTool(toolName, toolInput);
      }
      // Weather tools
      if (weatherEnabled && weatherTools.find(t => t.name === toolName)) {
        return await executeWeatherTool(toolName, toolInput);
      }
      // Time tools (always available)
      if (timeTools.find(t => t.name === toolName)) {
        return await executeTimeTool(toolName, toolInput, { mainWindow: win });
      }
      // Task primitive tools (always available - variables, control flow, etc.)
      if (taskPrimitiveTools.find(t => t.name === toolName)) {
        return await executeTaskPrimitiveTool(toolName, toolInput, { taskContext, mainWindow: win });
      }
      // Slack tools
      if (slackAccessToken && slackTools.find(t => t.name === toolName)) {
        return await executeSlackTool(toolName, toolInput, slackAccessToken);
      }
      
      // Telegram tools
      if (telegramToken && telegramTools.find(t => t.name === toolName)) {
        return await executeTelegramTool(toolName, toolInput);
      }
      // Discord tools
      if (discordAccessToken && discordTools.find(t => t.name === toolName)) {
        return await executeDiscordTool(toolName, toolInput, discordAccessToken);
      }
      // X (Twitter) tools
      if (xAccessToken && xTools.find(t => t.name === toolName)) {
        return await executeXTool(toolName, toolInput, xAccessToken);
      }
      // Notion tools
      if (notionAccessToken && notionTools.find(t => t.name === toolName)) {
        return await executeNotionTool(toolName, toolInput, notionAccessToken);
      }
      // GitHub tools
      if (githubAccessToken && githubTools.find(t => t.name === toolName)) {
        return await executeGitHubTool(toolName, toolInput, githubAccessToken);
      }
      // Asana tools
      if (asanaAccessToken && asanaTools.find(t => t.name === toolName)) {
        return await executeAsanaTool(toolName, toolInput, asanaAccessToken);
      }
      // Reddit tools
      if (redditAccessToken && redditTools.find(t => t.name === toolName)) {
        return await executeRedditTool(toolName, toolInput, redditAccessToken);
      }
      // Spotify tools
      if (spotifyAccessToken && spotifyTools.find(t => t.name === toolName)) {
        return await executeSpotifyTool(toolName, toolInput, spotifyAccessToken);
      }
      
      // Browser tools (CDP-based)
      if (browserEnabled && cdpBrowserTools.find(t => t.name === toolName)) {
        return await executeCdpBrowserTool(toolName, toolInput);
      }
      
      return { error: `Tool ${toolName} not available` };
    };

    return { tools, executeTool };
  };

  /**
   * Loads integration settings and builds tools
   * @returns {Object} { tools, executeTool, googleAccessToken, slackAccessToken, weatherEnabled, iMessageEnabled, browserEnabled }
   */
  const loadIntegrationsAndBuildTools = async (options = {}) => {
    const settingsPath = await getSettingsPath(currentUser?.username);
    
    // Load Google token
    let googleAccessToken = null;
    try {
      googleAccessToken = await getGoogleAccessToken(currentUser?.username);
    } catch {
      // No Google
    }

    // Load Slack token
    let slackAccessToken = null;
    try {
      slackAccessToken = await getSlackAccessToken(currentUser?.username);
    } catch {
      // No Slack
    }

    // Check weather enabled
    let weatherEnabled = true;
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      weatherEnabled = settings.weatherEnabled !== false;
    } catch {
      // Default enabled
    }

    // Check iMessage enabled - available on macOS by default
    let iMessageEnabled = process.platform === "darwin";
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      // Allow user to explicitly disable iMessage if they want
      if (settings.iMessageEnabled === false) {
        iMessageEnabled = false;
      }
    } catch {
      // Default to platform check
    }

    // Check browser automation enabled
    let browserIsEnabled = false;
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      browserIsEnabled = settings.browserEnabled === true;
    } catch {
      // Default disabled
    }

    // Load new integration tokens
    let telegramToken = null;
    let discordAccessToken = null;
    let xAccessToken = null;
    let notionAccessToken = null;
    let githubAccessToken = null;
    let asanaAccessToken = null;
    let redditAccessToken = null;
    let spotifyAccessToken = null;
    
    try {
      telegramToken = await getTelegramToken();
    } catch { /* No Telegram */ }
    
    try {
      discordAccessToken = await getDiscordAccessToken();
    } catch { /* No Discord */ }
    
    try {
      xAccessToken = await getXAccessToken();
    } catch { /* No X */ }
    
    try {
      notionAccessToken = await getNotionAccessToken();
    } catch { /* No Notion */ }
    
    try {
      githubAccessToken = await getGitHubAccessToken();
    } catch { /* No GitHub */ }
    
    try {
      asanaAccessToken = await getAsanaAccessToken();
    } catch { /* No Asana */ }
    
    try {
      redditAccessToken = await getRedditAccessToken();
    } catch { /* No Reddit */ }
    
    try {
      spotifyAccessToken = await getSpotifyAccessToken();
    } catch { /* No Spotify */ }

    const { tools, executeTool } = buildToolsAndExecutor({
      googleAccessToken,
      slackAccessToken,
      weatherEnabled,
      iMessageEnabled,
      browserEnabled: browserIsEnabled,
      telegramToken,
      discordAccessToken,
      xAccessToken,
      notionAccessToken,
      githubAccessToken,
      asanaAccessToken,
      redditAccessToken,
      spotifyAccessToken,
      ...options
    });

    return {
      tools,
      executeTool,
      googleAccessToken,
      slackAccessToken,
      weatherEnabled,
      iMessageEnabled,
      browserEnabled: browserIsEnabled,
      telegramToken,
      discordAccessToken,
      xAccessToken,
      notionAccessToken,
      githubAccessToken,
      asanaAccessToken,
      redditAccessToken,
      spotifyAccessToken
    };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Register Messaging Integrations
  // ─────────────────────────────────────────────────────────────────────────────

  // Register Email/Gmail integration
  registerMessagingIntegration({
    id: "email",
    name: "Email (Gmail)",
    keywords: ["email", "gmail", "mail"],
    enabled: true,  // Will check for token at execution time
    
    sendMessage: async (recipient, message, subject, accessToken) => {
      return await executeGoogleTool("send_email", { 
        to: recipient, 
        subject: subject || "Message from Wovly", 
        body: message 
      }, accessToken);
    },
    
    checkForNewMessages: async (contact, afterTimestamp, accessToken, conversationId) => {
      if (!accessToken) return { hasNew: false, reason: "no access token" };
      // conversationId is the threadId for emails - filter to same email thread
      return await checkForNewEmails(accessToken, contact, afterTimestamp, conversationId);
    },
    
    getMessages: async (contact, options, accessToken) => {
      return await executeGoogleTool("list_emails", { from: contact, ...options }, accessToken);
    }
  });

  // Register iMessage/SMS integration
  registerMessagingIntegration({
    id: "imessage",
    name: "iMessage/SMS",
    keywords: ["text", "imessage", "sms", "message her", "message him", "message them"],
    enabled: process.platform === "darwin",
    
    sendMessage: async (recipient, message) => {
      const result = await executeIMessageTool("send_imessage", { recipient, message });
      // After sending, get the chat_id so we can track replies in this specific conversation
      if (result.success && result.sentTo) {
        const chatId = await getIMessageChatId(result.sentTo);
        if (chatId) {
          result.chatId = chatId;
          console.log(`[iMessage] Captured chat_id ${chatId} for conversation with ${result.sentTo}`);
        }
      }
      return result;
    },
    
    checkForNewMessages: async (contact, afterTimestamp, accessToken, chatId) => {
      // Pass chatId to filter to the specific conversation thread
      return await checkForNewIMessages(contact, afterTimestamp, chatId);
    },
    
    getMessages: async (contact, options) => {
      return await executeIMessageTool("get_recent_messages", { contact, ...options });
    },
    
    resolveContact: async (name) => {
      return await findContactsByName(name);
    }
  });

  // Register Slack integration
  registerMessagingIntegration({
    id: "slack",
    name: "Slack",
    keywords: ["slack"],
    enabled: true,  // Will check for token at execution time
    
    sendMessage: async (recipient, message, _subject, accessToken) => {
      const result = await executeSlackTool("send_slack_message", { 
        channel: recipient, 
        text: message 
      }, accessToken);
      // Return the channel ID for conversation tracking
      if (result && !result.error) {
        result.channel = result.channel || recipient;
      }
      return result;
    },
    
    checkForNewMessages: async (contact, afterTimestamp, accessToken, channelId) => {
      if (!accessToken) return { hasNew: false, reason: "no access token" };
      // Use channelId if provided, otherwise fall back to contact (they're usually the same for Slack)
      const targetChannel = channelId || contact;
      return await checkForNewSlackMessages(targetChannel, afterTimestamp, accessToken);
    },
    
    getMessages: async (contact, options, accessToken) => {
      return await executeSlackTool("get_slack_messages", { 
        channel: contact, 
        ...options 
      }, accessToken);
    },
    
    resolveContact: async (name, accessToken) => {
      return await executeSlackTool("search_slack_users", { query: name }, accessToken);
    }
  });

  // Register Telegram integration
  registerMessagingIntegration({
    id: "telegram",
    name: "Telegram",
    keywords: ["telegram", "tg"],
    enabled: true,
    
    sendMessage: async (recipient, message) => {
      const result = await executeTelegramTool("send_telegram_message", { 
        chat_id: recipient, 
        message 
      });
      if (result && !result.error) {
        result.chat_id = recipient;
      }
      return result;
    },
    
    checkForNewMessages: async (contact, afterTimestamp) => {
      const token = await getTelegramToken();
      if (!token) return { hasNew: false, reason: "no bot token" };
      
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-20`);
        const data = await response.json();
        if (!data.ok) return { hasNew: false, reason: data.description };
        
        const cutoffTime = new Date(afterTimestamp).getTime() / 1000;
        const newMessages = data.result.filter(u => 
          u.message && 
          u.message.date > cutoffTime &&
          (String(u.message.chat.id) === String(contact) || 
           u.message.chat.username === contact ||
           u.message.from?.username === contact)
        );
        
        return {
          hasNew: newMessages.length > 0,
          count: newMessages.length,
          messages: newMessages.map(u => ({
            text: u.message.text,
            from: u.message.from?.first_name || u.message.from?.username,
            date: new Date(u.message.date * 1000).toISOString()
          }))
        };
      } catch (err) {
        return { hasNew: false, reason: err.message };
      }
    },
    
    getMessages: async (contact) => {
      return await executeTelegramTool("get_telegram_updates", { limit: 20 });
    }
  });

  // Register Discord integration
  registerMessagingIntegration({
    id: "discord",
    name: "Discord",
    keywords: ["discord"],
    enabled: true,
    
    sendMessage: async (recipient, message, _subject, accessToken) => {
      const result = await executeDiscordTool("send_discord_message", { 
        channel_id: recipient, 
        message 
      }, accessToken);
      if (result && !result.error) {
        result.channel_id = recipient;
      }
      return result;
    },
    
    checkForNewMessages: async (contact, afterTimestamp, accessToken, channelId) => {
      if (!accessToken) return { hasNew: false, reason: "no access token" };
      
      try {
        const targetChannel = channelId || contact;
        const result = await executeDiscordTool("get_discord_messages", { 
          channel_id: targetChannel, 
          limit: 20 
        }, accessToken);
        
        if (result.error) return { hasNew: false, reason: result.error };
        
        const cutoffTime = new Date(afterTimestamp).getTime();
        const newMessages = (result.messages || []).filter(m => 
          new Date(m.timestamp).getTime() > cutoffTime
        );
        
        return {
          hasNew: newMessages.length > 0,
          count: newMessages.length,
          messages: newMessages
        };
      } catch (err) {
        return { hasNew: false, reason: err.message };
      }
    },
    
    getMessages: async (contact, options, accessToken) => {
      return await executeDiscordTool("get_discord_messages", { 
        channel_id: contact, 
        ...options 
      }, accessToken);
    }
  });

  // Register X (Twitter) integration for DMs
  registerMessagingIntegration({
    id: "x",
    name: "X (Twitter)",
    keywords: ["x", "twitter", "tweet", "dm"],
    enabled: true,
    
    sendMessage: async (recipient, message, _subject, accessToken) => {
      const result = await executeXTool("send_x_dm", { 
        recipient_id: recipient, 
        message 
      }, accessToken);
      return result;
    },
    
    checkForNewMessages: async () => {
      // X API doesn't support polling for DMs easily
      return { hasNew: false, reason: "X DM polling not supported" };
    },
    
    getMessages: async () => {
      return { error: "X message retrieval not implemented" };
    }
  });

  console.log(`[Messaging] Registered ${Object.keys(messagingIntegrations).length} messaging integrations`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Core Chat Processing Function (shared by IPC handler and inline execution)
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Process a chat query through the full pipeline
   * @param {Array} messages - Chat messages array
   * @param {Object} options - Processing options
   * @param {boolean} options.skipDecomposition - Skip query decomposition (for inline step execution)
   * @param {string} options.stepContext - Additional context from previous steps (for inline execution)
   * @returns {Object} Result with ok, response, and optional decomposition/classification
   */
  async function processChatQuery(messages, options = {}) {
    const { skipDecomposition = false, stepContext = null, workflowContext = null } = options;
    
    // Ensure user is logged in
    if (!currentUser?.username) {
      return { ok: false, error: "Not logged in. Please log in to continue." };
    }
    
    // Check if user is responding to an active workflow (e.g., clarification for task creation)
    const isRespondingToWorkflow = workflowContext?.type === 'clarifying_for_task';
    if (isRespondingToWorkflow) {
      console.log("[Workflow] User is responding to clarification - will skip info detection");
    }
    
    // Check if there's a task waiting for user input
    // If so, route the user's message to that task
    const userMessage = messages[messages.length - 1]?.content || "";
    const waitingTasks = await getTasksWaitingForInput(currentUser.username);
    if (waitingTasks.length > 0 && userMessage.trim()) {
      const task = waitingTasks[0]; // Handle most recent task waiting for input
      console.log(`[Tasks] Routing user message to task ${task.id} waiting for input`);
      
      // Store user response in task context and resume
      const clarificationQuestion = task.contextMemory?.pendingClarification || "";
      const saveResponseAs = task.contextMemory?.saveResponseAs;
      
      // Build updated context memory
      const updatedContextMemory = {
        ...task.contextMemory,
        userResponse: userMessage,
        respondedAt: new Date().toISOString(),
        pendingClarification: null, // Clear the pending question
        saveResponseAs: null // Clear the save target
      };
      
      // If ask_user_question specified a variable name, save the response there too
      if (saveResponseAs) {
        updatedContextMemory[saveResponseAs] = userMessage;
        console.log(`[Tasks] Saved user response to variable: ${saveResponseAs}`);
      }
      
      await updateTask(task.id, {
        status: "active",
        contextMemory: updatedContextMemory,
        logEntry: `User responded: "${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}"${saveResponseAs ? ` (saved as ${saveResponseAs})` : ''}`
      }, currentUser?.username);
      
      // Resume task execution
      setTimeout(() => executeTaskStep(task.id, currentUser?.username), 100);
      
      return {
        ok: true,
        response: `Got it! I'll continue with the task "${task.title}" using your input.`,
        routedToTask: true,
        taskId: task.id
      };
    }
    
    const settingsPath = await getSettingsPath(currentUser?.username);
    let apiKeys = {};
    let models = {};
    let activeProvider = "anthropic";
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      apiKeys = settings.apiKeys || {};
      models = settings.models || {};
      activeProvider = settings.activeProvider || "anthropic";
    } catch {
      return { ok: false, error: "No API keys configured" };
    }

    if (!apiKeys.anthropic && !apiKeys.openai && !apiKeys.google) {
      return { ok: false, error: "No API keys configured. Go to Settings to add your API key." };
    }
    
    // userMessage already declared at the top of this function

    // ─────────────────────────────────────────────────────────────────────────
    // Skill Creation Detection - Check if user wants to create a new skill
    // ─────────────────────────────────────────────────────────────────────────
    
    // Match patterns like:
    // - "create a skill where..."
    // - "make a skill that..."
    // - "add a new skill for..."
    // - "new skill: ..."
    // - "create skill called X"
    // - "teach me a skill" / "learn a skill"
    const skillCreationMatch = userMessage.toLowerCase().match(
      /^(create|make|add|new|teach|learn)\s+(a\s+)?(new\s+)?skill\b/i
    );
    if (skillCreationMatch) {
      console.log("[Skills] Detected skill creation request");
      
      try {
        // Generate the skill using LLM
        const generatedSkill = await generateSkillFromDescription(userMessage, apiKeys, activeProvider);
        
        if (generatedSkill.error) {
          return { ok: false, error: generatedSkill.error };
        }
        
        // Generate a skill ID from the name
        const skillId = generatedSkill.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50);
        
        // Serialize to markdown
        const skillMarkdown = serializeSkill(generatedSkill);
        
        // Save the skill
        const skillsDir = await getSkillsDir(currentUser?.username);
        const skillPath = path.join(skillsDir, `${skillId}.md`);
        await fs.writeFile(skillPath, skillMarkdown, "utf8");
        
        console.log(`[Skills] Created new skill: ${skillId}`);
        
        // Ensure arrays exist for safe formatting
        const keywords = Array.isArray(generatedSkill.keywords) ? generatedSkill.keywords : [];
        const procedure = Array.isArray(generatedSkill.procedure) ? generatedSkill.procedure : [];
        const constraints = Array.isArray(generatedSkill.constraints) ? generatedSkill.constraints : [];
        
        // Check if this is the skill_demo stage and advance onboarding
        let onboardingAdvancedMessage = "";
        try {
          const profilePath = await getUserProfilePath(currentUser?.username);
          const profileMarkdown = await fs.readFile(profilePath, "utf8");
          const userProfile = parseUserProfile(profileMarkdown);
          if (userProfile.onboardingStage === "skill_demo") {
            console.log("[Onboarding] Skill created during skill_demo, prompting to test it");
            // Don't advance yet - wait for them to test the skill
            onboardingAdvancedMessage = `\n\nYour skill is ready! Now test it by saying **"Marco"** and see what happens.`;
          }
        } catch (err) {
          console.error("[Onboarding] Error checking skill_demo stage:", err.message);
        }
        
        // Format response with skill details
        const response = `I've created a new skill: **${generatedSkill.name}**\n\n` +
          `**Description:** ${generatedSkill.description || 'No description'}\n\n` +
          `**Keywords:** ${keywords.length > 0 ? keywords.join(', ') : 'general'}\n\n` +
          `**Procedure:**\n${procedure.length > 0 ? procedure.map((step, i) => `${i + 1}. ${step}`).join('\n') : '1. Follow task instructions'}\n\n` +
          (constraints.length > 0 ? `**Constraints:**\n${constraints.map(c => `- ${c}`).join('\n')}\n\n` : '') +
          `The skill has been saved and is now available. You can view and edit it in the Skills page.` +
          onboardingAdvancedMessage;
        
        return {
          ok: true,
          response,
          skillCreated: { id: skillId, name: generatedSkill.name }
        };
      } catch (err) {
        console.error("[Skills] Error creating skill:", err.message);
        return { ok: false, error: `Failed to create skill: ${err.message}` };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pre-load Context (needed for Query Understanding and Chat)
    // ─────────────────────────────────────────────────────────────────────────
    
    // Get user profile for context
    let profile = null;
    try {
      const profilePath = await getUserProfilePath(currentUser?.username);
      const markdown = await fs.readFile(profilePath, "utf8");
      profile = parseUserProfile(markdown);
    } catch {
      // No profile
    }

    // Load conversation context (historical memory)
    let conversationContext = { todayMessages: "", yesterdayMessages: "", recentSummaries: "" };
    try {
      if (currentUser?.username) {
        conversationContext = await loadConversationContext(currentUser.username);
      }
    } catch (err) {
      console.error("[Memory] Error loading conversation context:", err.message);
    }

    // Get calendar events for today (if Google is connected) - helps with time references
    let todayCalendarEvents = [];
    try {
      const accessToken = await getGoogleAccessToken(currentUser?.username);
      if (accessToken) {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        todayCalendarEvents = await fetchCalendarEvents(accessToken, startOfDay, endOfDay);
      }
    } catch (err) {
      console.log("[Calendar] Unable to fetch calendar for context:", err.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input Type Detection - Check if this is an informational statement
    // ─────────────────────────────────────────────────────────────────────────
    
    // Track facts detected during workflow for deferred prompting
    let detectedFactsDuringWorkflow = [];
    
    if (!skipDecomposition && userMessage.length > 10) {
      try {
        console.log("[InputType] Detecting input type...");
        const inputType = await detectInputType(userMessage, apiKeys, activeProvider);
        
        if (inputType.type === "information" && inputType.confidence > 0.7) {
          console.log("[InputType] Detected informational statement, extracting facts...");
          
          // Extract facts from the statement
          const factsResult = await extractFacts(userMessage, apiKeys, activeProvider);
          
          if (factsResult.facts && factsResult.facts.length > 0) {
            // If responding to a workflow, capture facts silently for later instead of interrupting
            if (isRespondingToWorkflow) {
              console.log("[InputType] User is in workflow - capturing facts silently for later");
              detectedFactsDuringWorkflow = factsResult.facts;
              // Don't return - continue with normal processing
            } else {
              // Normal flow: prompt user to save facts
              // Load existing profile notes for conflict detection
              let existingNotes = [];
              try {
                const profilePath = await getUserProfilePath(currentUser?.username);
                const markdown = await fs.readFile(profilePath, "utf8");
                const existingProfile = parseUserProfile(markdown);
                existingNotes = existingProfile.notes || [];
              } catch { /* No profile yet */ }
              
              // Check for conflicts with existing notes
              const conflictResult = await detectFactConflicts(
                factsResult.facts, existingNotes, apiKeys, activeProvider
              );
              
              // Format response message
              let responseMessage = "I noticed you're sharing some important information. Would you like me to save this to your profile?\n\n";
              responseMessage += "**Facts to save:**\n";
              factsResult.facts.forEach((fact, i) => {
                responseMessage += `• ${fact.summary}\n`;
              });
              
              if (conflictResult.conflicts && conflictResult.conflicts.length > 0) {
                responseMessage += "\n**⚠️ Conflicts detected:**\n";
                conflictResult.conflicts.forEach(conflict => {
                  responseMessage += `\n• ${conflict.conflictDescription}\n`;
                  responseMessage += `  - Previously: "${conflict.existingNote}"\n`;
                  responseMessage += `  - Now: "${conflict.newFact}"\n`;
                });
              }
              
              // Return with confirmation prompt
              return {
                ok: true,
                response: responseMessage,
                informationType: true,
                facts: factsResult.facts,
                conflicts: conflictResult.conflicts || [],
                nonConflictingIndexes: conflictResult.nonConflictingFactIndexes || [],
                originalInput: userMessage
              };
            }
          }
        }
      } catch (err) {
        console.error("[InputType] Error in detection:", err.message);
        // Continue with normal processing on error
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query Understanding - Extract entities, resolve ambiguities, enrich query
    // ─────────────────────────────────────────────────────────────────────────
    
    let queryUnderstanding = null;
    let enrichedQuery = userMessage; // Default to original if understanding fails/skipped
    
    if (!skipDecomposition && userMessage.length > 20) {
      try {
        console.log("[QueryUnderstanding] Analyzing query...");
        queryUnderstanding = await understandQuery(userMessage, {
          profile,
          conversationContext,
          calendarEvents: todayCalendarEvents,
          currentDate: new Date(),
          sessionMessages: messages // Pass current session messages for immediate context
        }, apiKeys, activeProvider);
        
        // Check if clarification is needed
        if (queryUnderstanding.clarification_needed && queryUnderstanding.clarification_questions?.length > 0) {
          // SECURITY FILTER: Remove any credential-related questions
          const credentialPatterns = [
            /password/i,
            /username/i,
            /login\s*credential/i,
            /api\s*key/i,
            /secret/i,
            /authentication/i,
            /log\s*in\s*(details|info)/i,
            /sign\s*in\s*(details|info)/i,
            /\bcredential/i
          ];
          
          const safeQuestions = queryUnderstanding.clarification_questions.filter(q => {
            const questionText = (q.question || q).toLowerCase();
            const isCredentialQuestion = credentialPatterns.some(pattern => pattern.test(questionText));
            if (isCredentialQuestion) {
              console.warn("[QueryUnderstanding] BLOCKED credential question:", q.question || q);
            }
            return !isCredentialQuestion;
          });
          
          // Only return clarification if there are still valid questions after filtering
          if (safeQuestions.length > 0) {
            console.log("[QueryUnderstanding] Clarification needed, returning to user");
            return {
              ok: true,
              response: `Before I proceed, I need to clarify a few things:\n\n${safeQuestions.map((q, i) => `${i + 1}. ${q.question || q}`).join('\n')}\n\nPlease provide these details so I can help you better.`,
              clarification_needed: true,
              clarification_questions: safeQuestions,
              original_query: userMessage
            };
          } else {
            console.log("[QueryUnderstanding] All clarification questions were credential-related and blocked, proceeding without clarification");
          }
        }
        
        // Use enriched query for subsequent processing
        if (queryUnderstanding.enriched_query && queryUnderstanding.enriched_query !== userMessage) {
          enrichedQuery = queryUnderstanding.enriched_query;
          console.log(`[QueryUnderstanding] Using enriched query: "${enrichedQuery}"`);
        }
        
      } catch (err) {
        console.error("[QueryUnderstanding] Error:", err.message);
        // Continue with original query
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Conversation Style Context - Mimic user's voice when drafting messages
    // ─────────────────────────────────────────────────────────────────────────
    
    let conversationStyleContext = null;
    
    // Detect if this is a messaging request and extract recipient/platform
    const messagingPatterns = [
      { pattern: /(?:send|write|compose|draft|reply|email|message|text|slack|dm)\b.*(?:to|@)\s*([^\s,]+(?:\s+[^\s,]+)?)/i, platform: null },
      { pattern: /email\s+([^\s,]+@[^\s,]+)/i, platform: 'email' },
      { pattern: /(?:send|write)\s+(?:an?\s+)?email\s+(?:to\s+)?([^\s,]+)/i, platform: 'email' },
      { pattern: /(?:text|imessage|sms)\s+([^\s,]+(?:\s+[^\s,]+)?)/i, platform: 'imessage' },
      { pattern: /(?:slack|dm)\s+([^\s,]+(?:\s+[^\s,]+)?)/i, platform: 'slack' },
      { pattern: /(?:message|send\s+to)\s+([^\s,]+(?:\s+[^\s,]+)?)\s+(?:on|via|in)\s+(slack|email|text|imessage)/i, platform: null },
    ];
    
    let detectedRecipient = null;
    let detectedPlatform = null;
    
    for (const { pattern, platform } of messagingPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        detectedRecipient = match[1]?.trim();
        // Check for platform mention in the message
        if (!platform) {
          if (/email/i.test(userMessage)) detectedPlatform = 'email';
          else if (/slack|dm/i.test(userMessage)) detectedPlatform = 'slack';
          else if (/text|imessage|sms/i.test(userMessage)) detectedPlatform = 'imessage';
        } else {
          detectedPlatform = platform;
        }
        break;
      }
    }
    
    // Also check queryUnderstanding for extracted entities
    if (!detectedRecipient && queryUnderstanding?.entities && Array.isArray(queryUnderstanding.entities)) {
      const recipientEntity = queryUnderstanding.entities.find(e => 
        e.type === 'person' || e.type === 'contact' || e.type === 'email'
      );
      if (recipientEntity) {
        detectedRecipient = recipientEntity.resolved_value || recipientEntity.value;
      }
      
      // Check for messaging intent
      const actionEntity = queryUnderstanding.entities.find(e => e.type === 'action');
      if (actionEntity?.value && /send|email|message|text|slack|reply/i.test(actionEntity.value)) {
        if (!detectedPlatform) {
          if (/email/i.test(userMessage)) detectedPlatform = 'email';
          else if (/slack/i.test(userMessage)) detectedPlatform = 'slack';
          else if (/text|imessage/i.test(userMessage)) detectedPlatform = 'imessage';
        }
      }
    }
    
    // If we detected a messaging intent with a recipient, get their conversation style
    if (detectedRecipient && detectedPlatform) {
      console.log(`[StyleContext] Detected messaging to "${detectedRecipient}" via ${detectedPlatform}`);
      
      try {
        const googleAccessToken = await getGoogleAccessToken(currentUser?.username);
        const slackAccessToken = await getSlackAccessToken(currentUser?.username).catch(() => null);
        
        // Get current Slack user ID if needed
        let slackUserId = null;
        if (detectedPlatform === 'slack' && slackAccessToken) {
          try {
            const authResponse = await fetch("https://slack.com/api/auth.test", {
              headers: { "Authorization": `Bearer ${slackAccessToken}` }
            });
            const authData = await authResponse.json();
            if (authData.ok) {
              slackUserId = authData.user_id;
            }
          } catch { /* Ignore auth errors */ }
        }
        
        // Retrieve user's sent messages to this recipient
        const styleContextResult = await getConversationStyleContext(
          detectedRecipient, 
          detectedPlatform, 
          { 
            limit: 10, 
            accessToken: googleAccessToken,
            slackUserId 
          }
        );
        
        if (styleContextResult.hasHistory && styleContextResult.messages.length > 0) {
          // Generate style guide from the messages
          const styleGuide = await generateStyleGuide(
            styleContextResult.messages,
            detectedRecipient,
            apiKeys,
            activeProvider
          );
          
          conversationStyleContext = {
            recipient: detectedRecipient,
            platform: detectedPlatform,
            messages: styleContextResult.messages.slice(0, 5), // Limit examples
            styleGuide: styleGuide.styleGuide,
            formality: styleGuide.formality,
            hasHistory: true
          };
          
          console.log(`[StyleContext] Generated style guide for ${detectedRecipient} (formality: ${styleGuide.formality})`);
        } else {
          conversationStyleContext = {
            recipient: detectedRecipient,
            platform: detectedPlatform,
            hasHistory: false
          };
          console.log(`[StyleContext] No message history with ${detectedRecipient}, using default style`);
        }
      } catch (err) {
        console.error(`[StyleContext] Error retrieving style context: ${err.message}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query Decomposition - All queries go through Architect-Builder
    // ─────────────────────────────────────────────────────────────────────────
    
    if (!skipDecomposition) {
      try {
        console.log("[QueryDecomposition] Processing query through Architect-Builder...");
        
        // Build tools list for decomposition
        const accessToken = await getGoogleAccessToken(currentUser?.username);
        const slackToken = await getSlackAccessToken(currentUser?.username).catch(() => null);
        const hasBrowser = await (async () => {
          try {
            const s = JSON.parse(await fs.readFile(settingsPath, "utf8"));
            return s.browserEnabled === true;
          } catch { return false; }
        })();
        
        const toolsForDecomposition = [
          ...profileTools, ...taskTools, ...memoryTools,
          ...timeTools, // Time tools for get_current_time and send_reminder
          ...taskPrimitiveTools, // Fundamental tools: variables, control flow, time comparison
          ...(accessToken ? googleWorkspaceTools : []),
          ...(process.platform === "darwin" ? iMessageTools : []),
          ...weatherTools,
          ...(slackToken ? slackTools : []),
          ...(hasBrowser ? cdpBrowserTools : [])
        ];
        
        // Debug: Log available tools
        console.log(`[QueryDecomposition] Available tools (${toolsForDecomposition.length}): ${toolsForDecomposition.map(t => t.name).join(', ')}`);
        
        // Find matching skill for the query
        let matchedSkillForDecomposition = null;
        try {
          const skills = await loadAllSkills(currentUser?.username);
          if (skills.length > 0) {
            matchedSkillForDecomposition = await findBestSkill(enrichedQuery, currentUser?.username, skills);
            if (matchedSkillForDecomposition) {
              console.log(`[QueryDecomposition] Matched skill: ${matchedSkillForDecomposition.skill.name} (${(matchedSkillForDecomposition.confidence * 100).toFixed(0)}%)`);
            }
          }
        } catch (err) {
          console.error("[QueryDecomposition] Error finding skill:", err.message);
        }
        
        const queryDecomposition = await decomposeQuery(enrichedQuery, toolsForDecomposition, apiKeys, activeProvider, matchedSkillForDecomposition);
        
        // Check if we should suggest creating a task or execute inline
        if (queryDecomposition && queryDecomposition.steps && queryDecomposition.steps.length > 0) {
          // Check if user explicitly requested a task
          const queryLower = enrichedQuery.toLowerCase();
          const explicitlyRequestedTask = queryLower.includes("create a task") || 
                                          queryLower.includes("make a task") || 
                                          queryLower.includes("add a task") ||
                                          queryLower.includes("set up a task") ||
                                          queryLower.includes("schedule a task") ||
                                          queryLower.includes("remind me") ||
                                          queryLower.includes("every day") ||
                                          queryLower.includes("everyday") ||
                                          queryLower.includes("daily") ||
                                          queryLower.includes("weekly") ||
                                          queryLower.includes("monitor");
          
          // Check for steps that truly require waiting for external input
          const hasWaitingSteps = queryDecomposition.steps.some(s => 
            s.may_require_waiting || 
            s.tools_needed?.some(t => t === "ask_user_question")
          );
          
          // Check for steps that wait for human responses (emails, messages)
          const needsExternalInput = queryDecomposition.steps.some(s => {
            const actionLower = s.action?.toLowerCase() || "";
            return (
              actionLower.includes("wait for reply") ||
              actionLower.includes("wait for response") ||
              actionLower.includes("waiting for reply") ||
              actionLower.includes("waiting for response") ||
              actionLower.includes("monitor for") ||
              actionLower.includes("check for new")
            );
          });
          
          const tooManySteps = queryDecomposition.steps.length > 10;
          const isContinuousTask = queryDecomposition.task_type === "continuous";
          
          // Queries that are instant lookups should never become tasks
          const isInstantLookup = queryLower.includes("what did we") ||
                                  queryLower.includes("what have we") ||
                                  queryLower.includes("show me") ||
                                  queryLower.includes("tell me about") ||
                                  queryLower.includes("get my") ||
                                  queryLower.includes("list my") ||
                                  queryLower.includes("what's on my") ||
                                  queryLower.includes("search for") ||
                                  queryLower.includes("find me") ||
                                  queryLower.includes("look up");
          
          // Only suggest task if:
          // 1. User explicitly requested a task, OR
          // 2. Task requires waiting for external input (human replies), OR
          // 3. It's a continuous/monitoring task, OR
          // 4. Too many steps (>10)
          // BUT NOT if it's an instant lookup query
          const shouldSuggestTask = !isInstantLookup && (explicitlyRequestedTask || hasWaitingSteps || needsExternalInput || isContinuousTask || tooManySteps);
          
          console.log(`[QueryDecomposition] Task decision: explicitlyRequested=${explicitlyRequestedTask}, hasWaitingSteps=${hasWaitingSteps}, needsExternalInput=${needsExternalInput}, isContinuous=${isContinuousTask}, tooManySteps=${tooManySteps}, isInstantLookup=${isInstantLookup}`);
          console.log(`[QueryDecomposition] shouldSuggestTask=${shouldSuggestTask}`);
          
          if (shouldSuggestTask) {
            const stepsDisplay = formatDecomposedSteps(queryDecomposition.steps);
            const taskReason = hasWaitingSteps || needsExternalInput
              ? "This task involves waiting for external responses (like replies), which requires a background task."
              : isContinuousTask
                ? "This is a recurring/monitoring task that needs to run continuously."
                : tooManySteps 
                  ? `This task has ${queryDecomposition.steps.length} steps, which is best handled as a background task.`
                  : queryDecomposition.reason_for_task || "This task is best handled as a background task.";
            
            return {
              ok: true,
              response: `I've analyzed your request and broken it down into ${queryDecomposition.steps.length} steps:\n\n**${queryDecomposition.title}**\n\n${stepsDisplay}\n\n${taskReason}\n\nWould you like me to create a background task to handle this? It will run autonomously and notify you of progress.`,
              decomposition: queryDecomposition,
              suggestTask: true,
              // Include any facts detected during workflow for deferred saving
              ...(detectedFactsDuringWorkflow.length > 0 ? { detectedFacts: detectedFactsDuringWorkflow } : {})
            };
          }
          
          // Execute inline - no formal task needed for simple multi-step queries
          console.log(`[QueryDecomposition] Executing ${queryDecomposition.steps.length} steps inline...`);
          
          // Use the same inline execution logic as handleDismissTaskSuggestion
          // Return signal to frontend to execute inline
          return {
            ok: true,
            executeInline: true,
            decomposition: queryDecomposition,
            // Include any facts detected during workflow for deferred saving
            ...(detectedFactsDuringWorkflow.length > 0 ? { detectedFacts: detectedFactsDuringWorkflow } : {})
          };
        }
      } catch (err) {
        console.error("[QueryDecomposition] Error in decomposition flow:", err.message);
        // Fall through to normal chat flow on error
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Normal Chat Flow (full pipeline with profile, memory, skills, tools)
    // ─────────────────────────────────────────────────────────────────────────

    // Profile and conversation context already loaded above (for Query Understanding)
    
    // Check Google auth (may have been checked for calendar, but need fresh token)
    const accessToken = await getGoogleAccessToken(currentUser?.username);
    const hasGoogleTools = !!accessToken;
    const hasIMessageTools = process.platform === "darwin";

    // Load skills and find best match for user's message
    let matchedSkill = null;
    try {
      const skills = await loadAllSkills(currentUser?.username);
      if (skills.length > 0 && userMessage) {
        matchedSkill = await findBestSkill(userMessage, skills);
      }
    } catch (err) {
      console.error("[Skills] Error matching skill:", err.message);
    }

    // Build system prompt
    let systemPrompt = `You are Wovly, a warm and helpful AI assistant. You have a friendly, supportive personality.

## CRITICAL BEHAVIOR RULES
1. **RESOLVE PRONOUNS FROM CONVERSATION** - When user says "him", "her", "them", "they", "that person", "the email", etc., ALWAYS check the previous messages in this conversation to identify who/what they're referring to. If you just mentioned "jeff@wovly.ai", and user says "send an email to him", YOU KNOW "him" is jeff@wovly.ai. NEVER ask who "him" is when you just mentioned them.
2. **DO NOT over-interpret requests** - If user asks to "find" something, don't assume they want to "book" or "purchase". Just find it.
3. **DO NOT refuse tasks you CAN do** - If you have browser automation, USE IT to search the web. Never say "I cannot access flight/hotel/product information" when you have browser tools available.
4. **Take action, don't just offer options** - When user asks you to find something, actually go find it. Don't just offer to help or list what you could do.
5. **Web research is a CORE capability** - Finding flights, hotels, products, prices, news, schedules online is something you DO. Use browser automation.
6. **Ask for clarification only when necessary - If you can infer information from the conversation with reasonable confidence, don't ask for clarification.  But if confidence is low you should ask for clarification.
7. **Message retrieval is straightforward** - When asked for messages from someone: (1) look up their contact, (2) search messages across available platforms (iMessage, Slack, WhatsApp), (3) return the results. No clarification needed.
8. **Search first, filter later** - When asked about messages on a specific topic, get the messages FIRST, then filter/search within them.
9. **USE CONVERSATION CONTEXT** - The messages in this chat ARE your context. If you mentioned something 2 messages ago, USE that information. Don't pretend you don't know what the user is talking about.

## CRITICAL SECURITY RULES - CREDENTIALS
- **NEVER ask users for their login credentials, passwords, or API keys** - this is a major security violation
- NEVER include actual passwords in your responses
- If login is required, check if credentials are available (listed below) and use them automatically
- If no credentials exist for a site, tell the user: "I don't have saved credentials for this site. Please add them in the Credentials page of the app, then try again."
- If a user tries to share a password in chat, STOP them and redirect to the Credentials page

## WOVLY QUICK REFERENCE (for answering "how do I use this?" questions)
Wovly is your autonomous communication agent - a privacy-focused AI assistant that manages your inbox, replies, and follow-ups across Email, Slack, and iMessage.

**Key Features:**
- **Chat** (this interface): Talk to me naturally to send messages, check emails, schedule meetings, search the web, and more
- **Skills**: Reusable workflows and templates (email drafting, scheduling, research). View and create custom ones in the Skills page
- **Tasks**: Autonomous background workflows that run over time - great for scheduling negotiations, follow-ups, and multi-step coordination. I'll offer to create one when your request needs it
- **Memory & Profile**: I remember our conversations and learn about you. Update your profile in the About Me page
- **Integrations**: Connect Google (Gmail/Calendar), Slack, iMessage, WhatsApp, Telegram, Discord, and more in the Integrations page
- **Voice Mimic**: I learn your communication style for each recipient so messages sound like you
- **Browser Automation**: I can browse websites, fill forms, and research on your behalf

**Quick Tips:**
- Just ask naturally: "email jeff about the meeting", "what's on my calendar tomorrow", "text sarah happy birthday"
- For scheduling/follow-ups, I'll suggest creating a Task to handle the back-and-forth
- Use the fetch_documentation tool if users ask detailed "how to" questions

For detailed documentation, use the fetch_documentation tool to look up specific topics.`;

    if (profile) {
      systemPrompt += `\n\nUser Profile:\n- Name: ${profile.firstName} ${profile.lastName}\n- Occupation: ${profile.occupation || "Not specified"}\n- City: ${profile.city || "Not specified"}\n- Home Life: ${profile.homeLife || "Not specified"}`;
    }

    // Add step context for inline execution
    if (stepContext) {
      systemPrompt += `\n\n## Current Step Context\nYou are executing a specific step as part of a larger plan. Use this context from previous steps:\n${stepContext}`;
    }

    // Add conversation history context
    if (conversationContext.todayMessages || conversationContext.yesterdayMessages || conversationContext.recentSummaries) {
      systemPrompt += `\n\n## Recent Conversation History\nUse this context to provide personalized responses and recall past conversations.`;
      
      if (conversationContext.todayMessages) {
        systemPrompt += `\n\n### Earlier Today:\n${conversationContext.todayMessages}`;
      }
      
      if (conversationContext.yesterdayMessages) {
        systemPrompt += `\n\n### Yesterday:\n${conversationContext.yesterdayMessages}`;
      }
      
      if (conversationContext.recentSummaries) {
        systemPrompt += `\n\n### Summary of Recent Days (past 2 weeks):\n${conversationContext.recentSummaries}`;
      }
    }

    // Add matched skill context (Advisory Mode)
    if (matchedSkill && matchedSkill.confidence >= 0.3) {
      const skill = matchedSkill.skill;
      systemPrompt += `\n\n## Active Skill: ${skill.name}

You have expertise in this area. Use this knowledge to guide the user:

**Recommended Approach:**
${skill.procedure.map((step, i) => `${i + 1}. ${step}`).join("\n")}

**Important Constraints:**
${skill.constraints.map(c => `- ${c}`).join("\n")}

Use this as advisory guidance. When the user asks about this topic, explain the recommended process and offer to help them through each step. If they want you to execute the full process autonomously, suggest creating a task.`;
    }

    if (hasGoogleTools) {
      systemPrompt += `\n\nYou have access to Google Workspace tools (calendar, email, drive). Use them when relevant.`;
    }

    if (hasIMessageTools) {
      systemPrompt += `\n\nYou have access to iMessage/SMS tools:
- lookup_contact: Look up phone numbers from Apple Contacts by name. Use this to find someone's phone number.
- send_imessage: Send a text message. You can use a contact name directly (e.g., "Adaira") and it will auto-lookup their phone number from Contacts.
- get_recent_messages: Read recent text messages.
- search_messages: Search through message history.

When sending messages: You can pass a contact name directly to send_imessage - it will automatically look up their phone number. Always confirm with the user before sending.`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Conversation Style Context - Inject user's voice/style into prompt
    // ─────────────────────────────────────────────────────────────────────────
    
    if (conversationStyleContext && conversationStyleContext.hasHistory) {
      systemPrompt += `\n\n## YOUR VOICE FOR THIS RECIPIENT

Based on your prior messages to "${conversationStyleContext.recipient}", here is your established communication style:

**Style Guide:** ${conversationStyleContext.styleGuide}

**Example Messages You've Sent:**
${conversationStyleContext.messages.slice(0, 5).map((m, i) => `${i + 1}. "${m.substring(0, 200)}${m.length > 200 ? '...' : ''}"`).join('\n')}

**IMPORTANT:** Match this style closely when drafting the message. Use similar tone, greeting patterns, language conventions, and level of formality (${conversationStyleContext.formality}). The message should sound like it came from the user, not a generic AI.`;
    } else if (conversationStyleContext && !conversationStyleContext.hasHistory) {
      systemPrompt += `\n\n## MESSAGE STYLE NOTE

No prior message history found with "${conversationStyleContext.recipient}". Using standard professional tone. Adjust based on the context of the request.`;
    }

    // Continue with the rest of the chat flow (Slack, Weather, Browser, Task tools, LLM calls)
    // This is handled by the caller (IPC handler) since it contains provider-specific logic
    return {
      ok: true,
      continueWithFullFlow: true,
      apiKeys,
      models,
      activeProvider,
      systemPrompt,
      profile,
      accessToken,
      hasGoogleTools,
      hasIMessageTools,
      conversationContext,
      conversationStyleContext,
      matchedSkill
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Message Confirmation IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  
  // User approves sending a message
  ipcMain.handle("message:confirmationApprove", async (_event, { confirmationId }) => {
    console.log(`[Confirmation] User APPROVED message: ${confirmationId}`);
    const pending = pendingConfirmations.get(confirmationId);
    if (pending) {
      pending.resolve(true);
      return { ok: true };
    }
    return { ok: false, error: 'Confirmation not found or expired' };
  });
  
  // User rejects sending a message
  ipcMain.handle("message:confirmationReject", async (_event, { confirmationId, reason }) => {
    console.log(`[Confirmation] User REJECTED message: ${confirmationId}, reason: ${reason || 'none'}`);
    const pending = pendingConfirmations.get(confirmationId);
    if (pending) {
      pending.reject(new Error(reason || 'User cancelled sending the message'));
      return { ok: true };
    }
    return { ok: false, error: 'Confirmation not found or expired' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // External Message Processor - Same tools as main chat
  // Shared by WhatsApp, Telegram, and other chat interfaces
  // ─────────────────────────────────────────────────────────────────────────────
  
  setExternalMessageProcessor(async (text, senderId, source = "WhatsApp") => {
    console.log(`[${source}] Processing message with full tool access: "${text.substring(0, 50)}..."`);
    
    try {
      const settingsPath = await getSettingsPath(currentUser?.username);
      let apiKeys = {};
      let models = {};
      let activeProvider = "anthropic";
      
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        apiKeys = settings.apiKeys || {};
        models = settings.models || {};
        activeProvider = settings.activeProvider || "anthropic";
      } catch {
        return "Sorry, I'm not configured yet. Please set up an API key in the Wovly app.";
      }

      if (!apiKeys.anthropic && !apiKeys.openai && !apiKeys.google) {
        return "Sorry, no AI provider is configured. Please add an API key in Wovly settings.";
      }

      // Get user profile for context
      let profile = null;
      try {
        const profilePath = await getUserProfilePath(currentUser?.username);
        const markdown = await fs.readFile(profilePath, "utf8");
        profile = parseUserProfile(markdown);
      } catch {
        // No profile
      }

      // Load all integrations and tools - SAME as main chat
      const { tools, executeTool, googleAccessToken, slackAccessToken, weatherEnabled, iMessageEnabled } = 
        await loadIntegrationsAndBuildTools({
          includeProfileTools: true,
          includeTaskTools: false, // Don't create tasks from external interfaces
          includeMemoryTools: true
        });

      // Build system prompt for external chat context
      let systemPrompt = `You are Wovly, a helpful AI assistant responding via ${source}. 
Keep responses concise and conversational - ${source} messages should be brief and to the point.
You have FULL access to the user's tools including calendar, email, contacts, etc.`;

      if (profile) {
        systemPrompt += `\n\nUser Profile:\n- Name: ${profile.firstName} ${profile.lastName}\n- Occupation: ${profile.occupation || "Not specified"}\n- City: ${profile.city || "Not specified"}`;
      }

      if (googleAccessToken) {
        systemPrompt += `\n\nYou have access to Google Workspace (Calendar, Gmail, Drive). Use these tools to help the user.`;
      }

      if (iMessageEnabled) {
        systemPrompt += `\n\nYou have access to iMessage for sending texts.`;
      }

      if (slackAccessToken) {
        systemPrompt += `\n\nYou have access to Slack.`;
      }

      if (weatherEnabled) {
        systemPrompt += `\n\nYou have access to weather information.`;
      }

      const messages = [{ role: "user", content: text }];

      // Determine which provider to use
      const useProvider = apiKeys[activeProvider] ? activeProvider : 
                          apiKeys.anthropic ? "anthropic" : 
                          apiKeys.openai ? "openai" : null;

      if (!useProvider) {
        return "Sorry, no AI provider available.";
      }

      // Convert tools to the appropriate format
      const anthropicTools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      }));

      const openaiTools = tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      }));

      // Process with tool calls (up to 6 iterations)
      if (useProvider === "anthropic" && apiKeys.anthropic) {
        const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
        let currentMessages = [...messages];
        
        for (let iteration = 0; iteration < 20; iteration++) {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKeys.anthropic,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: anthropicModel,
              max_tokens: 1024,
              system: systemPrompt,
              tools: anthropicTools,
              messages: currentMessages
            })
          });

          if (!response.ok) {
            console.error("[WhatsApp] Anthropic API error:", await response.text());
            return "Sorry, I had trouble processing that. Please try again.";
          }

          const data = await response.json();
          
          // Check for end of conversation
          if (data.stop_reason === "end_turn" || !data.content.some(b => b.type === "tool_use")) {
            const textBlock = data.content.find(b => b.type === "text");
            return textBlock?.text || "I'm not sure how to respond to that.";
          }

          // Handle tool calls
          const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
          const toolResults = [];

          for (const toolUse of toolUseBlocks) {
            console.log(`[WhatsApp] Executing tool: ${toolUse.name}`);
            const result = await executeTool(toolUse.name, toolUse.input);
            // Remove screenshotDataUrl to prevent token explosion
            const { screenshotDataUrl, ...resultForLLM } = result;
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: typeof resultForLLM === 'string' ? resultForLLM : JSON.stringify(resultForLLM)
            });
          }

          currentMessages.push({ role: "assistant", content: data.content });
          currentMessages.push({ role: "user", content: toolResults });
        }
        
        return "I've completed the request but ran into some complexity. Please check the Wovly app for details.";
      }

      if (useProvider === "openai" && apiKeys.openai) {
        const openaiModel = models.openai || "gpt-4o";
        let currentMessages = [
          { role: "system", content: systemPrompt },
          ...messages
        ];
        
        for (let iteration = 0; iteration < 20; iteration++) {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKeys.openai}`
            },
            body: JSON.stringify({
              model: openaiModel,
              max_tokens: 1024,
              messages: currentMessages,
              tools: openaiTools
            })
          });

          if (!response.ok) {
            console.error("[WhatsApp] OpenAI API error:", await response.text());
            return "Sorry, I had trouble processing that. Please try again.";
          }

          const data = await response.json();
          const choice = data.choices[0];

          // Check for end of conversation
          if (choice.finish_reason === "stop" || !choice.message.tool_calls) {
            return choice.message.content || "I'm not sure how to respond to that.";
          }

          currentMessages.push(choice.message);

          // Handle tool calls
          for (const toolCall of choice.message.tool_calls) {
            const toolInput = JSON.parse(toolCall.function.arguments);
            console.log(`[WhatsApp] Executing tool: ${toolCall.function.name}`);
            const result = await executeTool(toolCall.function.name, toolInput);
            // Remove screenshotDataUrl to prevent token explosion
            const { screenshotDataUrl, ...resultForLLM } = result;

            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: typeof resultForLLM === 'string' ? resultForLLM : JSON.stringify(resultForLLM)
            });
          }
        }
        
        return "I've completed the request but ran into some complexity. Please check the Wovly app for details.";
      }

      return "Sorry, I couldn't process your message. Please try again.";
    } catch (err) {
      console.error("[WhatsApp] Message processing error:", err);
      return "Sorry, something went wrong. Please try again.";
    }
  });

  // Chat handler with agentic workflow
  ipcMain.handle("chat:send", async (_event, { messages, skipDecomposition = false, stepContext = null, workflowContext = null }) => {
    // Helper to save conversation to daily memory
    const saveConversationToMemory = async (userMsg, assistantResp) => {
      try {
        if (currentUser?.username && userMsg && assistantResp) {
          await saveToDaily(currentUser.username, userMsg, assistantResp);
        }
      } catch (err) {
        console.error("[Memory] Failed to save conversation:", err.message);
      }
    };
    
    // Helper to check for skill demo completion (Marco -> Polo test)
    // Delegates to shared helper function
    const checkSkillDemoCompletion = async (userMsg, assistantResp) => {
      await checkSkillDemoCompletionShared(userMsg, assistantResp, currentUser?.username, win);
    };
    
    // Extract user's message for memory saving
    const userMessage = messages[messages.length - 1]?.content || "";
    
    try {
      // Check if user is logged in
      if (!currentUser?.username) {
        return { ok: false, error: "Please log in to use chat. Click the logout icon and log in again." };
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // Tutorial Mode - Handle onboarding stages with isolated processing
      // ─────────────────────────────────────────────────────────────────────────
      
      // Load profile to check onboarding stage
      let profile = null;
      try {
        const profilePath = await getUserProfilePath(currentUser.username);
        const markdown = await fs.readFile(profilePath, "utf8");
        profile = parseUserProfile(markdown);
      } catch {
        // No profile yet
      }
      
      const currentStage = profile?.onboardingStage || "completed";
      
      // Check if we should use tutorial mode (isolated from task decomposition)
      if (shouldUseTutorialMode(currentStage, userMessage)) {
        console.log(`[Tutorial] Processing message in tutorial mode (stage: ${currentStage})`);
        
        // Check for stage advancement triggers
        const advancement = await checkStageAdvancement(currentStage, userMessage, {
          lastResponse: messages[messages.length - 2]?.content
        });
        
        if (advancement && advancement.shouldAdvance) {
          console.log(`[Tutorial] Advancing from ${currentStage} to ${advancement.nextStage}`);
          profile.onboardingStage = advancement.nextStage;
          const profilePath = await getUserProfilePath(currentUser.username);
          await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
          
          if (advancement.response) {
            return { ok: true, response: advancement.response };
          }
          // If no response, will continue to show next stage welcome
        }
        
        // Handle profile stage - collect user info
        if (currentStage === "profile") {
          console.log(`[Tutorial] Processing profile collection`);
          const result = await processProfileStageMessage(userMessage, profile, null);
          
          // Save the updated fields
          if (Object.keys(result.updatedFields).length > 0) {
            const profilePath = await getUserProfilePath(currentUser.username);
            Object.assign(profile, result.updatedFields);
            
            // Check if we should advance to next stage
            if (result.shouldAdvance) {
              console.log(`[Tutorial] Profile complete, advancing to task_demo`);
              profile.onboardingStage = "task_demo";
            }
            
            await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
          }
          
          // Return the response (next question or completion message)
          if (result.response) {
            // Save to memory
            await saveConversationToMemory(userMessage, result.response);
            return { ok: true, response: result.response };
          }
          
          // If shouldAdvance but no response, show next stage welcome
          if (result.shouldAdvance) {
            const welcome = getStageWelcomeMessage("task_demo", profile, "afternoon");
            await saveConversationToMemory(userMessage, welcome.message);
            return { ok: true, response: welcome.message };
          }
        }
        
        // For other tutorial stages, generate a guidance response
        const tutorialResponse = generateTutorialResponse(currentStage, userMessage, profile);
        if (tutorialResponse) {
          await saveConversationToMemory(userMessage, tutorialResponse);
          return { ok: true, response: tutorialResponse };
        }
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // Normal Processing - Use full chat pipeline
      // ─────────────────────────────────────────────────────────────────────────
      
      // Use the shared processing function
      const processResult = await processChatQuery(messages, { skipDecomposition, stepContext, workflowContext });
      
      // If decomposition returned a task suggestion, return it directly
      if (processResult.suggestTask) {
        return processResult;
      }
      
      // If there was an error, return it
      if (!processResult.ok) {
        return processResult;
      }
      
      // If we need to continue with full flow, extract the prepared context
      if (!processResult.continueWithFullFlow) {
        return processResult;
      }
      
      const { apiKeys, models, activeProvider, systemPrompt: baseSystemPrompt } = processResult;
      const { accessToken } = processResult;
      const { hasGoogleTools, hasIMessageTools } = processResult;
      
      // Build on the system prompt from processChatQuery
      let systemPrompt = baseSystemPrompt;
      const settingsPath = await getSettingsPath(currentUser?.username);

      // Weather system prompt (added before checking if enabled)
      systemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates. Use these when the user asks about weather.`;

      // Slack system prompt will be added after we check if connected

      // Check if weather is enabled
      let weatherEnabled = true; // Weather is always available (no API key needed)
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        weatherEnabled = settings.weatherEnabled !== false; // Default to enabled
      } catch {
        // Use default
      }

      // Check if Slack is connected
      let slackAccessToken = null;
      let hasSlackTools = false;
      try {
        slackAccessToken = await getSlackAccessToken(currentUser?.username);
        hasSlackTools = !!slackAccessToken;
      } catch {
        // No Slack
      }

      // Add Slack system prompt if connected
      if (hasSlackTools) {
        systemPrompt += `\n\nYou have access to Slack. You can list channels, read messages, send messages, and search for users. Always confirm before sending messages.`;
      }

      // Check if browser automation is enabled
      let hasBrowserTools = false;
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        hasBrowserTools = settings.browserEnabled === true;
      } catch {
        // Default disabled
      }

      // Get available credentials for browser login
      const availableCredentials = await getAvailableCredentialDomains();

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

      // Combine tools
      const allTools = [...profileTools, ...taskTools, ...memoryTools, ...timeTools];
      if (hasGoogleTools) allTools.push(...googleWorkspaceTools);
      if (hasIMessageTools) allTools.push(...iMessageTools);
      if (weatherEnabled) allTools.push(...weatherTools);
      if (hasSlackTools) allTools.push(...slackTools);
      // Browser tools (CDP-based)
      if (hasBrowserTools) allTools.push(...cdpBrowserTools);

      // Determine which provider to use
      const useProvider = apiKeys[activeProvider] ? activeProvider : 
                          apiKeys.anthropic ? "anthropic" : 
                          apiKeys.openai ? "openai" : 
                          apiKeys.google ? "google" : null;
      
      if (!useProvider) {
        return { ok: false, error: "No API keys configured" };
      }

      // Call LLM with tools
      if (useProvider === "anthropic" && apiKeys.anthropic) {
        const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
        let currentMessages = messages.map(m => ({ role: m.role, content: m.content }));
        
        for (let iteration = 0; iteration < 20; iteration++) {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
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

          const data = await response.json();

          if (data.stop_reason === "end_turn" || !data.content.some(b => b.type === "tool_use")) {
            const textBlock = data.content.find(b => b.type === "text");
            let responseText = textBlock?.text || "";
            // Save conversation to memory
            await saveConversationToMemory(userMessage, responseText);
            
            // Check for skill demo completion (Marco -> Polo test)
            await checkSkillDemoCompletion(userMessage, responseText);
            
            return { ok: true, response: responseText };
          }

          // Handle tool calls
          const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
          const toolResults = [];

          // Build tool executor with current context
          const chatToolExecutor = buildToolsAndExecutor({
            googleAccessToken: accessToken,
            slackAccessToken,
            weatherEnabled,
            iMessageEnabled: hasIMessageTools,
            browserEnabled: hasBrowserTools
          });

          for (const toolUse of toolUseBlocks) {
            console.log(`Tool: ${toolUse.name}`, toolUse.input);
            const result = await chatToolExecutor.executeTool(toolUse.name, toolUse.input);

            // Handle CDP browser tool screenshots - send to UI for display
            if (result.screenshotDataUrl && win && !win.isDestroyed()) {
              win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
            }

            // For browser tools with screenshots, send image to LLM so it can see the page
            const { screenshotDataUrl, ...resultForLLM } = result;
            
            if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
              // Extract base64 data from data URL for Anthropic's image format
              const base64Match = screenshotDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (base64Match) {
                const mediaType = `image/${base64Match[1]}`;
                const base64Data = base64Match[2];
                
                // Send as multipart content: text result + image
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: [
                    { type: "text", text: JSON.stringify(resultForLLM) },
                    { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } }
                  ]
                });
              } else {
                // Fallback if format doesn't match
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

          currentMessages.push({ role: "assistant", content: data.content });
          currentMessages.push({ role: "user", content: toolResults });
        }

        return { ok: false, error: "Max iterations reached" };
      }

      // OpenAI
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
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

          const data = await response.json();
          const choice = data.choices[0];

          if (choice.finish_reason === "stop" || !choice.message.tool_calls) {
            let responseText = choice.message.content || "";
            // Save conversation to memory
            await saveConversationToMemory(userMessage, responseText);
            
            // Check for skill demo completion (Marco -> Polo test)
            await checkSkillDemoCompletion(userMessage, responseText);
            
            return { ok: true, response: responseText };
          }

          currentMessages.push(choice.message);

          // Build tool executor with current context
          const openaiToolExecutor = buildToolsAndExecutor({
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

            // Handle CDP browser tool screenshots - send to UI for display
            if (result.screenshotDataUrl && win && !win.isDestroyed()) {
              win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
            }

            // For OpenAI, collect screenshots to add as a user message after tool results
            const { screenshotDataUrl, ...resultForLLM } = result;
            if (screenshotDataUrl) {
              pendingScreenshots.push(screenshotDataUrl);
              resultForLLM.screenshotAttached = true;
            }

            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(resultForLLM)
            });
          }
          
          // For OpenAI, add screenshots as a user message (vision models can see these)
          if (pendingScreenshots.length > 0) {
            const imageContent = pendingScreenshots.map(dataUrl => ({
              type: "image_url",
              image_url: { url: dataUrl, detail: "low" } // Use low detail to reduce tokens
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

      // Google Gemini
      if (useProvider === "google" && apiKeys.google) {
        const geminiModel = models.google || "gemini-1.5-pro";
        
        // Gemini doesn't support tools in the same way, so we do a simple chat
        const geminiMessages = messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));

        const response = await fetch(
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

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // Save conversation to memory
        await saveConversationToMemory(userMessage, text);
        
        // Check for skill demo completion (Marco -> Polo test)
        await checkSkillDemoCompletion(userMessage, text);
        
        return { ok: true, response: text };
      }

      return { ok: false, error: "No API key available for selected provider" };
    } catch (err) {
      console.error("Chat error:", err);
      return { ok: false, error: err.message };
    }
  });

  // Execute decomposed steps inline (when user dismisses task suggestion)
  ipcMain.handle("chat:executeInline", async (_event, { decomposition, originalMessage }) => {
    try {
      console.log(`[Chat] ========== INLINE EXECUTION STARTED ==========`);
      console.log(`[Chat] Title: ${decomposition.title}`);
      console.log(`[Chat] Steps: ${decomposition.steps?.length || 0}`);
      console.log(`[Chat] Plan: ${decomposition.plan?.length || 0} tool calls`);
      console.log(`[Chat] Original message: ${originalMessage?.substring(0, 100)}...`);
      
      // Check if we have a structured plan from the Builder (with tool + args)
      // If so, execute tools directly without LLM calls for each step
      if (decomposition.plan && decomposition.plan.length > 0 && decomposition.plan[0].tool) {
        console.log(`[Chat] Using DIRECT execution mode - executing tools without LLM`);
        
        // Send initial progress message
        if (win && win.webContents) {
          win.webContents.send("chat:newMessage", {
            role: "assistant",
            content: `🚀 **${decomposition.title}**\n\nExecuting...`,
            source: "decomposed"
          });
        }
        
        // Build tool executor with all available tools
        const accessToken = await getGoogleAccessToken(currentUser?.username).catch(() => null);
        const slackAccessToken = await getSlackAccessToken(currentUser?.username).catch(() => null);
        const settingsPath = await getSettingsPath(currentUser?.username);
        let hasBrowserTools = false;
        try {
          const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
          hasBrowserTools = settings.browserEnabled === true;
        } catch { /* default */ }
        
        const toolExecutor = buildToolsAndExecutor({
          googleAccessToken: accessToken,
          slackAccessToken,
          weatherEnabled: true,
          iMessageEnabled: process.platform === "darwin",
          browserEnabled: hasBrowserTools
        });
        
        const results = {};
        let lastResult = null;
        let lastScreenshot = null;
        
        // Execute each tool in the plan directly
        for (const planStep of decomposition.plan) {
          const { tool, args, output_var, description } = planStep;
          console.log(`[Chat] Direct exec: ${tool} - ${description}`);
          
          // Substitute variables from previous results
          let resolvedArgs = { ...args };
          if (args) {
            const argsStr = JSON.stringify(args);
            const substituted = argsStr.replace(/\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}/g, (match, stepNum, field) => {
              const prevResult = results[`step_${stepNum}`];

              // Helper to format value for JSON string substitution
              const formatValue = (value) => {
                if (Array.isArray(value)) {
                  if (value.length > 0 && typeof value[0] === 'object') {
                    return value.map(item => {
                      if (item.text && item.from && item.date) {
                        return `[${item.date}] ${item.from}: ${item.text}`;
                      }
                      return JSON.stringify(item);
                    }).join('\\n');
                  }
                  return value.join(', ');
                } else if (typeof value === 'object' && value !== null) {
                  return JSON.stringify(value);
                }
                return String(value);
              };

              // Handle nested field access (e.g., "retrieved_emails.length")
              const fields = field.split('.');
              let value = prevResult;

              for (let i = 0; i < fields.length; i++) {
                const f = fields[i];

                if (!value) {
                  console.log(`[Chat] Template variable path failed at ${f}: step_${stepNum}.${fields.slice(0, i + 1).join('.')}`);
                  break;
                }

                // Direct field match
                if (value[f] !== undefined) {
                  value = value[f];
                  continue;
                }

                // Field name variations (only for first level)
                if (i === 0) {
                  const fieldVariations = {
                    'recent_messages': 'messages',
                    'imessages': 'messages',
                    'slack_messages': 'messages',
                    'email_messages': 'messages',
                    'text_messages': 'messages',
                    'retrieved_emails': 'messages',
                    'retrieved_messages': 'messages',
                    'todays_events': 'events',
                    'formatted_messages': 'formatted',
                    'formatted': 'formatted_messages',
                    'result': 'message',
                    'message': 'result'
                  };

                  if (fieldVariations[f] && value[fieldVariations[f]] !== undefined) {
                    console.log(`[Chat] Using field variation: ${f} -> ${fieldVariations[f]}`);
                    value = value[fieldVariations[f]];
                    continue;
                  }

                  // Fallback for any *_messages field
                  if ((f.endsWith('_messages') || f.endsWith('messages')) && value.messages !== undefined) {
                    console.log(`[Chat] Using fallback: ${f} -> messages`);
                    value = value.messages;
                    continue;
                  }

                  // Last resort: use first array field if this looks like a messages field
                  if ((f.includes('message') || f.includes('email') || f.includes('event'))) {
                    const arrayField = Object.entries(value).find(([k, v]) => Array.isArray(v));
                    if (arrayField) {
                      console.log(`[Chat] Using first array field: ${f} -> ${arrayField[0]}`);
                      value = arrayField[1];
                      continue;
                    }
                  }
                }

                // If we couldn't resolve this field, give up
                console.log(`[Chat] Template variable not found: step_${stepNum}.${field}, available at level ${i}:`, value ? Object.keys(value) : 'no value');
                return match;
              }

              // Successfully resolved all fields, format the final value
              return formatValue(value);
            });
            try {
              resolvedArgs = JSON.parse(substituted);
            } catch (e) {
              console.log(`[Chat] Failed to parse substituted args: ${e.message}`);
            }
          }
          
          try {
            // Execute the tool
            const result = await toolExecutor.executeTool(tool, resolvedArgs);
            
            // Store result for variable substitution - use step index from loop
            const stepIndex = decomposition.plan.indexOf(planStep) + 1;
            results[`step_${stepIndex}`] = result;
            if (output_var) {
              results[output_var] = result;
            }
            lastResult = result;
            
            // Capture screenshots for display
            if (result.screenshotDataUrl) {
              lastScreenshot = result.screenshotDataUrl;
              if (win && !win.isDestroyed()) {
                win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
              }
            }
            
            console.log(`[Chat] Direct exec ${tool}: success=${result.success !== false}`);
            
            // Small delay between browser operations to let pages load
            if (tool.startsWith('browser_')) {
              await new Promise(r => setTimeout(r, 500));
            }
            
          } catch (err) {
            console.error(`[Chat] Direct exec ${tool} error:`, err.message);
            // Continue with other steps even if one fails
          }
        }
        
        // Generate summary response
        let response = `✅ **${decomposition.title}** - Done!`;
        if (lastResult?.summary) {
          response = `✅ ${lastResult.summary}`;
        } else if (lastResult?.url) {
          response = `✅ **${decomposition.title}**\n\nNavigated to: ${lastResult.url}`;
        }

        // Substitute any remaining template variables in the final response
        response = response.replace(/\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}/g, (match, stepNum, field) => {
          const prevResult = results[`step_${stepNum}`];

          if (!prevResult) {
            console.log(`[Chat] Template variable not found in response: step_${stepNum} (no result)`);
            return '0';
          }

          // Handle nested field access (e.g., "messages.length")
          const fields = field.split('.');
          let value = prevResult;

          for (const f of fields) {
            if (value && value[f] !== undefined) {
              value = value[f];
            } else {
              // Try field variations
              const fieldVariations = {
                'retrieved_emails': 'messages',
                'retrieved_messages': 'messages',
                'todays_events': 'events',
                'recent_messages': 'messages',
                'imessages': 'messages',
                'emails': 'messages'
              };

              if (value && fieldVariations[f] && value[fieldVariations[f]] !== undefined) {
                console.log(`[Chat] Using field variation in response: ${f} -> ${fieldVariations[f]}`);
                value = value[fieldVariations[f]];
              } else {
                console.log(`[Chat] Template variable not found in response: step_${stepNum}.${field}, available:`, prevResult ? Object.keys(prevResult) : 'no result');
                return '0';
              }
            }
          }

          // Return the value (number, string, or array length)
          if (Array.isArray(value)) {
            return String(value.length);
          }
          return String(value);
        });
        
        // Check for skill demo completion (Marco/Polo test) after inline execution
        await checkSkillDemoCompletionShared(originalMessage, response, currentUser?.username, win);
        
        return { ok: true, response };
      }
      
      // Fallback to LLM-based execution for complex tasks without pre-planned tools
      console.log(`[Chat] Using LLM execution mode`);
      
      const { steps, title } = decomposition;
      const stepResults = [];
      let accumulatedContext = {};
      let goalAchieved = false;
      
      // Token budget tracking - rough estimate
      const MAX_CONTEXT_CHARS = 15000; // ~3750 tokens, leave room for system prompt
      
      // Helper to truncate/summarize large results (especially browser snapshots)
      const truncateResult = (result, maxChars = 3000) => {
        const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        if (str.length <= maxChars) return str;
        
        // For browser snapshots, try to extract just the meaningful content
        if (str.includes('accessibility tree') || str.includes('browser_snapshot')) {
          // Extract key info and truncate
          return str.substring(0, maxChars) + `\n\n[... truncated ${str.length - maxChars} chars for token efficiency ...]`;
        }
        return str.substring(0, maxChars) + `\n\n[... truncated ...]`;
      };
      
      // Helper to compress accumulated context if too large
      const compressContext = (ctx) => {
        const compressed = {};
        let totalChars = 0;
        
        // Prioritize recent results, truncate old ones more aggressively
        const entries = Object.entries(ctx).reverse(); // Most recent first
        
        for (const [key, value] of entries) {
          const valueStr = truncateResult(value, 2000);
          if (totalChars + valueStr.length > MAX_CONTEXT_CHARS) {
            // Skip or heavily truncate old results
            const shortened = valueStr.substring(0, 500) + '... [truncated for efficiency]';
            compressed[key] = shortened;
            totalChars += shortened.length;
          } else {
            compressed[key] = valueStr;
            totalChars += valueStr.length;
          }
        }
        
        return compressed;
      };
      
      // Send initial progress message - don't promise to walk through all steps
      if (win && win.webContents) {
        win.webContents.send("chat:newMessage", {
          role: "assistant",
          content: `🚀 **Working on: ${title}**\n\nLet me handle this for you...`,
          source: "decomposed"
        });
      }
      
      // Execute each step through the FULL chat processing pipeline
      for (let i = 0; i < steps.length; i++) {
        // Check if goal was already achieved
        if (goalAchieved) {
          console.log(`[Chat] Goal achieved in previous step, skipping remaining steps`);
          break;
        }
        
        const step = steps[i];
        const stepNum = i + 1;
        
        console.log(`[Chat] Executing step ${stepNum}/${steps.length}: ${step.action}`);
        
        // Don't send individual step progress - just work on it silently
        // Only send progress for first step or long-running tasks
        if (stepNum === 1) {
          if (win && win.webContents) {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `⏳ Working on it...`,
              source: "decomposed"
            });
          }
        }
        
        // Compress accumulated context to stay within token budget
        const compressedContext = compressContext(accumulatedContext);
        
        // Build the step message with COMPRESSED context
        let contextSummary = "";
        if (Object.keys(compressedContext).length > 0) {
          const contextEntries = Object.entries(compressedContext);
          contextSummary = "\n\n## DATA FROM PREVIOUS STEPS:\n";
          for (const [key, value] of contextEntries) {
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            contextSummary += `\n### ${key}:\n${valueStr}\n`;
          }
          
          // Also extract and highlight any URLs
          const allText = JSON.stringify(compressedContext);
          const urls = allText.match(/https?:\/\/[^\s"',\]\\]+/g) || [];
          if (urls.length > 0) {
            contextSummary += `\n### IMPORTANT URLS FOUND:\n${[...new Set(urls)].map(u => `- ${u}`).join('\n')}\n`;
          }
        }
        
        // Create messages array for this step - using a single user message for clarity
        const stepMessages = [
          { role: "user", content: `Original request: "${originalMessage}"

Current step ${stepNum}/${steps.length}: "${step.action}"
${contextSummary}
INSTRUCTIONS:
1. Execute this step using available tools
2. If you can FULLY ANSWER the original request with information you already have or will retrieve, DO IT NOW
3. At the end of your response, add one of these tags:
   - [GOAL_ACHIEVED] if the user's original request has been fully answered
   - [CONTINUE] if more steps are needed

Be concise. Execute the step and provide the answer.` }
        ];
        
        try {
          // Use processChatQuery to get the full context (profile, memory, skills, system prompt)
          const contextResult = await processChatQuery(stepMessages, {
            skipDecomposition: true, // Don't re-decompose individual steps
            stepContext: Object.keys(accumulatedContext).length > 0 
              ? JSON.stringify(accumulatedContext, null, 2) 
              : null
          });
          
          // If there was an error getting context, handle it
          if (!contextResult.ok && !contextResult.continueWithFullFlow) {
            throw new Error(contextResult.error || "Failed to get context");
          }
          
          // Now execute the step using the enriched system prompt
          const { apiKeys, models, activeProvider, systemPrompt } = contextResult;
          const { accessToken } = contextResult;
          
          // Get Slack token
          const slackAccessToken = await getSlackAccessToken(currentUser?.username).catch(() => null);
          
          // Get settings for weather and browser
          const settingsPath = await getSettingsPath(currentUser?.username);
          let weatherEnabled = true;
          let hasBrowserTools = false;
          try {
            const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
            weatherEnabled = settings.weatherEnabled !== false;
            hasBrowserTools = settings.browserEnabled === true;
            if (hasBrowserTools) {
              console.log(`[Chat] Step ${stepNum}: Browser tools enabled`);
            }
          } catch (err) {
            console.error(`[Chat] Step ${stepNum}: Error loading settings:`, err.message);
          }
          
          // Build tool executor with all tools
          const { executeTool, tools: allTools } = buildToolsAndExecutor({
            googleAccessToken: accessToken,
            slackAccessToken,
            weatherEnabled,
            iMessageEnabled: process.platform === "darwin",
            browserEnabled: hasBrowserTools
          });
          
          console.log(`[Chat] Step ${stepNum} tools available: ${allTools.length}`, allTools.map(t => t.name));
          
          // Build complete system prompt with ALL tool instructions (matching chat:send)
          let fullSystemPrompt = systemPrompt;
          
          // Add Slack system prompt if connected
          if (slackAccessToken) {
            fullSystemPrompt += `\n\nYou have access to Slack tools:
- get_slack_messages: Get recent messages from a Slack channel or DM. For DMs, you can pass a person's name and it will find their DM channel automatically.
- send_slack_message: Send a message to a Slack channel or DM
- list_slack_channels: List available Slack channels
- search_slack_users: Search for Slack users by name

When getting DMs from a specific person, use get_slack_messages with their name (e.g., "Chris Gorog").`;
          }
          
          // Add Weather system prompt
          if (weatherEnabled) {
            fullSystemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates.`;
          }
          
          // Add browser automation system prompt
          if (hasBrowserTools) {
            const stepCredentials = await getAvailableCredentialDomains();
            let browserStepPrompt = `\n\n## WEB RESEARCH CAPABILITY - BROWSER TOOLS

You have browser automation via browser_* tools:
- \`browser_navigate\`: Go to URL, returns snapshot with element refs
- \`browser_click\`: Click element by ref (e.g., "e5")
- \`browser_type\`: Type text, optionally specify ref to focus
- \`browser_press\`: Press keys like "Enter"
- \`browser_snapshot\`: Get current page screenshot + elements
- \`browser_scroll\`: Scroll page up/down

**DO NOT SAY you cannot access websites. USE THE BROWSER TOOLS.**`;

            if (stepCredentials.length > 0) {
              browserStepPrompt += `

**SAVED CREDENTIALS:** ${stepCredentials.join(', ')}
If logging into these sites, use the saved credentials. **NEVER ask the user for passwords.**`;
            } else {
              browserStepPrompt += `

**NO SAVED CREDENTIALS.** If login is needed, tell user to add credentials in the Credentials page. **NEVER ask for passwords.**`;
            }
            
            fullSystemPrompt += browserStepPrompt;
            console.log(`[Chat] Step ${stepNum}: Added browser tools to prompt (credentials: ${stepCredentials.length})`);
          } else {
            console.log(`[Chat] Step ${stepNum}: Browser automation NOT enabled`);
          }
          
          // Add Google tools system prompt
          if (accessToken) {
            fullSystemPrompt += `\n\nYou have access to Google Workspace tools (calendar, email, drive). Use them when relevant.`;
          }
          
          // Add iMessage system prompt
          if (process.platform === "darwin") {
            fullSystemPrompt += `\n\nYou have access to iMessage/SMS tools for sending and reading text messages.`;
          }
          
          // Enhanced system prompt for this specific step - focused on EFFICIENCY
          const contextStr = JSON.stringify(compressedContext);
          const urlMatches = contextStr.match(/https?:\/\/[^\s"',\]]+/g) || [];
          const uniqueUrls = [...new Set(urlMatches)];
          
          const stepSystemPrompt = `${fullSystemPrompt}

## Task: ${title}

## EFFICIENCY RULES:
1. **ANSWER THE USER'S QUESTION AS SOON AS POSSIBLE** - If you have enough information to fully answer the original request, do it NOW. Don't wait for more steps.
2. **Be concise** - Provide the answer directly, no need for step-by-step narration.
3. **Use tools only when needed** - If you already have the data, don't make redundant tool calls.
4. **Use data from previous steps** - Don't re-fetch what's already available in context.

## BROWSER AUTOMATION REMINDER:
${hasBrowserTools ? `- Use browser_navigate to go to websites - it automatically returns a screenshot
- Use browser_snapshot to see the current page state
- All browser tools return visual snapshots - you can SEE what's on the page` : `- Browser automation is not enabled`}

${uniqueUrls.length > 0 ? `## URLs available:
${uniqueUrls.slice(0, 5).map(url => `- ${url}`).join('\n')}
` : ''}
## Response format:
- Give a direct, helpful answer
- End with [GOAL_ACHIEVED] if user's original request is now fully answered
- End with [CONTINUE] if more steps are genuinely needed`;

          // Execute LLM call for this step
          let stepResponse = null;
          
          if (activeProvider === "anthropic" && apiKeys.anthropic) {
            const anthropicModel = models.anthropic || "claude-sonnet-4-20250514";
            let iterationMessages = stepMessages.map(m => ({ role: m.role, content: m.content }));
            
            for (let iteration = 0; iteration < 20; iteration++) { // Increased for browser automation
              const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKeys.anthropic,
                  "anthropic-version": "2023-06-01"
                },
                body: JSON.stringify({
                  model: anthropicModel,
                  max_tokens: 4096,
                  system: stepSystemPrompt,
                  tools: allTools,
                  messages: iterationMessages
                })
              });

              if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
              }

              const data = await response.json();
              
              console.log(`[Chat] Step ${stepNum} iteration ${iteration}/15: stop_reason=${data.stop_reason}, content types=${data.content?.map(b => b.type).join(',')}`);

              if (data.stop_reason === "end_turn" || !data.content.some(b => b.type === "tool_use")) {
                const textBlock = data.content.find(b => b.type === "text");
                stepResponse = textBlock?.text || "";
                console.log(`[Chat] Step ${stepNum} completed without tool use, response length: ${stepResponse.length}`);
                break;
              }

              // Handle tool calls
              const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
              const toolResults = [];
              
              console.log(`[Chat] Step ${stepNum} has ${toolUseBlocks.length} tool calls`);

              for (const toolUse of toolUseBlocks) {
                console.log(`[Chat] Step ${stepNum} executing tool: ${toolUse.name} with input:`, JSON.stringify(toolUse.input).substring(0, 200));
                const result = await executeTool(toolUse.name, toolUse.input);
                console.log(`[Chat] Step ${stepNum} tool ${toolUse.name} result:`, JSON.stringify(result).substring(0, 300));
                
                // Handle CDP browser tool screenshots - send to UI for display
                if (result.screenshotDataUrl && win && !win.isDestroyed()) {
                  win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
                }
                
                // For browser tools with screenshots, send image to LLM
                const { screenshotDataUrl, ...resultForLLM } = result;
                
                // Truncate large results (especially browser_snapshot) to save tokens
                const truncatedResult = truncateResult(resultForLLM, toolUse.name.includes('snapshot') ? 4000 : 3000);
                accumulatedContext[`step${stepNum}_${toolUse.name}`] = truncatedResult;
                
                if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
                  // Extract base64 data from data URL for Anthropic's image format
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

              iterationMessages.push({ role: "assistant", content: data.content });
              iterationMessages.push({ role: "user", content: toolResults });
            }
          } else if (activeProvider === "openai" && apiKeys.openai) {
            // OpenAI flow (similar to Anthropic)
            const openaiModel = models.openai || "gpt-4o";
            const openaiTools = allTools.map(t => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.input_schema }
            }));

            let iterationMessages = [
              { role: "system", content: stepSystemPrompt },
              ...stepMessages.map(m => ({ role: m.role, content: m.content }))
            ];

            for (let iteration = 0; iteration < 20; iteration++) { // Increased for browser automation
              const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${apiKeys.openai}`
                },
                body: JSON.stringify({
                  model: openaiModel,
                  messages: iterationMessages,
                  tools: openaiTools
                })
              });

              if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
              }

              const data = await response.json();
              const choice = data.choices[0];

              if (choice.finish_reason === "stop" || !choice.message.tool_calls) {
                stepResponse = choice.message.content || "";
                break;
              }

              iterationMessages.push(choice.message);

              let pendingScreenshots = [];
              
              for (const toolCall of choice.message.tool_calls) {
                const toolInput = JSON.parse(toolCall.function.arguments);
                console.log(`[Chat] Step ${stepNum} tool: ${toolCall.function.name}`);
                const result = await executeTool(toolCall.function.name, toolInput);
                
                // Handle CDP browser tool screenshots - send to UI for display
                if (result.screenshotDataUrl && win && !win.isDestroyed()) {
                  win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
                }
                
                // For OpenAI, collect screenshots to add as a user message
                const { screenshotDataUrl, ...resultForLLM } = result;
                if (screenshotDataUrl) {
                  pendingScreenshots.push(screenshotDataUrl);
                  resultForLLM.screenshotAttached = true;
                }
                
                // Truncate large results to save tokens
                const truncatedResult = truncateResult(resultForLLM, toolCall.function.name.includes('snapshot') ? 4000 : 3000);
                accumulatedContext[`step${stepNum}_${toolCall.function.name}`] = truncatedResult;

                iterationMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: typeof resultForLLM === 'string' ? resultForLLM : JSON.stringify(resultForLLM)
                });
              }
              
              // For OpenAI, add screenshots as a user message (vision models can see these)
              if (pendingScreenshots.length > 0) {
                const imageContent = pendingScreenshots.map(dataUrl => ({
                  type: "image_url",
                  image_url: { url: dataUrl, detail: "low" }
                }));
                iterationMessages.push({
                  role: "user",
                  content: [
                    { type: "text", text: "Browser screenshot attached. Analyze it and continue." },
                    ...imageContent
                  ]
                });
              }
            }
          } else {
            throw new Error(`No LLM provider available (active: ${activeProvider})`);
          }
          
          // Store result
          if (stepResponse) {
            // Check for goal achievement markers
            const responseHasGoal = stepResponse.includes('[GOAL_ACHIEVED]');
            const cleanResponse = stepResponse
              .replace(/\[GOAL_ACHIEVED\]/g, '')
              .replace(/\[CONTINUE\]/g, '')
              .trim();
            
            accumulatedContext[`step${stepNum}_result`] = truncateResult(cleanResponse, 2000);
            
            stepResults.push({
              step: stepNum,
              action: step.action,
              response: cleanResponse,
              success: true
            });
            
            // Send the result to the user
            if (win && win.webContents) {
              // If goal achieved or this is the last step, just show the answer
              if (responseHasGoal || stepNum === steps.length) {
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: cleanResponse,
                  source: "decomposed"
                });
              } else {
                // For intermediate steps, show progress
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: `✅ **Step ${stepNum} complete**: ${step.action}\n\n${cleanResponse}`,
                  source: "decomposed"
                });
              }
            }
            
            // Check if goal was achieved
            if (responseHasGoal) {
              console.log(`[Chat] Goal achieved at step ${stepNum}, stopping execution`);
              goalAchieved = true;
            }
          } else {
            throw new Error("No response from LLM");
          }
          
        } catch (err) {
          console.error(`[Chat] Step ${stepNum} error:`, err);
          stepResults.push({
            step: stepNum,
            action: step.action,
            error: err.message,
            success: false
          });
          
          if (win && win.webContents) {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: `❌ **Step ${stepNum} failed**: ${err.message}`,
              source: "decomposed"
            });
          }
        }
      }
      
      // Generate final summary - only if not already sent via goal achievement
      const successfulSteps = stepResults.filter(r => r.success).length;
      const lastResult = stepResults[stepResults.length - 1];
      
      // Don't send another summary if goal was achieved (already sent the answer)
      let finalResponse = "";
      if (!goalAchieved && lastResult?.response) {
        finalResponse = lastResult.response;
      } else if (goalAchieved) {
        finalResponse = lastResult?.response || "Task completed.";
      }
      
      // Check for skill demo completion (Marco/Polo test) after LLM inline execution
      await checkSkillDemoCompletionShared(originalMessage, finalResponse, currentUser?.username, win);
      
      return {
        ok: true,
        response: finalResponse,
        executedInline: true,
        stepResults,
        goalAchievedEarly: goalAchieved && successfulSteps < steps.length
      };
    } catch (err) {
      console.error("[Chat] Inline execution error:", err);
      return { ok: false, error: err.message };
    }
  });
});

app.on("window-all-closed", async () => {
  // Clean up browser controller before quitting
  if (browserController) {
    try {
      await browserController.cleanup();
    } catch (err) {
      console.error("[App] Error cleaning up browser:", err.message);
    }
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
