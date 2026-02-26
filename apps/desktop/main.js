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
// Import performance and caching utilities
// ─────────────────────────────────────────────────────────────────────────────
const { PerformanceTracker } = require("./dist/utils/performance");
const { callLLMWithRetry } = require("./dist/utils/retry");
const { responseCache, entityCache } = require("./dist/utils/cache");

// ─────────────────────────────────────────────────────────────────────────────
// Import integration registry (NEW - modular integrations)
// ─────────────────────────────────────────────────────────────────────────────
const {
  getAllTools: getIntegrationTools,
  executeTool: executeIntegrationTool
} = require("./dist/integrations");

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
  // Insights
  saveInsights,
  loadTodayInsights,
  getLastCheckTimestamp,
  getLastCheckData,
  saveLastCheckTimestamp,
  calculateGoalsHash,
  processMessagesAndGenerateInsights,
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
  getConversationStyleContext,
  generateStyleGuide,
  // Tools
  timeTools,
  executeTimeTool,
  // Task primitive tools
  taskPrimitiveTools,
  executeTaskPrimitiveTool,
  parseTimeString,
  // LLM - Architect-Builder Decomposition
  CLASSIFIER_MODELS,
  classifyQueryComplexity,
  decomposeQuery,
  architectDecompose,
  builderMapToTools,
  validateDecomposition,
  formatDecomposedSteps,
  formatArchitectSteps,
  formatBuilderPlan,
  getToolCategories,
  // Clarification utilities
  detectClarificationResponse,
  buildEnrichedQueryFromClarification,
  filterSensitiveQuestions,
  formatClarificationQuestions,
  // Streaming
  streamAnthropicResponse,
  streamOpenAIResponse,
  // Services
  SettingsService,
  ProfileService,
  CredentialsService,
  AuthService,
  OnboardingService,
  TutorialService,
  SkillsService,
  TasksService,
  TaskMessagingService,
  TaskExecutionEngine,
  TaskSchedulerService,
  IntegrationsService,
  CalendarService,
  InsightsService,
  TelegramService,
  WhatsAppService,
  DiscordService,
  XService,
  NotionService,
  SpotifyService,
  GitHubService,
  AsanaService,
  RedditService,
  GoogleOAuthService,
  SlackOAuthService,
  WelcomeService,
} = require("./src");

// Note: BrowserController is now imported from ./src/browser/controller.js

// Global browser controller instance (module-level for reference)
let browserController = null;

// Wrapper to use imported getBrowserController
async function _getBrowserController(username) {
  browserController = await getBrowserController(username);
  return browserController;
}

// Currently logged in user (module-level for cross-function access)
let currentUser = null;

// Last welcome response (for profile question tracking)
let lastWelcomeResponse = null;

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
 * Load a setting from user's settings.json
 */
async function loadSetting(username, key, defaultValue = null) {
  try {
    const settingsPath = await getSettingsPath(username);
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    const keys = key.split('.');
    let value = settings;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }
    return value ?? defaultValue;
  } catch (err) {
    console.log(`[Settings] Failed to load setting ${key}:`, err.message);
    return defaultValue;
  }
}

/**
 * Save a setting to user's settings.json
 */
async function saveSetting(username, key, value) {
  try {
    const settingsPath = await getSettingsPath(username);
    let settings = {};
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    } catch {}
    settings[key] = value;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error(`[Settings] Failed to save setting ${key}:`, err.message);
    throw err;
  }
}

/**
 * Platform-specific handlers for sending follow-up messages
 */
const followupPlatformHandlers = {
  slack: async (contact, message, conversationId, username) => {
    const slackAccessToken = await getSlackAccessToken(username);
    if (!slackAccessToken) {
      return { success: false, error: "Slack credentials not available for follow-up" };
    }
    const { postMessage } = require("./src/integrations/slack-integration");
    return await postMessage(slackAccessToken, conversationId || contact, message);
  },

  telegram: async (contact, message, conversationId, username) => {
    const telegramBotToken = await loadSetting(username, 'telegramBotToken', null);
    if (!telegramBotToken) {
      return { success: false, error: "Telegram credentials not available for follow-up" };
    }
    const { sendMessage: sendTelegramMessage } = require("./src/integrations/telegram-integration");
    return await sendTelegramMessage(telegramBotToken, conversationId || contact, message);
  },

  discord: async (contact, message, conversationId, username) => {
    const discordAccessToken = await loadSetting(username, 'discordTokens.access_token', null);
    if (!discordAccessToken) {
      return { success: false, error: "Discord credentials not available for follow-up" };
    }
    const { sendMessage: sendDiscordMessage } = require("./src/integrations/discord-integration");
    return await sendDiscordMessage(discordAccessToken, conversationId || contact, message);
  }
};

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
// Web Scraper Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let webScraperSchedulerInterval = null;
let webScraperCheckRunning = false;

const runWebScraperCheck = async () => {
  try {
    // Prevent concurrent executions
    if (webScraperCheckRunning) {
      console.log("[WebScraper] Check already running, skipping duplicate request");
      return;
    }

    webScraperCheckRunning = true;

    if (!currentUser?.username) {
      console.log("[WebScraper] No user logged in, skipping scraper check");
      webScraperCheckRunning = false;
      return;
    }

    console.log("[WebScraper] Running scheduled scrape for custom integrations");

    const { config: configManager, WebScraper } = require("./dist/webscraper/index");
    const { getBrowserController } = require("./dist/browser");

    // Get all integrations for current user
    const integrations = await configManager.listIntegrations(currentUser.username);

    if (!integrations || integrations.length === 0) {
      console.log("[WebScraper] No custom web integrations configured");
      webScraperCheckRunning = false;
      return;
    }

    // Filter for enabled integrations only
    const enabledIntegrations = integrations.filter(integration =>
      integration.enabled !== false && integration.sessionType !== 'form'
    );

    if (enabledIntegrations.length === 0) {
      console.log("[WebScraper] No enabled integrations to scrape");
      webScraperCheckRunning = false;
      return;
    }

    console.log(`[WebScraper] Found ${enabledIntegrations.length} enabled integration(s) to scrape`);

    // Get browser controller once for all scraping operations
    const browserController = await getBrowserController(currentUser.username);
    const scraper = new WebScraper(browserController, currentUser.username);

    let totalMessages = 0;
    let successCount = 0;
    let failureCount = 0;

    // Scrape each enabled integration
    for (const integration of enabledIntegrations) {
      try {
        console.log(`[WebScraper] Scraping ${integration.siteName} (${integration.id})...`);

        // Load full config
        const siteConfig = await configManager.getIntegration(currentUser.username, integration.id);

        if (!siteConfig) {
          console.warn(`[WebScraper] Config not found for ${integration.id}`);
          failureCount++;
          continue;
        }

        // Run the scraper
        const result = await scraper.scrapeMessages(siteConfig);

        if (result.success && result.messages) {
          const messageCount = result.messages.length;
          totalMessages += messageCount;
          successCount++;
          console.log(`[WebScraper] ✓ ${integration.siteName}: ${messageCount} messages scraped`);

          // Save messages to storage
          if (messageCount > 0) {
            try {
              const { saveMessages } = require("./dist/storage/webmessages");
              const saveResult = await saveMessages(currentUser.username, integration.id, result.messages);
              console.log(`[WebScraper] Saved ${saveResult.newMessages} new messages from ${integration.siteName}`);
            } catch (err) {
              console.error(`[WebScraper] Error saving messages from ${integration.siteName}:`, err.message);
            }
          }
        } else {
          failureCount++;
          console.warn(`[WebScraper] ✗ ${integration.siteName}: ${result.error || 'Unknown error'}`);
        }

      } catch (err) {
        failureCount++;
        console.error(`[WebScraper] Error scraping ${integration.siteName}:`, err.message);
      }
    }

    console.log(`[WebScraper] Scrape complete: ${successCount} succeeded, ${failureCount} failed, ${totalMessages} total messages`);

    // Notify UI if there were new messages
    if (totalMessages > 0 && win) {
      win.webContents.send("webscraper:newMessages", {
        count: totalMessages,
        timestamp: Date.now()
      });
    }

  } catch (err) {
    console.error("[WebScraper] Scheduler error:", err.message);
  } finally {
    webScraperCheckRunning = false;
  }
};

const startWebScraperScheduler = () => {
  if (webScraperSchedulerInterval) {
    clearInterval(webScraperSchedulerInterval);
  }

  console.log("[WebScraper] Starting scraper scheduler (checking every hour)");

  // Run on schedule (every hour)
  webScraperSchedulerInterval = setInterval(async () => {
    await runWebScraperCheck();
  }, 60 * 60 * 1000); // 1 hour
};

const stopWebScraperScheduler = () => {
  if (webScraperSchedulerInterval) {
    clearInterval(webScraperSchedulerInterval);
    webScraperSchedulerInterval = null;
    console.log("[WebScraper] Stopped scraper scheduler");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Task Scheduler
// ─────────────────────────────────────────────────────────────────────────────

// Set up TaskSchedulerService dependencies
// This will be called after all dependencies are available
const initializeTaskScheduler = () => {
  TaskSchedulerService.setDependencies({
    listActiveTasks,
    getTask,
    updateTask,
    executeTaskStep: (taskId, username) => executeTaskStep(taskId, username),
    getGoogleAccessToken,
    getSlackAccessToken,
    getMessagingIntegration,
    getIMessageChatId,
    getMainWindow: () => win,
    getCurrentUser: () => currentUser,
    getSettingsPath,
    readFile: (path, encoding) => fs.readFile(path, encoding),
    checkForNewEmails,
  });
};

// Wrapper functions to match existing API
const startTaskScheduler = () => {
  initializeTaskScheduler();
  TaskSchedulerService.startScheduler();
};

const stopTaskScheduler = () => {
  TaskSchedulerService.stopScheduler();
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory Processing Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let memorySchedulerInterval = null;

const startMemoryScheduler = () => {
  if (memorySchedulerInterval) {
    clearInterval(memorySchedulerInterval);
  }

  console.log("[Memory] Starting memory scheduler (checking every 4 hours)");

  memorySchedulerInterval = setInterval(async () => {
    try {
      if (!currentUser?.username) return;
      console.log("[Memory] Scheduled memory processing for", currentUser.username);
      await processOldMemoryFiles(currentUser.username);
    } catch (err) {
      console.error("[Memory] Scheduler error:", err.message);
    }
  }, 14400000); // 4 hours
};

const stopMemoryScheduler = () => {
  if (memorySchedulerInterval) {
    clearInterval(memorySchedulerInterval);
    memorySchedulerInterval = null;
    console.log("[Memory] Stopped memory scheduler");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Insights Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let insightsSchedulerInterval = null;
let insightsCheckRunning = false;

const runInsightsCheck = async (limit = 5) => {
  try {
    // Prevent concurrent executions
    if (insightsCheckRunning) {
      console.log("[Insights] Check already running, skipping duplicate request");
      return;
    }

    insightsCheckRunning = true;

    if (!currentUser?.username) {
      console.log("[Insights] No user logged in, skipping insights check");
      insightsCheckRunning = false;
      return;
    }

    console.log(`[Insights] Running hourly check (limit: ${limit})`);

    // Load user profile to get current goals
    const profilePath = await getUserProfilePath(currentUser.username);
    const profileContent = await fs.readFile(profilePath, "utf8");
    const profile = parseUserProfile(profileContent);
    const userGoals = profile.goals || [];

    console.log(`[Insights] User has ${userGoals.length} goals`);

    // Get last check data (timestamp + goals hash)
    const lastCheckData = await getLastCheckData(currentUser.username);
    const lastCheckTimestamp = lastCheckData.lastCheckTimestamp;
    const lastGoalsHash = lastCheckData.goalsHash;

    // Calculate current goals hash
    const currentGoalsHash = calculateGoalsHash(userGoals);
    const goalsChanged = currentGoalsHash !== lastGoalsHash;

    if (goalsChanged) {
      console.log("[Insights] Goals have changed - will re-analyze recent messages");
    }

    // Determine lookback window
    // If goals changed: analyze last 24 hours to catch goal-relevant insights we might have missed
    // If goals unchanged: only process new messages since last check
    let sinceTimestamp;
    if (goalsChanged) {
      // Re-analyze last 24 hours with new goal priorities
      sinceTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      console.log(`[Insights] Re-analyzing last 24 hours due to goal changes`);
    } else {
      // Normal operation: only new messages since last check
      sinceTimestamp = lastCheckTimestamp || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }

    console.log(`[Insights] Processing messages since ${sinceTimestamp}`);

    // Get access tokens
    const googleToken = await getGoogleAccessToken(currentUser.username);
    const slackToken = await getSlackAccessToken(currentUser.username);
    const accessTokens = {
      google: googleToken,
      slack: slackToken
    };

    // Get API keys from settings
    let apiKeys = {};
    try {
      const settingsPath = await getSettingsPath(currentUser.username);
      const settingsData = await fs.readFile(settingsPath, "utf8");
      const settings = JSON.parse(settingsData);
      apiKeys = settings.apiKeys || {};
    } catch (err) {
      console.log("[Insights] No settings found, using empty API keys");
    }

    // Process messages and generate insights (goal-aware)
    const insights = await processMessagesAndGenerateInsights(
      currentUser.username,
      accessTokens,
      apiKeys,
      sinceTimestamp,
      userGoals,
      limit
    );

    // Save insights
    await saveInsights(currentUser.username, insights);

    // Save new last check timestamp and goals hash
    await saveLastCheckTimestamp(currentUser.username, new Date().toISOString(), userGoals);

    console.log(`[Insights] Check complete. Generated ${insights.length} insights.`);

    // Notify UI
    if (win && win.webContents) {
      win.webContents.send("insights:updated", { insights });
    }
  } catch (err) {
    console.error("[Insights] Error during check:", err);
  } finally {
    // Always release the lock
    insightsCheckRunning = false;
  }
};

const startInsightsScheduler = () => {
  if (insightsSchedulerInterval) {
    clearInterval(insightsSchedulerInterval);
  }

  console.log("[Insights] Starting insights scheduler (checking every hour)");

  // Note: Initial check runs on login/session restore
  // Then runs every hour
  insightsSchedulerInterval = setInterval(async () => {
    // Load user's preferred insights limit from settings
    let limit = 5; // default
    try {
      if (currentUser?.username) {
        limit = await loadSetting(currentUser.username, 'insightsLimit', 5);
      }
    } catch (err) {
      // Use default if settings not found
    }
    await runInsightsCheck(limit);
  }, 60 * 60 * 1000); // 1 hour
};

const stopInsightsScheduler = () => {
  if (insightsSchedulerInterval) {
    clearInterval(insightsSchedulerInterval);
    insightsSchedulerInterval = null;
    console.log("[Insights] Stopped insights scheduler");
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
// Conversation Style Context & Style Guide Generation
// ─────────────────────────────────────────────────────────────────────────────
// These functions have been moved to src/services/utils/conversationStyle.ts
// and are now imported at the top of this file via src/index.js
//
// - getConversationStyleContext()
// - generateStyleGuide()
// ─────────────────────────────────────────────────────────────────────────────

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

// WhatsApp connector for service dependency injection
const whatsappConnector = {
  connect: connectWhatsApp,
  disconnect: disconnectWhatsApp,
  getStatus: () => whatsappStatus,
  getQR: () => whatsappQR,
  getSocket: () => whatsappSocket,
  getSelfChatJid: () => whatsappSelfChatJid,
  getAuthDir: () => getWhatsAppAuthDir(currentUser?.username)
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
    width: 1872, // 30% wider than 1440
    height: 1170, // 30% taller than 900
    minWidth: 1331, // 30% wider than 1024
    minHeight: 910, // 30% taller than 700
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
  // Note: createWindow() moved to end of callback to ensure all IPC handlers
  // are registered before the UI loads and tries to use them

  // Set main window reference will be called after createWindow at the end

  // Set up TaskMessagingService callbacks
  TaskMessagingService.setExecuteTaskStepCallback(async (taskId, username) => {
    await executeTaskStep(taskId, username);
  });
  TaskMessagingService.setLoadIntegrationsCallback(async () => {
    return await loadIntegrationsAndBuildTools();
  });
  TaskMessagingService.setToolsRequiringConfirmation(TOOLS_REQUIRING_CONFIRMATION);

  // Process old memory files (summarize and move to longterm) - deferred until user logs in
  // This will be triggered after login via auth:login handler

  // Start schedulers
  startTaskScheduler();
  startMemoryScheduler();
  startInsightsScheduler();
  startWebScraperScheduler();

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

  console.log("[DEBUG] Checkpoint 1: After integration refresh setup");

  // Settings handlers
  // ─────────────────────────────────────────────────────────────────────────────
  // Settings Service Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  ipcMain.handle("settings:get", async () => {
    return await SettingsService.getSettings(currentUser?.username);
  });

  ipcMain.handle("settings:set", async (_event, { settings }) => {
    return await SettingsService.updateSettings(currentUser?.username, settings);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // System Utilities (macOS)
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("system:openSystemPreferences", async (_event, pane) => {
    const { exec } = require("child_process");

    let command = "open 'x-apple.systempreferences:com.apple.preference.security?Privacy'";

    if (pane === "security") {
      command = "open 'x-apple.systempreferences:com.apple.preference.security?Privacy'";
    } else if (pane === "accessibility") {
      command = "open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'";
    }

    return new Promise((resolve) => {
      exec(command, (error) => {
        if (error) {
          console.error("[System] Failed to open System Preferences:", error);
          resolve({ ok: false, error: error.message });
        } else {
          console.log("[System] Opened System Preferences");
          resolve({ ok: true });
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Service Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  ipcMain.handle("profile:get", async () => {
    return await ProfileService.getProfile(currentUser?.username);
  });

  ipcMain.handle("profile:update", async (_event, { updates }) => {
    return await ProfileService.updateProfile(currentUser?.username, updates);
  });

  ipcMain.handle("profile:needsOnboarding", async () => {
    return await ProfileService.needsOnboarding(currentUser?.username);
  });

  ipcMain.handle("profile:addFacts", async (_event, { facts, conflictResolutions }) => {
    return await ProfileService.addFacts(currentUser?.username, facts, conflictResolutions);
  });

  ipcMain.handle("profile:getMarkdown", async () => {
    return await ProfileService.getMarkdown(currentUser?.username);
  });

  ipcMain.handle("profile:saveMarkdown", async (_event, markdown) => {
    return await ProfileService.saveMarkdown(currentUser?.username, markdown);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Insights Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("insights:setLimit", async (event, { limit = 5 } = {}) => {
    return await InsightsService.setLimit(currentUser?.username, limit);
  });

  ipcMain.handle("insights:getToday", async (event, { limit = 5 } = {}) => {
    return await InsightsService.getToday(currentUser?.username, limit);
  });

  ipcMain.handle("insights:refresh", async (event, { limit = 5 } = {}) => {
    return await InsightsService.refresh(currentUser?.username, limit, runInsightsCheck);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Onboarding handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("onboarding:getStatus", async () => {
    return await OnboardingService.getStatus(currentUser?.username);
  });

  ipcMain.handle("onboarding:setStage", async (_event, { stage }) => {
    return await OnboardingService.setStage(currentUser?.username, stage);
  });

  ipcMain.handle("onboarding:skip", async () => {
    return await OnboardingService.skip(currentUser?.username);
  });

  // Skills handlers
  ipcMain.handle("skills:list", async () => {
    return await SkillsService.listSkills(currentUser?.username);
  });

  ipcMain.handle("skills:get", async (_event, { skillId }) => {
    return await SkillsService.getSkill(currentUser?.username, skillId);
  });

  ipcMain.handle("skills:save", async (_event, { skillId, content }) => {
    return await SkillsService.saveSkill(currentUser?.username, skillId, content);
  });

  ipcMain.handle("skills:delete", async (_event, { skillId }) => {
    return await SkillsService.deleteSkill(currentUser?.username, skillId);
  });

  ipcMain.handle("skills:getTemplate", async () => {
    return SkillsService.getTemplate();
  });

  // LLM-powered welcome message generator
  ipcMain.handle("welcome:generate", async () => {
    try {
      // Load settings for API keys and models
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
        // No settings file
      }

      // Check if user needs to advance from api_setup to profile stage
      if (currentUser?.username) {
        try {
          const profilePath = await getUserProfilePath(currentUser.username);
          const markdown = await fs.readFile(profilePath, "utf8");
          const profile = parseUserProfile(markdown);

          // If user is in api_setup stage and has API keys, advance to profile stage
          if (profile.onboardingStage === "api_setup") {
            const hasApiKeys = !!(
              (apiKeys.anthropic && apiKeys.anthropic.trim()) ||
              (apiKeys.openai && apiKeys.openai.trim()) ||
              (apiKeys.google && apiKeys.google.trim())
            );

            if (hasApiKeys) {
              console.log("[Welcome] User has API keys, advancing from api_setup to profile stage");
              profile.onboardingStage = "profile";
              await fs.writeFile(profilePath, serializeUserProfile(profile), "utf8");
            }
          }
        } catch (err) {
          console.error("[Welcome] Error checking onboarding stage:", err);
        }
      }

      // Call WelcomeService to generate personalized welcome message
      const welcomeResponse = await WelcomeService.generate(
        currentUser?.username,
        apiKeys,
        models,
        activeProvider,
        {
          getUserProfilePath,
          parseUserProfile,
          getGoogleAccessToken,
          getSettingsPath,
          getUserDataDir
        }
      );

      // Store for profile question tracking
      lastWelcomeResponse = welcomeResponse;

      return welcomeResponse;
    } catch (err) {
      console.error("[Welcome] Error:", err);
      return {
        ok: false,
        error: err.message,
        message: "Hello! I'm Wovly, your AI assistant. How can I help you today?"
      };
    }
  });

  // Calendar events handler
  ipcMain.handle("calendar:getEvents", async (_event, { date }) => {
    return await CalendarService.getEvents(getGoogleAccessToken, currentUser?.username, date);
  });

  // Integration test handlers
  ipcMain.handle("integrations:testGoogle", async () => {
    return await IntegrationsService.testGoogle(getGoogleAccessToken, currentUser?.username);
  });

  // Note: testSlack handler is now defined in the Slack Integration section above

  ipcMain.handle("integrations:testIMessage", async () => {
    return await IntegrationsService.testIMessage();
  });

  ipcMain.handle("integrations:enableIMessage", async () => {
    return await IntegrationsService.enableIMessage(currentUser?.username);
  });

  ipcMain.handle("integrations:disableIMessage", async () => {
    return await IntegrationsService.disableIMessage(currentUser?.username);
  });

  ipcMain.handle("integrations:getIMessageStatus", async () => {
    return await IntegrationsService.getIMessageStatus(currentUser?.username);
  });

  // Weather test handler
  ipcMain.handle("integrations:testWeather", async () => {
    return await IntegrationsService.testWeather();
  });

  // Weather enable/disable handler
  ipcMain.handle("integrations:setWeatherEnabled", async (_event, { enabled }) => {
    return await IntegrationsService.setWeatherEnabled(currentUser?.username, enabled);
  });

  ipcMain.handle("integrations:getWeatherEnabled", async () => {
    return await IntegrationsService.getWeatherEnabled(currentUser?.username);
  });

  // Browser Automation Settings (CDP)
  ipcMain.handle("integrations:getBrowserEnabled", async () => {
    return await IntegrationsService.getBrowserEnabled(currentUser?.username);
  });

  ipcMain.handle("integrations:setBrowserEnabled", async (_event, { enabled }) => {
    return await IntegrationsService.setBrowserEnabled(currentUser?.username, enabled);
  });

  // Test CDP browser
  ipcMain.handle("integrations:testBrowser", async () => {
    return await IntegrationsService.testBrowser(getBrowserController, currentUser?.username);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Credential Storage IPC Handlers
  // Secure, local-only credential management for website logins
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Credentials Service Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  ipcMain.handle("credentials:list", async () => {
    return await CredentialsService.listCredentials(currentUser?.username);
  });

  ipcMain.handle("credentials:get", async (_event, { domain, includePassword = false }) => {
    return await CredentialsService.getCredential(currentUser?.username, domain, includePassword);
  });

  ipcMain.handle("credentials:save", async (_event, { domain, displayName, username, password, notes }) => {
    return await CredentialsService.saveCredential(
      currentUser?.username,
      domain,
      displayName,
      username,
      password,
      notes
    );
  });

  ipcMain.handle("credentials:delete", async (_event, { domain }) => {
    return await CredentialsService.deleteCredential(currentUser?.username, domain);
  });

  ipcMain.handle("credentials:updateLastUsed", async (_event, { domain }) => {
    return await CredentialsService.updateLastUsed(currentUser?.username, domain);
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
  // Auth Service Setup - Configure login/logout hooks
  // ─────────────────────────────────────────────────────────────────────────────

  // currentUser is defined at module scope for cross-function access

  // Set up login hooks for background tasks
  AuthService.setLoginHooks({
    onLogin: async (username) => {
      // Process old memory files (in background)
      processOldMemoryFiles(username).catch(err => {
        console.error("[Memory] Error processing old files:", err.message);
      });

      // Resume any pending tasks (in background)
      resumeTasksOnStartup(username).catch(err => {
        console.error("[Tasks] Error resuming tasks:", err.message);
      });

      // Run event-based tasks triggered by login (in background)
      runOnLoginTasks(username).catch(err => {
        console.error("[Tasks] Error running on-login tasks:", err.message);
      });

      // Run insights check after login (in background)
      (async () => {
        try {
          const limit = await loadSetting(username, 'insightsLimit', 5);
          await runInsightsCheck(limit);
        } catch (err) {
          console.error("[Insights] Error running initial check:", err.message);
        }
      })();

      // Run web scraper check after login (in background)
      runWebScraperCheck().catch(err => {
        console.error("[WebScraper] Error running initial scrape:", err.message);
      });
    },
    onSessionRestore: async (username) => {
      // Resume tasks in background
      resumeTasksOnStartup(username).catch(err => {
        console.error("[Tasks] Error resuming tasks:", err.message);
      });

      // Run on-login event tasks in background
      runOnLoginTasks(username).catch(err => {
        console.error("[Tasks] Error running on-login tasks:", err.message);
      });

      // Run insights check in background
      (async () => {
        try {
          const limit = await loadSetting(username, 'insightsLimit', 5);
          await runInsightsCheck(limit);
        } catch (err) {
          console.error("[Insights] Error running check:", err.message);
        }
      })();

      // Run web scraper check in background
      runWebScraperCheck().catch(err => {
        console.error("[WebScraper] Error running scrape on session restore:", err.message);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth Service Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("auth:hasUsers", async () => {
    return await AuthService.hasUsers();
  });

  ipcMain.handle("auth:listUsers", async () => {
    return await AuthService.listUsers();
  });

  ipcMain.handle("auth:register", async (_event, { username, password, displayName }) => {
    return await AuthService.register(username, password, displayName);
  });
  
  // Login
  ipcMain.handle("auth:login", async (_event, { username, password }) => {
    return await AuthService.login(username, password, (user) => {
      currentUser = user;
      // Update TaskExecutionEngine with the logged-in user
      TaskExecutionEngine.setCurrentUser(user);
    });
  });
  
  // Logout
  ipcMain.handle("auth:logout", async () => {
    return await AuthService.logout(
      currentUser,
      (user) => {
        currentUser = user;
        // Clear TaskExecutionEngine user on logout
        TaskExecutionEngine.setCurrentUser(null);
      },
      [
        () => { if (currentUser?.username) credentialsCache.delete(currentUser.username); },
        () => { contactNameCache.clear(); }
      ]
    );
  });
  
  // Check current session - restores from file if not in memory
  ipcMain.handle("auth:checkSession", async () => {
    return await AuthService.checkSession(currentUser, (user) => {
      currentUser = user;
      // Update TaskExecutionEngine when session is restored
      TaskExecutionEngine.setCurrentUser(user);
    });
  });
  
  // Get current user
  ipcMain.handle("auth:getCurrentUser", async () => {
    return AuthService.getCurrentUser(currentUser);
  });

  // Google OAuth flow
  // Google OAuth
  ipcMain.handle("integrations:startGoogleOAuth", async (_event, { clientId, clientSecret }) => {
    return await GoogleOAuthService.startOAuth(currentUser?.username, clientId, clientSecret, electron.shell);
  });

  ipcMain.handle("integrations:checkGoogleAuth", async () => {
    return await GoogleOAuthService.checkAuth(currentUser?.username, getGoogleAccessToken);
  });

  // One-click Google OAuth (simplified flow)
  ipcMain.handle("integrations:connectGoogle", async () => {
    try {
      const { GoogleOAuthService: SimpleOAuthService } = require("./dist/services/GoogleOAuthService");
      const service = new SimpleOAuthService();
      const result = await service.connectGoogle();

      if (result.ok && result.tokens) {
        // Save tokens to storage
        if (!currentUser?.username) {
          return { ok: false, error: "Not logged in" };
        }

        const googleTokensPath = path.join(
          await getUserDataDir(currentUser.username),
          "google-tokens.json"
        );

        await fs.writeFile(
          googleTokensPath,
          JSON.stringify({
            access_token: result.tokens.access_token,
            refresh_token: result.tokens.refresh_token,
            expires_in: result.tokens.expires_in,
            obtained_at: Date.now(),
          }, null, 2),
          "utf8"
        );

        console.log("[GoogleOAuth] Tokens saved successfully");
        return { ok: true };
      }

      return result;
    } catch (error) {
      console.error("[GoogleOAuth] Error in connectGoogle handler:", error);
      return { ok: false, error: error.message };
    }
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

  // Slack OAuth
  ipcMain.handle("integrations:startSlackOAuth", async (_event, { clientId, clientSecret, tunnelUrl }) => {
    return await SlackOAuthService.startOAuth(currentUser?.username, clientId, clientSecret, tunnelUrl, electron.shell);
  });

  ipcMain.handle("integrations:checkSlackAuth", async () => {
    return await SlackOAuthService.checkAuth(currentUser?.username, getSlackAccessToken, getSettingsPath);
  });

  ipcMain.handle("integrations:disconnectSlack", async () => {
    return await SlackOAuthService.disconnect(currentUser?.username);
  });

  // Update the test handler
  ipcMain.handle("integrations:testSlack", async () => {
    return await IntegrationsService.testSlack(getSlackAccessToken, currentUser?.username);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Telegram IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("telegram:setToken", async (_event, { token }) => {
    return await TelegramService.setToken(currentUser?.username, token);
  });

  ipcMain.handle("telegram:checkAuth", async () => {
    return await TelegramService.checkAuth(currentUser?.username);
  });

  ipcMain.handle("telegram:disconnect", async () => {
    return await TelegramService.disconnect(currentUser?.username);
  });

  ipcMain.handle("telegram:test", async () => {
    return await TelegramService.test(currentUser?.username);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Discord IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("discord:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await DiscordService.startOAuth(
      currentUser?.username,
      clientId,
      clientSecret,
      require("electron").shell
    );
  });

  ipcMain.handle("discord:checkAuth", async () => {
    return await DiscordService.checkAuth(currentUser?.username, getDiscordAccessToken);
  });

  ipcMain.handle("discord:disconnect", async () => {
    return await DiscordService.disconnect(currentUser?.username);
  });

  ipcMain.handle("discord:test", async () => {
    return await DiscordService.test(currentUser?.username, getDiscordAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // X (Twitter) IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("x:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await XService.startOAuth(currentUser?.username, clientId, clientSecret, require("electron").shell);
  });

  ipcMain.handle("x:checkAuth", async () => {
    return await XService.checkAuth(currentUser?.username, getXAccessToken);
  });

  ipcMain.handle("x:disconnect", async () => {
    return await XService.disconnect(currentUser?.username);
  });

  ipcMain.handle("x:test", async () => {
    return await XService.test(currentUser?.username, getXAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Notion IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("notion:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await NotionService.startOAuth(currentUser?.username, clientId, clientSecret, require("electron").shell);
  });

  ipcMain.handle("notion:checkAuth", async () => {
    return await NotionService.checkAuth(currentUser?.username, getNotionAccessToken);
  });

  ipcMain.handle("notion:disconnect", async () => {
    return await NotionService.disconnect(currentUser?.username);
  });

  ipcMain.handle("notion:test", async () => {
    return await NotionService.test(currentUser?.username, getNotionAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GitHub IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // GitHub
  ipcMain.handle("github:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await GitHubService.startOAuth(currentUser?.username, clientId, clientSecret, electron.shell);
  });

  ipcMain.handle("github:checkAuth", async () => {
    return await GitHubService.checkAuth(currentUser?.username, getGitHubAccessToken);
  });

  ipcMain.handle("github:disconnect", async () => {
    return await GitHubService.disconnect(currentUser?.username);
  });

  ipcMain.handle("github:test", async () => {
    return await GitHubService.test(currentUser?.username, getGitHubAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Asana IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Asana
  ipcMain.handle("asana:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await AsanaService.startOAuth(currentUser?.username, clientId, clientSecret, electron.shell);
  });

  ipcMain.handle("asana:checkAuth", async () => {
    return await AsanaService.checkAuth(currentUser?.username, getAsanaAccessToken);
  });

  ipcMain.handle("asana:disconnect", async () => {
    return await AsanaService.disconnect(currentUser?.username);
  });

  ipcMain.handle("asana:test", async () => {
    return await AsanaService.test(currentUser?.username, getAsanaAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reddit IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Reddit
  ipcMain.handle("reddit:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await RedditService.startOAuth(currentUser?.username, clientId, clientSecret, electron.shell);
  });

  ipcMain.handle("reddit:checkAuth", async () => {
    return await RedditService.checkAuth(currentUser?.username, getRedditAccessToken);
  });

  ipcMain.handle("reddit:disconnect", async () => {
    return await RedditService.disconnect(currentUser?.username);
  });

  ipcMain.handle("reddit:test", async () => {
    return await RedditService.test(currentUser?.username, getRedditAccessToken);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Spotify IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Spotify
  ipcMain.handle("spotify:startOAuth", async (_event, { clientId, clientSecret }) => {
    return await SpotifyService.startOAuth(currentUser?.username, clientId, clientSecret, electron.shell);
  });

  ipcMain.handle("spotify:checkAuth", async () => {
    return await SpotifyService.checkAuth(currentUser?.username, getSpotifyAccessToken);
  });

  ipcMain.handle("spotify:disconnect", async () => {
    return await SpotifyService.disconnect(currentUser?.username);
  });

  ipcMain.handle("spotify:test", async () => {
    return await SpotifyService.test(currentUser?.username, getSpotifyAccessToken);
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
      const taskAdvanced = await TutorialService.checkTaskCreationAdvancement(currentUser.username);
      if (taskAdvanced && win && win.webContents) {
        // Send the skill demo prompt after task notification
        setTimeout(() => {
          win.webContents.send("chat:newMessage", {
            role: "assistant",
            content: TutorialService.getSkillDemoPromptMessage(),
            source: "app"
          });
        }, 2000);
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
    return await TasksService.listTasks(currentUser?.username);
  });

  ipcMain.handle("tasks:get", async (_event, taskId) => {
    return await TasksService.getTask(taskId, currentUser?.username);
  });

  ipcMain.handle("tasks:update", async (_event, { taskId, updates }) => {
    return await TasksService.updateTask(taskId, updates, currentUser?.username);
  });

  ipcMain.handle("tasks:cancel", async (_event, taskId) => {
    return await TasksService.cancelTask(taskId, currentUser?.username);
  });

  ipcMain.handle("tasks:hide", async (_event, taskId) => {
    return await TasksService.hideTask(taskId, currentUser?.username);
  });

  ipcMain.handle("tasks:getUpdates", async () => {
    return TasksService.getUpdates();
  });

  ipcMain.handle("tasks:getRawMarkdown", async (_event, taskId) => {
    return await TasksService.getRawMarkdown(taskId, currentUser?.username);
  });

  ipcMain.handle("tasks:saveRawMarkdown", async (_event, { taskId, markdown }) => {
    return await TasksService.saveRawMarkdown(taskId, markdown, currentUser?.username);
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
  // Web Scraper IPC Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  ipcMain.handle("webscraper:analyzeUrl", async (_event, { url, siteType }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }

      const { VisualSelectorTool, ai } = require("./dist/webscraper/index");
      const { getBrowserController } = require("./dist/browser");

      // Create a temporary page to analyze
      const browserController = await getBrowserController(currentUser.username);
      const visualTool = new VisualSelectorTool(browserController, currentUser.username);
      const sessionId = `analyze-${Date.now()}`;
      const page = await browserController.getPage(sessionId);

      // Navigate with more lenient options
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err) {
        // If navigation fails, try with load event only
        if (err.message.includes('timeout')) {
          console.log('[WebScraper] Navigation timeout, trying with load event...');
          await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {
            // If still fails, we'll work with whatever loaded
            console.log('[WebScraper] Using partially loaded page');
          });
        } else {
          throw err;
        }
      }

      // Show banner to user
      await visualTool.injectStatusBanner(page, '🔍 Analyzing page... Please wait, do not touch anything.');

      // Wait a bit for any dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we're already on a login page (has password field)
      const hasPasswordField = await page.evaluate(() => {
        return !!document.querySelector('input[type="password"]');
      });

      // If not on login page, try to find and click a login button/link
      if (!hasPasswordField) {
        console.log('[WebScraper] Not on login page, looking for login button...');

        const loginClicked = await page.evaluate(() => {
          // Look for login/sign in buttons or links
          const patterns = [
            /log\s*in/i,
            /sign\s*in/i,
            /login/i,
            /signin/i,
            /log-in/i,
            /sign-in/i,
            /member\s*login/i,
            /account\s*login/i
          ];

          // Check buttons
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          for (const btn of buttons) {
            const text = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const href = btn.getAttribute('href') || '';

            const combined = `${text} ${ariaLabel} ${href}`.toLowerCase();

            for (const pattern of patterns) {
              if (pattern.test(combined)) {
                console.log('Found login button:', text || href);
                btn.click();
                return true;
              }
            }
          }
          return false;
        });

        if (loginClicked) {
          console.log('[WebScraper] Clicked login button, waiting for login page...');

          // Wait for navigation or new content
          await Promise.race([
            page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 3000))
          ]);

          // Wait for password field to appear
          await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => {
            console.log('[WebScraper] Password field not found after clicking login button');
          });
        } else {
          console.log('[WebScraper] No login button found on page');
        }
      }

      // Use AI to generate selectors (with fallback if it fails)
      let selectors = null;
      let confidence = 'low';

      try {
        const settingsPath = await getSettingsPath(currentUser.username);
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        const apiKeys = settings.apiKeys || {};

        selectors = await ai.generateSelectorsWithAI(page, siteType, apiKeys);
        confidence = selectors.confidence;
        console.log(`[WebScraper] AI analysis complete with ${confidence} confidence`);
      } catch (aiError) {
        console.log('[WebScraper] AI analysis failed, falling back to manual setup');
        console.log('[WebScraper] Error:', aiError.message);

        // Provide empty selectors for manual setup
        selectors = {
          login: {
            usernameField: '',
            passwordField: '',
            submitButton: '',
            successIndicator: ''
          },
          navigation: [],
          messages: {
            container: '',
            messageItem: '',
            sender: '',
            content: '',
            timestamp: ''
          },
          confidence: 'low'
        };
      }

      // Get the final URL after any navigation (this is the actual login page URL)
      const finalUrl = page.url();
      console.log(`[WebScraper] Analysis complete. Final URL: ${finalUrl}`);

      // Close the page
      await page.close();

      return {
        ok: true,
        success: true,
        selectors: selectors,
        confidence: confidence,
        loginPageUrl: finalUrl, // The actual URL where the login form is
        originalUrl: url // The URL the user entered
      };
    } catch (err) {
      console.error("[WebScraper] Error analyzing URL:", err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:launchVisualSelector", async (_event, { url, options }) => {
    try {
      if (!currentUser?.username) {
        return { ok: false, error: "Not logged in" };
      }

      const { VisualSelectorTool } = require("./dist/webscraper/index");
      const { getBrowserController } = require("./dist/browser");

      const browserController = await getBrowserController(currentUser.username);
      const visualTool = new VisualSelectorTool(browserController, currentUser.username);

      // Get Google access token for 2FA email checking
      const googleAccessToken = await getGoogleAccessToken(currentUser.username);
      visualTool.setGoogleAccessToken(googleAccessToken);

      if (options.mode === 'navigation') {
        // Record navigation sequence (with auto-login if credentials provided)
        const steps = await visualTool.recordNavigationSequence(
          url,
          options.credentials || null,
          options.loginSelectors || null
        );
        return { ok: true, steps };
      } else if (options.mode === 'combined') {
        // Combined navigation + message selection flow
        const result = await visualTool.recordNavigationAndSelectMessages(
          url,
          options.credentials || null,
          options.loginSelectors || null
        );
        return { ok: true, ...result };
      } else {
        // Select a single element (with optional auto-login and navigation)
        const selector = await visualTool.selectElement(
          url,
          options.purpose,
          options.suggested,
          options.credentials || null,
          options.loginSelectors || null,
          options.navigationSteps || null
        );
        return { ok: true, selector };
      }
    } catch (err) {
      console.error("[WebScraper] Visual selector error:", err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:saveConfiguration", async (_event, { config }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { config: configManager } = require("./dist/webscraper/index");

      const savedConfig = await configManager.createIntegration(currentUser.username, config);

      // Check if 2FA automation is possible
      if (savedConfig.twoFactorAuth?.enabled) {
        const requiredIntegration = savedConfig.twoFactorAuth.requiredIntegration;
        let canAutomate = false;

        if (requiredIntegration === 'gmail') {
          const googleToken = await getGoogleAccessToken(currentUser.username).catch(() => null);
          canAutomate = !!googleToken;
        } else if (requiredIntegration === 'imessage') {
          const { SettingsService } = require('./dist/services/settings');
          const iMessageEnabled = await SettingsService.getIMessageEnabled(currentUser.username);
          canAutomate = iMessageEnabled && process.platform === 'darwin';
        }

        // Update status to indicate automation capability
        await configManager.updateStatus(currentUser.username, savedConfig.id, {
          twoFactorMode: canAutomate ? 'automated' : 'manual',
        });

        // Refresh config to get updated status
        const updatedConfig = await configManager.getIntegration(currentUser.username, savedConfig.id);
        return { success: true, config: updatedConfig };
      }

      return { success: true, config: savedConfig };
    } catch (err) {
      console.error("[WebScraper] Error saving configuration:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:listIntegrations", async () => {
    try {
      if (!currentUser?.username) {
        return { success: true, integrations: [] };
      }

      const { config: configManager } = require("./dist/webscraper/index");

      const integrations = await configManager.listIntegrations(currentUser.username);

      return { success: true, integrations };
    } catch (err) {
      console.error("[WebScraper] Error listing integrations:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:updateIntegration", async (_event, { id, updates }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { config: configManager } = require("./dist/webscraper/index");

      const updated = await configManager.updateIntegration(currentUser.username, id, updates);

      return { success: true, config: updated };
    } catch (err) {
      console.error("[WebScraper] Error updating integration:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:deleteIntegration", async (_event, { id }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { config: configManager } = require("./dist/webscraper/index");

      await configManager.deleteIntegration(currentUser.username, id);

      return { success: true };
    } catch (err) {
      console.error("[WebScraper] Error deleting integration:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:testIntegration", async (_event, { siteId }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { config: configManager, WebScraper } = require("./dist/webscraper/index");
      const { getBrowserController } = require("./dist/browser");

      // Load the integration config
      const siteConfig = await configManager.getIntegration(currentUser.username, siteId);
      if (!siteConfig) {
        return { success: false, error: "Integration not found" };
      }

      // Run the scraper
      const browserController = await getBrowserController(currentUser.username);
      const scraper = new WebScraper(browserController, currentUser.username);

      const result = await scraper.scrapeMessages(siteConfig);

      if (result.success) {
        return {
          success: true,
          messageCount: result.messages.length,
          sampleMessage: result.messages[0] || null
        };
      } else {
        return {
          success: false,
          error: result.error
        };
      }
    } catch (err) {
      console.error("[WebScraper] Error testing integration:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("webscraper:launchOAuthLogin", async (_event, { url, siteName, oauth, siteId }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { OAuthLoginHandler } = require("./dist/webscraper/oauth-login");
      const { getBrowserController } = require("./dist/browser");

      const browserController = await getBrowserController(currentUser.username);

      // Create temporary or use existing site config for OAuth login
      const tempConfig = {
        id: siteId || `temp-${Date.now()}`,
        name: siteName,
        url,
        authMethod: 'oauth',
        oauth: {
          oauthProvider: oauth?.oauthProvider || 'generic',
          loginDetectionSelector: oauth?.loginDetectionSelector,
          successDetectionSelector: oauth?.successDetectionSelector,
          requiresManualLogin: true
        }
      };

      const oauthHandler = new OAuthLoginHandler(browserController, currentUser.username);
      const result = await oauthHandler.launchManualLogin(tempConfig, { timeout: 300000 });

      return result;

    } catch (error) {
      console.error("[IPC] OAuth login error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle("webscraper:startRecording", async (_event, { url, credentialDomain, siteName }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      // Resolve credentials from secure storage
      // NOTE: getCredentialForDomain expects (domain, username) not (username, domain)
      const credential = await getCredentialForDomain(credentialDomain, currentUser.username);
      if (!credential) {
        console.log(`[Recording] No credential found for domain: ${credentialDomain}`);
        console.log(`[Recording] Available credentials:`, await getAvailableCredentialDomains());
        return {
          success: false,
          error: `No credentials found for domain: ${credentialDomain}. Please add credentials in the Credential Manager.`
        };
      }

      console.log(`[Recording] Found credential for domain: ${credentialDomain}`);

      // Load API keys for AI analysis
      let apiKeys = {};
      try {
        const settingsPath = await getSettingsPath(currentUser.username);
        const settingsData = await fs.readFile(settingsPath, "utf8");
        const settings = JSON.parse(settingsData);
        apiKeys = settings.apiKeys || {};
      } catch (err) {
        console.log("[Recording] No settings found, using empty API keys");
      }

      const { RecordingWizard } = require("./dist/webscraper/recording-wizard");
      const { getBrowserController } = require("./dist/browser");

      const browserController = await getBrowserController(currentUser.username);
      const recordingWizard = new RecordingWizard(browserController, currentUser.username);

      // Pass resolved credentials and API key to recording wizard
      const result = await recordingWizard.startRecording(
        url,
        credential.username,
        credential.password,
        siteName,
        apiKeys.anthropic || '' // Pass API key for AI analysis
      );

      return result;

    } catch (error) {
      console.error("[IPC] Recording wizard error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle("webscraper:testConfiguration", async (_event, { config }) => {
    try {
      if (!currentUser?.username) {
        return { success: false, error: "Not logged in" };
      }

      const { WebScraper } = require("./dist/webscraper/index");
      const { getBrowserController } = require("./dist/browser");

      const browserController = await getBrowserController(currentUser.username);
      const scraper = new WebScraper(browserController, currentUser.username);

      const result = await scraper.scrapeMessages(config);

      if (result.success) {
        return {
          success: true,
          messageCount: result.messages.length,
          sampleMessage: result.messages[0] || null
        };
      } else {
        return {
          success: false,
          error: result.error
        };
      }
    } catch (err) {
      console.error("[WebScraper] Test error:", err);
      return { success: false, error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Pending Message Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Approve and send a pending message from a task
  // Approve a pending message and send it
  ipcMain.handle("tasks:approvePendingMessage", async (_event, { taskId, messageId, editedMessage }) => {
    return await TaskMessagingService.approvePendingMessage(
      taskId,
      messageId,
      editedMessage,
      currentUser?.username
    );
  });

  // Reject/discard a pending message
  ipcMain.handle("tasks:rejectPendingMessage", async (_event, { taskId, messageId }) => {
    return await TaskMessagingService.rejectPendingMessage(
      taskId,
      messageId,
      currentUser?.username
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // REMOVED: Old inline implementations moved to TaskMessagingService
  // - approvePendingMessage: ~350 lines (lines 3620-3955 in old version)
  // - rejectPendingMessage: ~70 lines (lines 3958-4024 in old version)
  // Total: ~420 lines removed from main.js
  // ─────────────────────────────────────────────────────────────────────────────

  // Set auto-send preference for a task
  ipcMain.handle("tasks:setAutoSend", async (_event, { taskId, autoSend }) => {
    const result = await TasksService.setAutoSend(taskId, autoSend, currentUser?.username);
    if (result.ok) {
      addTaskUpdate(taskId, `Auto-send ${autoSend ? 'enabled' : 'disabled'}`);
    }
    return result;
  });

  // Set notifications disabled preference for a task
  ipcMain.handle("tasks:setNotificationsDisabled", async (_event, { taskId, disabled }) => {
    const result = await TasksService.setNotificationsDisabled(taskId, disabled, currentUser?.username);
    // Only notify if notifications are being enabled
    if (result.ok && !disabled) {
      addTaskUpdate(taskId, `Notifications enabled`);
    }
    return result;
  });

  // Set poll frequency for a task
  ipcMain.handle("tasks:setPollFrequency", async (_event, { taskId, pollFrequency }) => {
    const result = await TasksService.setPollFrequency(taskId, pollFrequency, currentUser?.username);
    if (result.ok && result.pollFrequency) {
      console.log(`[Tasks] Poll frequency updated for ${taskId}: next check in ${result.pollFrequency.value}ms (${result.pollFrequency.label})`);
      addTaskUpdate(taskId, `Poll frequency changed to: ${result.pollFrequency.label}`);
    }
    return result;
  });

  // Get available poll frequency presets
  ipcMain.handle("tasks:getPollFrequencyPresets", async () => {
    return TasksService.getPollFrequencyPresets();
  });

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
  const buildToolsAndExecutor = async (options = {}) => {
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
      customWebEnabled = false, // Custom web integrations
      apiKeys = null, // Add apiKeys for LLM-based tools
      includeProfileTools = true,
      includeTaskTools = true,
      includeMemoryTools = true,
      additionalTools = []
    } = options;

    // Build tools list using new integration registry
    const integrationContext = {
      currentUser,
      mainWindow: win,
      settings: {
        weatherEnabled,
        iMessageEnabled,
        browserEnabled,
        customWebEnabled
      },
      accessTokens: {
        google: googleAccessToken,
        slack: slackAccessToken,
        telegram: telegramToken,
        discord: discordAccessToken,
        x: xAccessToken,
        notion: notionAccessToken,
        github: githubAccessToken,
        asana: asanaAccessToken,
        reddit: redditAccessToken,
        spotify: spotifyAccessToken
      },
      apiKeys,
      includeProfile: includeProfileTools,
      includeTask: includeTaskTools,
      includeMemory: includeMemoryTools,
      whatsappConnector,
      browserController: async () => await _getBrowserController(currentUser?.username),
      loadCredentials: async (domain) => await loadCredentials(domain, currentUser?.username),
      executeTaskStep: null // Will be set by task executor if needed
    };

    // Get tools from integration registry (async call)
    const tools = await getIntegrationTools(integrationContext);

    // Add task primitive tools (always available for task execution)
    tools.push(...taskPrimitiveTools);

    // Add any additional custom tools
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
      
      // Task primitive tools (always available - variables, control flow, etc.)
      // These are NOT in the integration registry as they're task-specific
      if (taskPrimitiveTools.find(t => t.name === toolName)) {
        return await executeTaskPrimitiveTool(toolName, toolInput, { taskContext, mainWindow: win });
      }

      // All other tools are handled by the integration registry
      return await executeIntegrationTool(toolName, toolInput, integrationContext);
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

    // Check Custom Web Integrations
    let customWebEnabled = false;
    try {
      const { config: configManager } = require('./dist/webscraper/index');
      const sites = await configManager.listIntegrations(currentUser?.username);
      customWebEnabled = sites.length > 0;
      if (customWebEnabled) {
        console.log(`[Integrations] Custom web integrations enabled (${sites.length} site${sites.length > 1 ? 's' : ''})`);
      }
    } catch (err) {
      // No web integrations configured or error loading
      console.log('[Integrations] No custom web integrations configured');
    }

    const { tools, executeTool } = await buildToolsAndExecutor({
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
      customWebEnabled,
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
      spotifyAccessToken,
      customWebEnabled
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

  console.log("[DEBUG] Checkpoint 2: Before processChatQuery definition");

  // ─────────────────────────────────────────────────────────────────────────────
  // Set up TaskExecutionEngine (moved here to avoid temporal dead zone error)
  // ─────────────────────────────────────────────────────────────────────────────

  // Set up TaskExecutionEngine with dependency injection
  TaskExecutionEngine.setGetTaskCallback(getTask);
  TaskExecutionEngine.setUpdateTaskCallback(updateTask);
  TaskExecutionEngine.setLoadIntegrationsCallback(loadIntegrationsAndBuildTools);
  TaskExecutionEngine.setAddTaskUpdateCallback(addTaskUpdate);
  TaskExecutionEngine.setGetSettingsPathCallback(getSettingsPath);
  // NOTE: executeTool is obtained from loadIntegrationsAndBuildTools(), not passed directly
  TaskExecutionEngine.setExecuteTaskStepCallback(executeTaskStep);
  TaskExecutionEngine.setMainWindow(win);
  TaskExecutionEngine.setCurrentUser(currentUser);

  // Use TaskExecutionEngine for task execution
  setTaskExecutor(async (taskId) => {
    return await TaskExecutionEngine.executeTaskStep(taskId);
  });

  console.log("[DEBUG] TaskExecutionEngine configured successfully");

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
    let userMessage = messages[messages.length - 1]?.content || ""; // Use let since it may be reassigned during clarification
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
        
        // Check if this is the skill_demo stage
        const onboardingAdvancedMessage = await TutorialService.checkSkillCreationMessage(currentUser?.username);
        
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
    // OPTIMIZATION: Load all context in parallel for faster response
    // ─────────────────────────────────────────────────────────────────────────

    const perf = new PerformanceTracker('Query Processing');

    // ─────────────────────────────────────────────────────────────────────────
    // Multi-Turn Clarification Detection
    // ─────────────────────────────────────────────────────────────────────────

    const clarificationContext = detectClarificationResponse(messages);
    if (clarificationContext && clarificationContext.isClarificationResponse) {
      console.log("[Clarification] Detected clarification response, enriching query");
      console.log(`[Clarification] Original query: "${clarificationContext.originalQuery}"`);
      console.log(`[Clarification] Clarification: "${userMessage}"`);

      // Build enriched query from original + clarification
      const enrichedFromClarification = buildEnrichedQueryFromClarification(
        clarificationContext.originalQuery,
        userMessage,
        clarificationContext.clarificationQuestion
      );

      // Replace user message with enriched version for processing
      userMessage = enrichedFromClarification;
      console.log(`[Clarification] Enriched query: "${userMessage.substring(0, 200)}..."`);
    }

    perf.start('context_loading');

    // Load profile, memory, and calendar in parallel
    const [profile, conversationContext, todayCalendarEvents] = await Promise.all([
      // Get user profile for context
      (async () => {
        try {
          const profilePath = await getUserProfilePath(currentUser?.username);
          const markdown = await fs.readFile(profilePath, "utf8");
          return parseUserProfile(markdown);
        } catch {
          return null; // No profile
        }
      })(),

      // Load conversation context (historical memory)
      (async () => {
        try {
          if (currentUser?.username) {
            const context = await loadConversationContext(currentUser.username);
            if (!context.todayMessages && !context.yesterdayMessages && !context.recentSummaries) {
              console.log("[Memory] No conversation history found (new user or first conversation)");
            }
            return context;
          }
          return { todayMessages: "", yesterdayMessages: "", recentSummaries: "" };
        } catch (err) {
          console.error("[Memory] Error loading conversation context:", err.message);
          // Continue with empty context rather than failing the chat
          return { todayMessages: "", yesterdayMessages: "", recentSummaries: "" };
        }
      })(),

      // Get calendar events for today (if Google is connected) - helps with time references
      (async () => {
        try {
          const accessToken = await getGoogleAccessToken(currentUser?.username);
          if (accessToken) {
            const today = new Date();
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
            const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
            return await fetchCalendarEvents(accessToken, startOfDay, endOfDay);
          }
          return [];
        } catch (err) {
          console.log("[Calendar] Unable to fetch calendar for context:", err.message);
          return [];
        }
      })()
    ]);

    perf.end('context_loading');

    // ─────────────────────────────────────────────────────────────────────────
    // Response Cache Check - Return cached response for repeated queries
    // ─────────────────────────────────────────────────────────────────────────

    if (!skipDecomposition && !stepContext && !workflowContext) {
      const cachedResponse = responseCache.getCachedResponse(userMessage, currentUser?.username);
      if (cachedResponse) {
        perf.report();
        return {
          ok: true,
          response: cachedResponse.response,
          fromCache: true
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input Type Detection - Check if this is an informational statement
    // ─────────────────────────────────────────────────────────────────────────

    // Track facts detected during workflow for deferred prompting
    let detectedFactsDuringWorkflow = [];

    if (!skipDecomposition && userMessage.length > 10) {
      try {
        perf.start('input_type_detection');
        console.log("[InputType] Detecting input type...");
        const inputType = await detectInputType(userMessage, apiKeys, activeProvider);
        perf.end('input_type_detection');
        
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
        perf.start('query_understanding');
        console.log("[QueryUnderstanding] Analyzing query...");
        queryUnderstanding = await understandQuery(userMessage, {
          profile,
          conversationContext,
          calendarEvents: todayCalendarEvents,
          currentDate: new Date(),
          sessionMessages: messages // Pass current session messages for immediate context
        }, apiKeys, activeProvider);
        perf.end('query_understanding');
        
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
          
          const safeQuestions = filterSensitiveQuestions(queryUnderstanding.clarification_questions);
          
          // Only return clarification if there are still valid questions after filtering
          if (safeQuestions.length > 0) {
            console.log("[QueryUnderstanding] Clarification needed, returning to user");
            const clarificationMessage = formatClarificationQuestions(safeQuestions);
            return {
              ok: true,
              response: clarificationMessage,
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
    // Query Complexity Check - Bypass decomposition for simple queries
    // ─────────────────────────────────────────────────────────────────────────

    let shouldDecompose = !skipDecomposition;

    if (!skipDecomposition) {
      try {
        perf.start('complexity_classification');
        const complexity = await classifyQueryComplexity(enrichedQuery, apiKeys, activeProvider);
        perf.end('complexity_classification');

        // Bypass decomposition if query is simple and confidence is high
        if (!complexity.needs_decomposition && complexity.confidence > 0.7) {
          console.log("[QueryComplexity] Simple query detected, bypassing decomposition");
          console.log(`[QueryComplexity] Confidence: ${complexity.confidence}, Reasoning: ${complexity.reasoning}`);
          shouldDecompose = false;
        }
      } catch (err) {
        console.error("[QueryComplexity] Error classifying complexity:", err.message);
        // Continue with decomposition on error (safe default)
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query Decomposition - Complex queries go through Architect-Builder
    // ─────────────────────────────────────────────────────────────────────────

    if (shouldDecompose) {
      try {
        perf.start('decomposition');
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
        
        // Get tools from integration registry
        const integrationContext = {
          currentUser,
          mainWindow: win,
          settings: { weatherEnabled: true, iMessageEnabled: process.platform === "darwin", browserEnabled: hasBrowser },
          accessTokens: { google: accessToken, slack: slackToken }
        };
        const integrationTools = await getIntegrationTools(integrationContext);
        const toolsForDecomposition = [...integrationTools, ...taskPrimitiveTools];
        
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
      } finally {
        perf.end('decomposition');
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
        systemPrompt += `\n\n### Summary of Recent Days (past 30 days):\n${conversationContext.recentSummaries}`;
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

    // ─────────────────────────────────────────────────────────────────────────
    // Connected Integrations Context
    // ─────────────────────────────────────────────────────────────────────────

    // Check additional integrations
    let slackAccessToken = null;
    let hasSlackTools = false;
    let slackTeamName = null;
    try {
      slackAccessToken = await getSlackAccessToken(currentUser?.username);
      hasSlackTools = !!slackAccessToken;
      if (hasSlackTools) {
        // Get Slack team info
        try {
          const teamResponse = await fetch("https://slack.com/api/team.info", {
            headers: { "Authorization": `Bearer ${slackAccessToken}` }
          });
          if (teamResponse.ok) {
            const teamData = await teamResponse.json();
            slackTeamName = teamData.team?.name;
          }
        } catch (err) {
          console.log("[Context] Could not fetch Slack team name:", err.message);
        }
      }
    } catch {
      // No Slack
    }

    let integrationsInfo = "\n\n## Connected Integrations\n";
    let hasAnyIntegration = false;

    if (hasGoogleTools) {
      hasAnyIntegration = true;
      // Get Google user email
      let googleEmail = null;
      try {
        const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          googleEmail = userInfo.email;
        }
      } catch (err) {
        console.log("[Context] Could not fetch Google email:", err.message);
      }

      integrationsInfo += `\n**Google Workspace** (Email, Calendar, Drive)`;
      if (googleEmail) {
        integrationsInfo += `\n- Connected account: ${googleEmail}`;
        integrationsInfo += `\n- IMPORTANT: When user asks to "check emails" or "summarize emails" without specifying an account, use ${googleEmail} (the ONLY connected email account)`;
      }
      integrationsInfo += `\n- Tools: search_emails, get_email_content, get_email_contents_batch, send_email, get_calendar_events, create_calendar_event, list_drive_files\n`;
    }

    if (hasIMessageTools) {
      hasAnyIntegration = true;
      integrationsInfo += `\n**iMessage/SMS** (Apple Messages)`;
      integrationsInfo += `\n- Device: This Mac (Darwin platform)`;
      integrationsInfo += `\n- IMPORTANT: When user asks to "send a text" or "check messages" without specifying a platform, use iMessage (the primary messaging platform on this device)`;
      integrationsInfo += `\n- Tools: lookup_contact, send_imessage, get_recent_messages, search_messages`;
      integrationsInfo += `\n- Note: Can send messages by contact name (auto-looks up phone number from Apple Contacts)\n`;
    }

    if (hasSlackTools) {
      hasAnyIntegration = true;
      integrationsInfo += `\n**Slack** (Team Messaging)`;
      if (slackTeamName) {
        integrationsInfo += `\n- Connected workspace: ${slackTeamName}`;
        integrationsInfo += `\n- IMPORTANT: When user asks to "send a slack message" or "check slack" without specifying a workspace, use ${slackTeamName} (the ONLY connected workspace)`;
      }
      integrationsInfo += `\n- Tools: list_slack_channels, get_slack_messages, send_slack_message, search_slack_users`;
      integrationsInfo += `\n- Note: Always confirm before sending messages\n`;
    }

    // Check for Custom Web Integrations
    let customWebSites = [];
    try {
      const { config: configManager } = require('./dist/webscraper/index');
      customWebSites = await configManager.listIntegrations(currentUser?.username);
    } catch { /* No custom web integrations */ }

    if (customWebSites.length > 0) {
      hasAnyIntegration = true;
      const siteNames = customWebSites.map(s => s.name).join(', ');
      integrationsInfo += `\n**Custom Websites** (Messages from sites without APIs)`;
      integrationsInfo += `\n- Configured sites: ${siteNames}`;
      integrationsInfo += `\n- Tools: search_custom_web_messages, get_recent_custom_web_messages, get_custom_web_messages_by_date, list_custom_web_sites`;
      integrationsInfo += `\n- Note: These are scraped from daycare portals, tax sites, school systems, etc.\n`;
    }

    if (hasAnyIntegration) {
      systemPrompt += integrationsInfo;
      systemPrompt += `\n**Key Rule**: When user requests an action without specifying which integration to use, automatically use the ONLY connected integration of that type. Don't ask unnecessary clarifying questions if there's only one option available.\n\nExamples:`;
      systemPrompt += `\n- "check my emails" → Use ${hasGoogleTools ? 'the connected Google account' : 'N/A'} (only one email account)`;
      systemPrompt += `\n- "send a text" → Use ${hasIMessageTools ? 'iMessage' : 'N/A'} (only one SMS platform)`;
      if (hasSlackTools && slackTeamName) {
        systemPrompt += `\n- "send a slack message" → Use ${slackTeamName} workspace (only one Slack workspace)`;
      }
    }

    // Add memory tool instructions
    systemPrompt += `\n\n## MEMORY & HISTORICAL CONVERSATIONS

You have access to a complete conversation history with memory search tools. Use them proactively when:
- User asks about past conversations: "what did we discuss about X?", "when did I mention Y?"
- User asks for information that might be in past chats: "what was that link?", "what did I decide about Z?"
- You need context from more than 2 weeks ago (your passive context only goes back 2 weeks)
- User wants to see conversations from specific dates or time ranges

Available memory tools:
- search_memory: Search all past conversations by keyword (use for "did we ever discuss...")
- get_conversations_for_date: Get full conversation from specific date (use for "what did we talk about yesterday/Monday/Jan 15?")
- search_memory_between_dates: Search within date range (use for "what did we discuss last week/month?")
- list_memory_dates: See all dates with conversation history (use for "when did we first chat?")
- get_conversation_summary: Get AI summary for specific date (faster than full conversation, use for "summarize yesterday's chat")

When user asks about past conversations, USE THESE TOOLS. Don't just say "I don't recall" - actively search the memory.`;

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

  console.log("[DEBUG] Checkpoint 3: After processChatQuery definition");

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
        const anthropicModel = models.anthropic || "claude-sonnet-4-5-20250929";
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
  /**
   * Extract facts from user's response to a profile question
   * @param {string} userResponse - User's answer
   * @param {object} profileQuestion - The question that was asked
   * @param {object} apiKeys - API keys for LLM
   * @param {string} activeProvider - Active LLM provider
   * @param {object} models - Model configurations
   * @returns {Promise<Array>} Extracted facts
   */
  async function extractFactsFromProfileResponse(userResponse, profileQuestion, apiKeys, activeProvider, models) {
    try {
      const extractionPrompt = `You are extracting structured facts from a user's response to a profile question.

**Question Asked:** ${profileQuestion.question}
**Question Category:** ${profileQuestion.category}
**User's Response:** ${userResponse}

**Your Task:**
Extract concrete, factual information from the user's response. Return facts in this format:

FACT_COUNT: [number of facts, or 0 if no clear facts]
FACT_1: [structured fact statement]
FACT_2: [structured fact statement]
...

**Guidelines:**
- Only extract clear, concrete facts (not assumptions or interpretations)
- Format facts as complete statements
- For contact info: "Contact: [Name] ([Relationship]) - [Phone/Email]"
- For activities: "Activity: [Name] - [Description] ([Schedule])"
- For goals: "Goal: [Goal description]"
- For preferences: "Preference: [Type] - [Value]"
- For relationships: "Relationship: [Name] is [user's relationship to them]"
- If user declined to answer or gave vague response, return FACT_COUNT: 0

**Examples:**

Question: "Is 183-840-8240 your co-worker Dan?"
Response: "Yes, that's Dan from accounting"
Output:
FACT_COUNT: 1
FACT_1: Contact: Dan (Accounting colleague) - 183-840-8240

Question: "What are your RSM classes?"
Response: "It's a math program for my kids Essa and Nova"
Output:
FACT_COUNT: 2
FACT_1: Family: Children - Essa, Nova
FACT_2: Activity: RSM math enrichment program

Response: "I don't want to share that"
Output:
FACT_COUNT: 0

Your output:`;

      let llmResponse = "";

      // Try Anthropic
      if (activeProvider === "anthropic" && apiKeys.anthropic) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeys.anthropic,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: models.anthropic || "claude-3-5-sonnet-20241022",
            max_tokens: 300,
            temperature: 0.3,
            messages: [{ role: "user", content: extractionPrompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          llmResponse = data.content[0].text.trim();
        }
      } else if (activeProvider === "openai" && apiKeys.openai) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKeys.openai}`
          },
          body: JSON.stringify({
            model: models.openai || "gpt-4o",
            max_tokens: 300,
            temperature: 0.3,
            messages: [{ role: "user", content: extractionPrompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          llmResponse = data.choices[0].message.content.trim();
        }
      }

      // Parse response
      const countMatch = llmResponse.match(/FACT_COUNT:\s*(\d+)/i);
      if (!countMatch || parseInt(countMatch[1]) === 0) {
        return [];
      }

      const factCount = parseInt(countMatch[1]);
      const facts = [];

      for (let i = 1; i <= factCount; i++) {
        const factMatch = llmResponse.match(new RegExp(`FACT_${i}:\\s*(.+)`, 'i'));
        if (factMatch) {
          facts.push({
            content: factMatch[1].trim(),
            source: 'profile_question',
            category: profileQuestion.category
          });
        }
      }

      return facts;
    } catch (err) {
      console.error("[ProfileQuestion] Error extracting facts:", err);
      return [];
    }
  }

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

    // Extract user's message for memory saving
    const userMessage = messages[messages.length - 1]?.content || "";
    
    try {
      // Check if user is logged in
      if (!currentUser?.username) {
        return { ok: false, error: "Please log in to use chat. Click the logout icon and log in again." };
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Profile Question Response Detection
      // ─────────────────────────────────────────────────────────────────────────
      let profileFactConfirmation = null;

      if (lastWelcomeResponse?.profileQuestion && messages.length >= 2) {
        // The previous message might have been the welcome with the question
        // Check if this could be a response to that question
        const lastUserMessage = messages[messages.length - 2];
        const isLikelyResponse = lastUserMessage?.role === "assistant" &&
                                 lastUserMessage?.content?.includes("Quick question:");

        if (isLikelyResponse) {
          console.log("[ProfileQuestion] Detected potential response to profile question");

          // Load settings for API access
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
            // Use defaults
          }

          // Extract facts from response
          const extractedFacts = await extractFactsFromProfileResponse(
            userMessage,
            lastWelcomeResponse.profileQuestion,
            apiKeys,
            activeProvider,
            models
          );

          if (extractedFacts.length > 0) {
            console.log(`[ProfileQuestion] Extracted ${extractedFacts.length} facts:`, extractedFacts);

            // Save to profile
            try {
              await ProfileService.addFacts(
                currentUser.username,
                extractedFacts,
                {} // No conflict resolutions needed for profile questions
              );

              // Generate confirmation message
              const factsList = extractedFacts.map(f => f.content).join('\n- ');
              profileFactConfirmation = `✓ Got it! I've updated your profile with:\n- ${factsList}`;

              console.log("[ProfileQuestion] Facts saved to profile");
            } catch (err) {
              console.error("[ProfileQuestion] Error saving facts:", err);
            }

            // Clear the profile question so we don't try to extract again
            lastWelcomeResponse = null;
          } else {
            console.log("[ProfileQuestion] No facts extracted from response");
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Tutorial Mode - Handle onboarding stages with isolated processing
      // ─────────────────────────────────────────────────────────────────────────

      const tutorialResult = await TutorialService.processTutorialMessage(
        userMessage,
        currentUser.username,
        messages[messages.length - 2]?.content
      );

      if (tutorialResult.useTutorialMode && tutorialResult.response) {
        let response = tutorialResult.response;

        // Prepend profile fact confirmation if facts were extracted
        if (profileFactConfirmation) {
          response = profileFactConfirmation + "\n\n" + response;
        }

        await saveConversationToMemory(userMessage, response);
        return { ok: true, response };
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

      // Get tools from integration registry
      const integrationContext = {
        currentUser,
        mainWindow: win,
        settings: { weatherEnabled, iMessageEnabled: hasIMessageTools, browserEnabled: hasBrowserTools },
        accessTokens: { google: hasGoogleTools ? await getGoogleAccessToken(currentUser?.username) : null, slack: hasSlackTools ? await getSlackAccessToken(currentUser?.username) : null }
      };
      const allTools = await getIntegrationTools(integrationContext);

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
        const anthropicModel = models.anthropic || "claude-sonnet-4-5-20250929";
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
            const skillDemoResult = await TutorialService.checkSkillDemoCompletion(
              userMessage,
              responseText,
              currentUser.username
            );
            if (skillDemoResult.advanced && skillDemoResult.message && win && !win.isDestroyed()) {
              setTimeout(() => {
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: skillDemoResult.message,
                  source: "app"
                });
              }, 2000);
            }

            // Prepend profile fact confirmation if facts were extracted
            if (profileFactConfirmation) {
              responseText = profileFactConfirmation + "\n\n" + responseText;
            }

            // Cache the response for future queries
            if (!stepContext && !workflowContext) {
              responseCache.cacheResponse(userMessage, currentUser?.username, responseText);
            }

            // Log performance metrics
            perf.report();

            return { ok: true, response: responseText };
          }

          // Handle tool calls
          const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
          const toolResults = [];

          // Build tool executor with current context
          const chatToolExecutor = await buildToolsAndExecutor({
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
            const skillDemoResult = await TutorialService.checkSkillDemoCompletion(
              userMessage,
              responseText,
              currentUser.username
            );
            if (skillDemoResult.advanced && skillDemoResult.message && win && !win.isDestroyed()) {
              setTimeout(() => {
                win.webContents.send("chat:newMessage", {
                  role: "assistant",
                  content: skillDemoResult.message,
                  source: "app"
                });
              }, 2000);
            }

            // Prepend profile fact confirmation if facts were extracted
            if (profileFactConfirmation) {
              responseText = profileFactConfirmation + "\n\n" + responseText;
            }

            // Cache the response for future queries
            if (!stepContext && !workflowContext) {
              responseCache.cacheResponse(userMessage, currentUser?.username, responseText);
            }

            // Log performance metrics
            perf.report();

            return { ok: true, response: responseText };
          }

          currentMessages.push(choice.message);

          // Build tool executor with current context
          const openaiToolExecutor = await buildToolsAndExecutor({
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
        const skillDemoResult = await TutorialService.checkSkillDemoCompletion(
          userMessage,
          text,
          currentUser.username
        );
        if (skillDemoResult.advanced && skillDemoResult.message && win && !win.isDestroyed()) {
          setTimeout(() => {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: skillDemoResult.message,
              source: "app"
            });
          }, 2000);
        }

        // Cache the response for future queries
        if (!stepContext && !workflowContext) {
          responseCache.cacheResponse(userMessage, currentUser?.username, text);
        }

        // Prepend profile fact confirmation if facts were extracted
        if (profileFactConfirmation) {
          text = profileFactConfirmation + "\n\n" + text;
        }

        // Log performance metrics
        perf.report();

        return { ok: true, response: text };
      }

      return { ok: false, error: "No API key available for selected provider" };
    } catch (err) {
      console.error("Chat error:", err);
      return { ok: false, error: err.message };
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Streaming Chat Handler - Real-time response streaming
  // ───────────────────────────────────────────────────────────────────────────

  console.log("[DEBUG] About to register chat:sendStream handler");
  ipcMain.handle("chat:sendStream", async (_event, { messages, skipDecomposition = false, stepContext = null, workflowContext = null }) => {
    try {
      console.log("[StreamingChat] Starting streaming response...");

      if (!currentUser?.username) {
        return { ok: false, error: "Please log in to use chat" };
      }

      // Extract user message for memory saving later
      const userMessage = messages[messages.length - 1]?.content || "";

      // Use the shared processing function to get context, tools, and system prompt
      // Skip decomposition in streaming mode to keep responses fast and simple
      const processResult = await processChatQuery(messages, {
        skipDecomposition: true,  // Always skip decomposition in streaming mode
        stepContext,
        workflowContext
      });

      // If processChatQuery returned a result that doesn't need full flow, return it directly
      // (e.g., tutorial response, routed to task, etc.)
      if (!processResult.continueWithFullFlow) {
        return processResult;
      }

      // Extract prepared context from processChatQuery
      const { apiKeys, models, activeProvider, systemPrompt: baseSystemPrompt } = processResult;
      const { accessToken, hasGoogleTools, hasIMessageTools } = processResult;

      // Build on the system prompt from processChatQuery
      let systemPrompt = baseSystemPrompt;
      const settingsPath = await getSettingsPath(currentUser?.username);

      // Weather system prompt
      systemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates. Use these when the user asks about weather.`;

      // Check if weather is enabled
      let weatherEnabled = true;
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
        weatherEnabled = settings.weatherEnabled !== false;
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

      // Get tools from integration registry
      const integrationContext = {
        currentUser,
        mainWindow: win,
        settings: { weatherEnabled, iMessageEnabled: hasIMessageTools, browserEnabled: hasBrowserTools },
        accessTokens: { google: hasGoogleTools ? await getGoogleAccessToken(currentUser?.username) : null, slack: hasSlackTools ? await getSlackAccessToken(currentUser?.username) : null }
      };
      const allTools = await getIntegrationTools(integrationContext);

      console.log(`[StreamingChat] Tools available: ${allTools.length}`, allTools.map(t => t.name));

      // Convert messages to API format
      const conversationMessages = messages.filter(m => m.role !== 'system');

      if (activeProvider === 'anthropic' && apiKeys.anthropic) {
        const model = models.anthropic || 'claude-sonnet-4-5-20250929';

        // Tool execution loop - continue streaming until no more tool uses
        let currentMessages = [...conversationMessages];
        const maxIterations = 10;

        for (let iteration = 0; iteration < maxIterations; iteration++) {
          console.log(`[StreamingChat] Iteration ${iteration + 1}/${maxIterations}`);

          const toolUseQueue = [];
          let streamResult = null;

          await streamAnthropicResponse(
            {
              apiKey: apiKeys.anthropic,
              model,
              maxTokens: 4096,
              system: systemPrompt,
              messages: currentMessages,
              tools: allTools
            },
            // onDelta - send each text chunk to UI
            (delta, fullText) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send('chat:stream:delta', { delta, fullText });
              }
            },
            // onToolUse - queue tool for execution after stream completes
            (toolUse) => {
              console.log('[StreamingChat] Tool use detected:', toolUse.name);
              toolUseQueue.push(toolUse);
            },
            // onComplete - save result
            (result) => {
              streamResult = result;
            }
          );

          // If no tool uses, we're done - save to memory and complete
          if (toolUseQueue.length === 0) {
            console.log('[StreamingChat] No more tool uses, completing');

            // Save to memory
            try {
              if (currentUser?.username && userMessage && streamResult?.text) {
                await saveToDaily(currentUser.username, userMessage, streamResult.text);
              }
            } catch (err) {
              console.error("[Memory] Failed to save:", err.message);
            }

            if (win && !win.isDestroyed()) {
              win.webContents.send('chat:stream:complete', {
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
          const toolResults = [];

          // Build tool executor
          const chatToolExecutor = await buildToolsAndExecutor({
            googleAccessToken: accessToken,
            slackAccessToken,
            weatherEnabled,
            iMessageEnabled: hasIMessageTools,
            browserEnabled: hasBrowserTools,
            apiKeys
          });

          for (const toolUse of toolUseQueue) {
            try {
              // Parse tool input if it's a string
              const toolInput = typeof toolUse.input === 'string'
                ? JSON.parse(toolUse.input)
                : toolUse.input;

              // Execute the tool
              const result = await chatToolExecutor.executeTool(toolUse.name, toolInput);
              console.log('[StreamingChat] Tool result:', result);

              // Send tool execution to UI for display
              if (win && !win.isDestroyed()) {
                win.webContents.send('chat:stream:tool', {
                  toolUse,
                  result,
                  screenshotDataUrl: result.screenshotDataUrl
                });
              }

              // Handle browser screenshots
              if (result.screenshotDataUrl && win && !win.isDestroyed()) {
                win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
              }

              // Prepare tool result for LLM (remove screenshot data URL)
              const { screenshotDataUrl, ...resultForLLM } = result;

              if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
                // Include image in tool result for vision-enabled models
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
            } catch (err) {
              console.error('[StreamingChat] Tool execution error:', err);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: err.message }),
                is_error: true
              });
            }
          }

          // Add assistant message with tool uses and user message with tool results
          // streamResult.contentBlocks contains the full ordered array of text + tool_use blocks
          // Ensure all tool_use blocks have object inputs (not strings)
          const assistantContent = (streamResult.contentBlocks || []).map(block => {
            if (block.type === 'tool_use') {
              // Ensure input is an object
              if (typeof block.input === 'string') {
                console.warn('[StreamingChat] Tool input is still a string, parsing:', block.name);
                try {
                  return { ...block, input: JSON.parse(block.input) };
                } catch (e) {
                  console.error('[StreamingChat] Failed to parse tool input:', e.message);
                  return { ...block, input: {} };
                }
              }
              // Ensure input exists
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
          });
          currentMessages.push({
            role: "user",
            content: toolResults
          });

          // Continue to next iteration to get LLM's response to tool results
        }

        // Max iterations reached
        console.error('[StreamingChat] Max iterations reached without completion');
        if (win && !win.isDestroyed()) {
          win.webContents.send('chat:stream:error', {
            error: 'Max iterations reached'
          });
        }

        return { ok: false, error: 'Max iterations reached' };

      } else if (activeProvider === 'openai' && apiKeys.openai) {
        const model = models.openai || 'gpt-4o';

        // Convert to OpenAI format
        const openaiMessages = [
          { role: 'system', content: systemPrompt },
          ...conversationMessages
        ];

        await streamOpenAIResponse(
          {
            apiKey: apiKeys.openai,
            model,
            maxTokens: 4096,
            messages: openaiMessages,
            tools: allTools // Pass all available tools for streaming
          },
          // onDelta
          (delta, fullText) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('chat:stream:delta', { delta, fullText });
            }
          },
          // onToolCall
          async (toolCall) => {
            console.log('[StreamingChat] Tool call:', toolCall.function.name, toolCall.function.arguments);

            // Build tool executor with current context
            const chatToolExecutor = await buildToolsAndExecutor({
              googleAccessToken: accessToken,
              slackAccessToken,
              weatherEnabled,
              iMessageEnabled: hasIMessageTools,
              browserEnabled: hasBrowserTools,
              apiKeys
            });

            try {
              // Parse arguments
              const toolInput = JSON.parse(toolCall.function.arguments);

              // Execute the tool
              const result = await chatToolExecutor.executeTool(toolCall.function.name, toolInput);
              console.log('[StreamingChat] Tool result:', result);

              // Send tool execution result to UI
              if (win && !win.isDestroyed()) {
                win.webContents.send('chat:stream:tool', {
                  toolCall,
                  result,
                  screenshotDataUrl: result.screenshotDataUrl
                });
              }

              // Handle CDP browser tool screenshots - send to UI for display
              if (result.screenshotDataUrl && win && !win.isDestroyed()) {
                win.webContents.send("chat:screenshot", { dataUrl: result.screenshotDataUrl });
              }

              return result;
            } catch (err) {
              console.error('[StreamingChat] Tool execution error:', err);
              return { error: err.message };
            }
          },
          // onComplete
          async (result) => {
            console.log('[StreamingChat] Stream complete');

            // Save to memory
            try {
              if (currentUser?.username && userMessage && result.text) {
                await saveToDaily(currentUser.username, userMessage, result.text);
              }
            } catch (err) {
              console.error("[Memory] Failed to save:", err.message);
            }

            if (win && !win.isDestroyed()) {
              win.webContents.send('chat:stream:complete', {
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

    } catch (err) {
      console.error("[StreamingChat] Error:", err);

      // Send error to UI
      if (win && !win.isDestroyed()) {
        win.webContents.send('chat:stream:error', { error: err.message });
      }

      return { ok: false, error: err.message };
    }
  });
  console.log("[DEBUG] chat:sendStream handler registered successfully");

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
        let apiKeys = {};
        try {
          const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
          hasBrowserTools = settings.browserEnabled === true;
          apiKeys = settings.apiKeys || {};
        } catch { /* default */ }

        const toolExecutor = await buildToolsAndExecutor({
          googleAccessToken: accessToken,
          slackAccessToken,
          weatherEnabled: true,
          iMessageEnabled: process.platform === "darwin",
          browserEnabled: hasBrowserTools,
          apiKeys
        });
        
        const results = {};
        let lastResult = null;
        let lastScreenshot = null;
        
        // Execute each tool in the plan directly
        for (const planStep of decomposition.plan) {
          const { tool, args, output_var, description } = planStep;
          console.log(`[Chat] Direct exec: ${tool} - ${description}`);

          // Substitute variables from previous results using object-level substitution
          let resolvedArgs = { ...args };
          if (args) {
            // Helper to resolve a template variable
            const resolveVariable = (match, stepNum, field) => {
              const prevResult = results[`step_${stepNum}`];
              if (!prevResult) {
                console.log(`[Chat] Template variable not found: step_${stepNum} (no result)`);
                return null;
              }

              // Handle nested field access (e.g., "retrieved_emails.messages")
              const fields = field.split('.');
              let value = prevResult;

              for (let i = 0; i < fields.length; i++) {
                const f = fields[i];

                if (!value) {
                  console.log(`[Chat] Template variable path failed at ${f}: step_${stepNum}.${fields.slice(0, i + 1).join('.')}`);
                  return null;
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
                    'email_results': 'messages',
                    'todays_events': 'events',
                    'formatted_messages': 'formatted',
                    'formatted': 'formatted_messages',
                    'result': 'message',
                    'message': 'result',
                    'summary_report': 'formatted',
                    'report': 'formatted',
                    'summary': 'formatted',
                    'output': 'formatted',
                    'content': 'formatted'
                  };

                  if (fieldVariations[f] && value[fieldVariations[f]] !== undefined) {
                    console.log(`[Chat] Using field variation: ${f} -> ${fieldVariations[f]}`);
                    value = value[fieldVariations[f]];
                    continue;
                  }

                  // Fallback for any *_messages field
                  if ((f.endsWith('_messages') || f.endsWith('messages') || f.endsWith('_results') || f.endsWith('results')) && value.messages !== undefined) {
                    console.log(`[Chat] Using fallback: ${f} -> messages`);
                    value = value.messages;
                    continue;
                  }

                  // Fallback for output variable names (summary_report, report, etc.) - try common output fields
                  if (f.includes('summary') || f.includes('report') || f.includes('output') || f.includes('content')) {
                    // Try formatted first, then result, then message
                    const tryFields = ['formatted', 'result', 'message', 'formatted_messages'];
                    let found = false;
                    for (const tryField of tryFields) {
                      if (value[tryField] !== undefined) {
                        console.log(`[Chat] Using output fallback: ${f} -> ${tryField}`);
                        value = value[tryField];
                        found = true;
                        break;
                      }
                    }
                    if (found) continue;
                  }

                  // Last resort: use first array field if this looks like a messages field
                  if ((f.includes('message') || f.includes('email') || f.includes('event') || f.includes('result'))) {
                    const arrayField = Object.entries(value).find(([k, v]) => Array.isArray(v));
                    if (arrayField) {
                      console.log(`[Chat] Using first array field: ${f} -> ${arrayField[0]}`);
                      value = arrayField[1];
                      continue;
                    }
                  }

                  // Generic fallback for ANY unknown field name (like custom output_var names)
                  // Try standard output fields that tools typically return
                  if (i === 0) { // Only for top-level access
                    const standardFields = ['formatted', 'result', 'analysis', 'message', 'data', 'output', 'content'];
                    let found = false;
                    for (const tryField of standardFields) {
                      if (value[tryField] !== undefined) {
                        console.log(`[Chat] Using standard field fallback: ${f} -> ${tryField} (custom output_var not found)`);
                        value = value[tryField];
                        found = true;
                        break;
                      }
                    }
                    if (found) continue;
                  }
                }

                // If we couldn't resolve this field, give up
                console.log(`[Chat] Template variable not found: step_${stepNum}.${field}, available at level ${i}:`, value ? Object.keys(value) : 'no value');
                return null;
              }

              return value;
            };

            // Recursively substitute templates in the args object
            const substituteInObject = (obj) => {
              if (typeof obj === 'string') {
                // Check if entire string is a template variable
                const fullMatch = obj.match(/^\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}$/);
                if (fullMatch) {
                  const value = resolveVariable(fullMatch[0], fullMatch[1], fullMatch[2]);
                  return value !== null ? value : obj; // Keep original if resolution fails
                }

                // Otherwise do string substitution for embedded templates
                return obj.replace(/\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}/g, (match, stepNum, field) => {
                  const value = resolveVariable(match, stepNum, field);
                  if (value === null) return match;

                  // Format for string embedding
                  if (Array.isArray(value)) {
                    if (value.length > 0 && typeof value[0] === 'object') {
                      return value.map(item => {
                        if (item.text && item.from && item.date) {
                          return `[${item.date}] ${item.from}: ${item.text}`;
                        }
                        return JSON.stringify(item);
                      }).join('\n');
                    }
                    return value.join(', ');
                  } else if (typeof value === 'object' && value !== null) {
                    return JSON.stringify(value);
                  }
                  return String(value);
                });
              } else if (Array.isArray(obj)) {
                return obj.map(item => substituteInObject(item));
              } else if (typeof obj === 'object' && obj !== null) {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                  result[key] = substituteInObject(value);
                }
                return result;
              }
              return obj;
            };

            resolvedArgs = substituteInObject(args);
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
        const skillDemoResult = await TutorialService.checkSkillDemoCompletion(
          originalMessage,
          response,
          currentUser.username
        );
        if (skillDemoResult.advanced && skillDemoResult.message && win && !win.isDestroyed()) {
          setTimeout(() => {
            win.webContents.send("chat:newMessage", {
              role: "assistant",
              content: skillDemoResult.message,
              source: "app"
            });
          }, 2000);
        }
        
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
            browserEnabled: hasBrowserTools,
            apiKeys
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
            const anthropicModel = models.anthropic || "claude-sonnet-4-5-20250929";
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
      const skillDemoResult = await TutorialService.checkSkillDemoCompletion(
        originalMessage,
        finalResponse,
        currentUser.username
      );
      if (skillDemoResult.advanced && skillDemoResult.message && win && !win.isDestroyed()) {
        setTimeout(() => {
          win.webContents.send("chat:newMessage", {
            role: "assistant",
            content: skillDemoResult.message,
            source: "app"
          });
        }, 2000);
      }
      
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

  console.log("[DEBUG] All IPC handlers registered successfully");

  // Now create and show the window - handlers are ready!
  createWindow();
  setMainWindow(win);

  console.log("[DEBUG] app.whenReady callback completed - window created");
});

app.on("window-all-closed", async () => {
  // Clean up schedulers
  stopTaskScheduler();
  stopMemoryScheduler();
  stopInsightsScheduler();

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
