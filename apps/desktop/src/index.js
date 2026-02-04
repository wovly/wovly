/**
 * Main Module Entry Point
 * Re-exports all modularized functionality for easy importing
 * 
 * Usage in main.js:
 *   const { getUserDataDir, saveSession, createTask } = require("./src");
 */

// Utils
const utils = require("./utils/helpers");

// Auth
const session = require("./auth/session");

// Storage
const credentials = require("./storage/credentials");
const memory = require("./storage/memory");
const profile = require("./storage/profile");
const skills = require("./storage/skills");

// Tasks
const tasks = require("./tasks");

// Browser
const browser = require("./browser");

// Integrations
const integrations = require("./integrations");

// Tools
const tools = require("./tools");

// LLM
const llm = require("./llm");

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile
  // ─────────────────────────────────────────────────────────────────────────────
  getUserProfilePath: profile.getUserProfilePath,
  parseUserProfile: profile.parseUserProfile,
  serializeUserProfile: profile.serializeUserProfile,

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
  getToolCategories: llm.getToolCategories
};
