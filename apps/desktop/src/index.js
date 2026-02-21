/**
 * Main Module Entry Point
 * Re-exports all modularized functionality for easy importing
 * 
 * Usage in main.js:
 *   const { getUserDataDir, saveSession, createTask } = require("./src");
 */

// Utils (compiled TypeScript from dist folder)
const utils = require("../dist/utils/helpers");
const toolFormatter = require("../dist/utils/toolFormatter");
const entityExtractor = require("../dist/utils/entityExtractor");
const clarification = require("../dist/utils/clarification");
const streaming = require("../dist/utils/streaming");

// Auth
const session = require("./auth/session");

// Storage
const credentials = require("../dist/storage/credentials");
const memory = require("../dist/storage/memory");
const profile = require("../dist/storage/profile");
const skills = require("../dist/storage/skills");
const insights = require("../dist/storage/insights");

// Tasks (compiled TypeScript from dist folder)
const tasks = require("../dist/tasks");

// Browser (compiled TypeScript from dist folder)
const browser = require("../dist/browser");

// Integrations
const integrations = require("./integrations");

// Web Scraper (compiled TypeScript from dist folder)
const webscraper = require("../dist/webscraper");

// Tools (compiled TypeScript from dist folder)
const tools = require("../dist/tools");

// LLM
const llm = require("./llm");

// Insights (compiled TypeScript from dist folder)
const insightsProcessor = require("../dist/insights/processor");

// Services (compiled TypeScript from dist folder)
const { SettingsService } = require("../dist/services/settings");
const { ProfileService } = require("../dist/services/profile");
const { CredentialsService } = require("../dist/services/credentials");
const { AuthService } = require("../dist/services/auth");
const { OnboardingService } = require("../dist/services/onboarding");
const { SkillsService } = require("../dist/services/skills");
const { TasksService } = require("../dist/services/tasks");
const { IntegrationsService } = require("../dist/services/integrations");
const { CalendarService } = require("../dist/services/calendar");
const { InsightsService } = require("../dist/services/insights");
const { TelegramService } = require("../dist/services/telegram");
const { WhatsAppService } = require("../dist/services/whatsapp");
const { DiscordService } = require("../dist/services/discord");
const { XService } = require("../dist/services/x");
const { NotionService } = require("../dist/services/notion");
const { SpotifyService } = require("../dist/services/spotify");
const { GitHubService } = require("../dist/services/github");
const { AsanaService } = require("../dist/services/asana");
const { RedditService } = require("../dist/services/reddit");
const { GoogleOAuthService } = require("../dist/services/google-oauth");
const { SlackOAuthService } = require("../dist/services/slack-oauth");
const { WelcomeService } = require("../dist/services/welcome");

module.exports = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Utils
  // ─────────────────────────────────────────────────────────────────────────────
  getTodayDate: utils.getTodayDate,
  getYesterdayDate: utils.getYesterdayDate,
  isOlderThanDays: utils.isOlderThanDays,
  isWithinDaysRange: utils.isWithinDaysRange,
  truncateToLimit: utils.truncateToLimit,
  getWovlyDir: utils.getWovlyDir,
  getUserDataDir: utils.getUserDataDir,
  getSettingsPath: utils.getSettingsPath,

  // Tool formatting
  formatToolResult: toolFormatter.formatToolResult,
  formatToolResults: toolFormatter.formatToolResults,

  // Entity extraction and resolution
  extractEntitiesRegex: entityExtractor.extractEntitiesRegex,
  hasEntitiesToResolve: entityExtractor.hasEntitiesToResolve,
  resolveEntitiesWithCache: entityExtractor.resolveEntitiesWithCache,

  // Multi-turn clarification
  detectClarificationResponse: clarification.detectClarificationResponse,
  buildEnrichedQueryFromClarification: clarification.buildEnrichedQueryFromClarification,
  needsClarification: clarification.needsClarification,
  formatClarificationQuestions: clarification.formatClarificationQuestions,
  filterSensitiveQuestions: clarification.filterSensitiveQuestions,

  // Streaming responses
  parseSSEStream: streaming.parseSSEStream,
  streamAnthropicResponse: streaming.streamAnthropicResponse,
  streamOpenAIResponse: streaming.streamOpenAIResponse,

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth
  // ─────────────────────────────────────────────────────────────────────────────
  getSessionPath: session.getSessionPath,
  saveSession: session.saveSession,
  loadSession: session.loadSession,
  clearSession: session.clearSession,

  // ─────────────────────────────────────────────────────────────────────────────
  // Credentials
  // ─────────────────────────────────────────────────────────────────────────────
  getCredentialsPath: credentials.getCredentialsPath,
  loadCredentials: credentials.loadCredentials,
  getAvailableCredentialDomains: credentials.getAvailableCredentialDomains,
  saveCredentials: credentials.saveCredentials,
  getCredentialForDomain: credentials.getCredentialForDomain,
  resolveCredentialPlaceholders: credentials.resolveCredentialPlaceholders,
  validateNoCredentialLeakage: credentials.validateNoCredentialLeakage,
  clearCredentialsCache: credentials.clearCredentialsCache,

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory
  // ─────────────────────────────────────────────────────────────────────────────
  CONTEXT_LIMITS: memory.CONTEXT_LIMITS,
  getMemoryDailyDir: memory.getMemoryDailyDir,
  getMemoryLongtermDir: memory.getMemoryLongtermDir,
  extractSummaryFromMemory: memory.extractSummaryFromMemory,
  hasSummarySection: memory.hasSummarySection,
  generateMemorySummary: memory.generateMemorySummary,
  processOldMemoryFiles: memory.processOldMemoryFiles,
  loadConversationContext: memory.loadConversationContext,
  saveToDaily: memory.saveToDaily,
  saveFactToDaily: memory.saveFactToDaily,
  searchMemorySemantic: memory.searchMemorySemantic,

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile
  // ─────────────────────────────────────────────────────────────────────────────
  getUserProfilePath: profile.getUserProfilePath,
  parseUserProfile: profile.parseUserProfile,
  serializeUserProfile: profile.serializeUserProfile,

  // ─────────────────────────────────────────────────────────────────────────────
  // Insights
  // ─────────────────────────────────────────────────────────────────────────────
  saveInsights: insights.saveInsights,
  loadTodayInsights: insights.loadTodayInsights,
  loadRecentHistory: insights.loadRecentHistory,
  getLastCheckTimestamp: insights.getLastCheckTimestamp,
  getLastCheckData: insights.getLastCheckData,
  saveLastCheckTimestamp: insights.saveLastCheckTimestamp,
  calculateGoalsHash: insights.calculateGoalsHash,

  // Insights processor
  processMessagesAndGenerateInsights: insightsProcessor.processMessagesAndGenerateInsights,

  // ─────────────────────────────────────────────────────────────────────────────
  // Skills
  // ─────────────────────────────────────────────────────────────────────────────
  getSkillsDir: skills.getSkillsDir,
  parseSkill: skills.parseSkill,
  serializeSkill: skills.serializeSkill,
  loadAllSkills: skills.loadAllSkills,
  getSkill: skills.getSkill,
  saveSkill: skills.saveSkill,
  deleteSkill: skills.deleteSkill,
  extractQueryKeywords: skills.extractQueryKeywords,
  calculateSkillScore: skills.calculateSkillScore,
  findBestSkill: skills.findBestSkill,

  // ─────────────────────────────────────────────────────────────────────────────
  // Tasks
  // ─────────────────────────────────────────────────────────────────────────────
  POLL_FREQUENCY_PRESETS: tasks.POLL_FREQUENCY_PRESETS,
  DEFAULT_POLL_FREQUENCY: tasks.DEFAULT_POLL_FREQUENCY,
  getTasksDir: tasks.getTasksDir,
  parseTaskMarkdown: tasks.parseTaskMarkdown,
  serializeTask: tasks.serializeTask,
  createTask: tasks.createTask,
  getTask: tasks.getTask,
  updateTask: tasks.updateTask,
  listTasks: tasks.listTasks,
  listActiveTasks: tasks.listActiveTasks,
  getTasksWaitingForInput: tasks.getTasksWaitingForInput,
  cancelTask: tasks.cancelTask,
  hideTask: tasks.hideTask,
  getTaskRawMarkdown: tasks.getTaskRawMarkdown,
  saveTaskRawMarkdown: tasks.saveTaskRawMarkdown,
  setMainWindow: tasks.setMainWindow,
  addTaskUpdate: tasks.addTaskUpdate,
  getTaskUpdates: tasks.getTaskUpdates,

  // ─────────────────────────────────────────────────────────────────────────────
  // Browser
  // ─────────────────────────────────────────────────────────────────────────────
  BrowserController: browser.BrowserController,
  getBrowserController: browser.getBrowserController,
  loadPuppeteer: browser.loadPuppeteer,
  checkPuppeteerCoreInstalled: browser.checkPuppeteerCoreInstalled,
  ensurePuppeteerCoreInstalled: browser.ensurePuppeteerCoreInstalled,

  // ─────────────────────────────────────────────────────────────────────────────
  // Integrations
  // ─────────────────────────────────────────────────────────────────────────────
  getGoogleAccessToken: integrations.getGoogleAccessToken,
  getSlackAccessToken: integrations.getSlackAccessToken,
  messagingIntegrations: integrations.messagingIntegrations,
  registerMessagingIntegration: integrations.registerMessagingIntegration,
  findIntegrationByKeyword: integrations.findIntegrationByKeyword,
  getMessagingIntegration: integrations.getMessagingIntegration,
  getEnabledMessagingIntegrations: integrations.getEnabledMessagingIntegrations,
  getIMessageChatId: integrations.getIMessageChatId,
  checkForNewIMessages: integrations.checkForNewIMessages,
  checkForNewSlackMessages: integrations.checkForNewSlackMessages,
  checkForNewEmails: integrations.checkForNewEmails,

  // ─────────────────────────────────────────────────────────────────────────────
  // Tools
  // ─────────────────────────────────────────────────────────────────────────────
  timeTools: tools.timeTools,
  executeTimeTool: tools.executeTimeTool,
  
  // Task primitive tools (variables, control flow, time comparison, etc.)
  taskPrimitiveTools: tools.taskPrimitiveTools,
  executeTaskPrimitiveTool: tools.executeTaskPrimitiveTool,
  parseTimeString: tools.parseTimeString,

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM (Architect-Builder Pattern)
  // ─────────────────────────────────────────────────────────────────────────────
  CLASSIFIER_MODELS: llm.CLASSIFIER_MODELS,
  // Complexity classification
  classifyQueryComplexity: llm.classifyQueryComplexity,
  // Main entry point
  decomposeQuery: llm.decomposeQuery,
  // Individual stages
  architectDecompose: llm.architectDecompose,
  builderMapToTools: llm.builderMapToTools,
  validateDecomposition: llm.validateDecomposition,
  // Formatting utilities
  formatDecomposedSteps: llm.formatDecomposedSteps,
  formatArchitectSteps: llm.formatArchitectSteps,
  formatBuilderPlan: llm.formatBuilderPlan,
  // Helpers
  getToolCategories: llm.getToolCategories,

  // ─────────────────────────────────────────────────────────────────────────────
  // Services
  // ─────────────────────────────────────────────────────────────────────────────
  SettingsService: SettingsService,
  ProfileService: ProfileService,
  CredentialsService: CredentialsService,
  AuthService: AuthService,
  OnboardingService: OnboardingService,
  SkillsService: SkillsService,
  TasksService: TasksService,
  IntegrationsService: IntegrationsService,
  CalendarService: CalendarService,
  InsightsService: InsightsService,
  TelegramService: TelegramService,
  WhatsAppService: WhatsAppService,
  DiscordService: DiscordService,
  XService: XService,
  NotionService: NotionService,
  SpotifyService: SpotifyService,
  GitHubService: GitHubService,
  AsanaService: AsanaService,
  RedditService: RedditService,
  GoogleOAuthService: GoogleOAuthService,
  SlackOAuthService: SlackOAuthService,
  WelcomeService: WelcomeService
};
