# Service Extraction Plan for main.js

**Document Version:** 1.0
**Created:** 2026-02-17
**File Analyzed:** `/Users/jeffchou/wovlyhome/apps/desktop/main.js`
**Total Lines:** 17,509
**Total IPC Handlers:** 125

---

## Executive Summary

This document provides a comprehensive plan for extracting services from the monolithic `main.js` file (17,509 lines). The extraction follows a dependency-aware sequence to ensure clean separation of concerns and minimize breaking changes.

**Key Metrics:**
- **125 IPC handlers** grouped into 25 categories
- **~50 major utility functions** (schedulers, message processors, helpers)
- **~15 OAuth flows** for third-party integrations
- **Estimated effort:** 40-60 hours over 2-3 weeks

**Strategy:** Extract in 4 phases (Utilities → Data Access → Business Logic → IPC) to maintain functionality throughout the process.

---

## Service Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                         UTILITY LAYER                            │
│  PerformanceService, CacheService, RetryService                 │
│  StreamingService, EmbeddingsService                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA ACCESS LAYER                           │
│  SettingsService, ProfileService, CredentialsService            │
│  MemoryService                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS LOGIC LAYER                          │
│  AuthService, InsightsService, SkillsService                    │
│  TaskService, CalendarService                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     INTEGRATION LAYER                            │
│  IntegrationsService (parent)                                   │
│  ├─ GoogleIntegrationService                                    │
│  ├─ SlackIntegrationService                                     │
│  ├─ IMessageService                                             │
│  ├─ TelegramService                                             │
│  ├─ WhatsAppService                                             │
│  ├─ DiscordService                                              │
│  ├─ XService (Twitter)                                          │
│  ├─ NotionService                                               │
│  ├─ GitHubService                                               │
│  ├─ AsanaService                                                │
│  ├─ RedditService                                               │
│  └─ SpotifyService                                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        IPC LAYER                                 │
│  WebScraperService, ChatService                                 │
│  MessageConfirmationService                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Service Breakdown

### Phase 1: Utility Services (Low Risk)

#### 1.1 PerformanceService
**Already Extracted:** ✅ (`src/utils/performance.js`)
- Functions: `PerformanceTracker` class
- Dependencies: None
- Status: Complete

#### 1.2 CacheService
**Already Extracted:** ✅ (`src/utils/cache.js`)
- Functions: `responseCache`, `entityCache`
- Dependencies: None
- Status: Complete

#### 1.3 RetryService
**Already Extracted:** ✅ (`src/utils/retry.js`)
- Functions: `callLLMWithRetry`
- Dependencies: None
- Status: Complete

#### 1.4 StreamingService
**Already Extracted:** ✅ (`src/utils/streaming.js`)
- Functions: `streamAnthropicResponse`, `streamOpenAIResponse`
- Dependencies: None
- Status: Complete

---

### Phase 2: Data Access Services (Medium Risk)

#### 2.1 SettingsService
**Location in main.js:** Lines 2559-2593
**IPC Handlers:**
- `settings:get` (Line 2559)
- `settings:set` (Line 2572)

**Functions to Extract:**
- `getSettingsPath()` - Already in `src/storage/profile.js`
- Settings validation logic
- Default settings initialization

**Dependencies:**
- File system (`fs/promises`)
- `getUserDataDir()` from utils

**Complexity:** Low (2 handlers, simple CRUD)

**New File:** `src/storage/settings.js`

---

#### 2.2 ProfileService
**Location in main.js:** Lines 2593-2722
**IPC Handlers:**
- `profile:get` (Line 2593)
- `profile:update` (Line 2607)
- `profile:needsOnboarding` (Line 2624)
- `profile:addFacts` (Line 2643)
- `profile:getMarkdown` (Line 2688)
- `profile:saveMarkdown` (Line 2703)

**Functions Already in `src/storage/profile.js`:**
- `getUserProfilePath()`
- `parseUserProfile()`
- `serializeUserProfile()`

**Functions to Extract from main.js:**
- Fact conflict resolution logic (Lines 2643-2687)
- Profile validation
- Onboarding status checks

**Dependencies:**
- File system
- `currentUser` global state

**Complexity:** Medium (6 handlers, fact conflict resolution)

**Action:** Enhance existing `src/storage/profile.js`

---

#### 2.3 CredentialsService
**Location in main.js:** Lines 3516-3650
**IPC Handlers:**
- `credentials:list` (Line 3516)
- `credentials:get` (Line 3539)
- `credentials:save` (Line 3570)
- `credentials:delete` (Line 3604)
- `credentials:updateLastUsed` (Line 3627)

**Functions Already Extracted:**
- `getCredentialsPath()`
- `loadCredentials()`
- `saveCredentials()`
- `getAvailableCredentialDomains()`
- `getCredentialForDomain()`
- `resolveCredentialPlaceholders()`
- `validateNoCredentialLeakage()`
- `clearCredentialsCache()`

**Functions in main.js:**
- Credential encryption using `safeStorage` (Lines 3570-3603)
- Credential decryption (Lines 3539-3569)

**Dependencies:**
- Electron `safeStorage` API
- File system

**Complexity:** Medium (5 handlers, encryption/decryption)

**Action:** Extract encryption logic to new `src/storage/credentials.js`

---

#### 2.4 MemoryService
**Already Partially Extracted:** ✅ (`src/storage/memory.js`)
- Daily/longterm memory storage
- Memory summarization
- Context loading

**Functions in main.js to Extract:**
- Memory search execution (Lines 6917-7015)
- Date parsing utilities (Lines 7017-7084)
- Memory tool implementations (Lines 7086-7378)

**Dependencies:**
- File system
- LLM APIs (for summarization)

**Complexity:** High (complex search logic, date parsing)

**Action:** Move memory search tools to `src/storage/memory.js`

---

### Phase 3: Business Logic Services (High Risk)

#### 3.1 AuthService
**Location in main.js:** Lines 3694-3941
**IPC Handlers:**
- `auth:hasUsers` (Line 3694)
- `auth:listUsers` (Line 3704)
- `auth:register` (Line 3719)
- `auth:login` (Line 3750)
- `auth:logout` (Line 3828)
- `auth:checkSession` (Line 3848)
- `auth:getCurrentUser` (Line 3923)

**Functions Already in `src/auth.js`:**
- `getSessionPath()`
- `saveSession()`
- `loadSession()`
- `clearSession()`

**Functions to Extract:**
- User registration with bcrypt hashing (Lines 3719-3749)
- Login with password verification (Lines 3750-3827)
- Session management (Lines 3848-3922)
- `currentUser` global state management

**Dependencies:**
- bcrypt (for password hashing)
- Electron `safeStorage` (for session encryption)
- File system
- Task/Memory schedulers

**Complexity:** High (7 handlers, session management, password hashing)

**New File:** `src/auth/service.js`

**Special Considerations:**
- Must coordinate with schedulers on login/logout
- Must trigger memory processing on login
- Manages global `currentUser` state

---

#### 3.2 OnboardingService
**Location in main.js:** Lines 2788-2928
**IPC Handlers:**
- `onboarding:getStatus` (Line 2788)
- `onboarding:setStage` (Line 2874)
- `onboarding:skip` (Line 2904)

**Functions Already in `src/tutorial.js`:**
- `ONBOARDING_STAGES`
- `isInOnboarding()`
- `getNextStage()`
- `isProfileComplete()`
- `processProfileStageMessage()`
- `getStageWelcomeMessage()`
- `checkStageAdvancement()`
- `shouldUseTutorialMode()`
- `generateTutorialResponse()`

**Functions to Extract:**
- Stage advancement logic
- Skill demo completion check (Lines 163-196)

**Dependencies:**
- ProfileService
- Tutorial module

**Complexity:** Medium (3 handlers, tutorial flow)

**Action:** Create `src/onboarding/service.js` to consolidate IPC handlers

---

#### 3.3 SkillsService
**Location in main.js:** Lines 2928-3006
**IPC Handlers:**
- `skills:list` (Line 2928)
- `skills:get` (Line 2940)
- `skills:save` (Line 2955)
- `skills:delete` (Line 2970)
- `skills:getTemplate` (Line 2984)

**Functions Already in `src/skills.js`:**
- `getSkillsDir()`
- `parseSkill()`
- `serializeSkill()`
- `loadAllSkills()`
- `getSkill()`
- `saveSkill()`
- `deleteSkill()`
- `extractQueryKeywords()`
- `calculateSkillScore()`
- `findBestSkill()`

**Complexity:** Low (5 handlers, already well-extracted)

**Action:** Create `src/skills/service.js` for IPC layer only

---

#### 3.4 TaskService
**Location in main.js:** Lines 5369-6474
**IPC Handlers:**
- `tasks:create` (Line 5369)
- `tasks:list` (Line 5422)
- `tasks:get` (Line 5434)
- `tasks:update` (Line 5449)
- `tasks:cancel` (Line 5464)
- `tasks:hide` (Line 5479)
- `tasks:getUpdates` (Line 5494)
- `tasks:getRawMarkdown` (Line 5503)
- `tasks:saveRawMarkdown` (Line 5518)
- `tasks:execute` (Line 5533)
- `tasks:approvePendingMessage` (Line 5939)
- `tasks:rejectPendingMessage` (Line 6291)
- `tasks:setAutoSend` (Line 6360)
- `tasks:setNotificationsDisabled` (Line 6389)
- `tasks:setPollFrequency` (Line 6420)
- `tasks:getPollFrequencyPresets` (Line 6474)

**Scheduler Functions:**
- `startTaskScheduler()` (Lines 797-1180)
- `stopTaskScheduler()` (Line 1181-1194)
- Task polling logic (Lines 805-1177)
- Wait-for-reply workflow (Lines 899-957)

**Helper Functions:**
- `evaluateReplyWithLLM()` (Lines 439-515)
- `generateFollowupMessage()` (Lines 528-592)
- `sendFollowupMessage()` (Lines 605-788)
- `addPendingMessageToTask()` (Lines 387-411)
- `resumeTasksOnStartup()` (Lines 1366-1412)
- `runOnLoginTasks()` (Lines 1413-1465)
- `setTaskExecutor()` (Lines 1466-1480)

**Functions Already in `src/tasks.js`:**
- `POLL_FREQUENCY_PRESETS`
- `DEFAULT_POLL_FREQUENCY`
- `getTasksDir()`
- `parseTaskMarkdown()`
- `serializeTask()`
- `createTask()`
- `getTask()`
- `updateTask()`
- `listTasks()`
- `listActiveTasks()`
- `getTasksWaitingForInput()`
- `cancelTask()`
- `hideTask()`
- `getTaskRawMarkdown()`
- `saveTaskRawMarkdown()`
- `setMainWindow()`
- `addTaskUpdate()`
- `getTaskUpdates()`

**Dependencies:**
- Google Integration (for email checks)
- Slack Integration (for Slack message checks)
- Messaging integrations (unified system)
- LLM APIs (for reply evaluation, follow-up generation)
- Window reference (for UI notifications)

**Complexity:** Very High (16 handlers, scheduler, message workflows)

**Action:** Create `src/tasks/service.js` and move scheduler logic

---

#### 3.5 InsightsService
**Location in main.js:** Lines 2722-2788, 1228-1365
**IPC Handlers:**
- `insights:setLimit` (Line 2722)
- `insights:getToday` (Line 2741)
- `insights:refresh` (Line 2756)

**Scheduler Functions:**
- `runInsightsCheck()` (Lines 1228-1330)
- `startInsightsScheduler()` (Lines 1331-1356)
- `stopInsightsScheduler()` (Lines 1357-1365)

**Functions Already in `src/insights.js`:**
- `saveInsights()`
- `loadTodayInsights()`
- `getLastCheckTimestamp()`
- `getLastCheckData()`
- `saveLastCheckTimestamp()`
- `calculateGoalsHash()`
- `processMessagesAndGenerateInsights()`

**Dependencies:**
- Google Integration (email checking)
- Slack Integration (message checking)
- LLM APIs (insight generation)

**Complexity:** High (3 handlers, scheduler, multi-integration)

**Action:** Create `src/insights/service.js` with scheduler

---

#### 3.6 CalendarService
**Location in main.js:** Lines 3328-3349
**IPC Handlers:**
- `calendar:getEvents` (Line 3328)

**Helper Functions:**
- `fetchCalendarEvents()` (Lines 1803-1846)

**Dependencies:**
- Google Integration (access token)
- Google Calendar API

**Complexity:** Low (1 handler, simple API wrapper)

**Action:** Create `src/calendar/service.js`

---

### Phase 4: Integration Services (Very High Risk)

#### 4.1 IntegrationsService (Parent)
**Location in main.js:** Lines 3349-3650
**IPC Handlers:**
- `integrations:testGoogle` (Line 3349)
- `integrations:testIMessage` (Line 3398)
- `integrations:testWeather` (Line 3413)
- `integrations:setWeatherEnabled` (Line 3429)
- `integrations:getWeatherEnabled` (Line 3446)
- `integrations:getBrowserEnabled` (Line 3457)
- `integrations:setBrowserEnabled` (Line 3467)
- `integrations:testBrowser` (Line 3486)

**Functions Already in `src/integrations.js`:**
- `messagingIntegrations` registry
- `registerMessagingIntegration()`
- `findIntegrationByKeyword()`
- `getMessagingIntegration()`
- `getEnabledMessagingIntegrations()`

**Dependencies:**
- All child integration services
- Settings service

**Complexity:** Medium (8 handlers, coordination layer)

**Action:** Create `src/integrations/service.js`

---

#### 4.2 GoogleIntegrationService
**Location in main.js:** Lines 3941-4046, 6653-6672
**IPC Handlers:**
- `integrations:startGoogleOAuth` (Line 3941)
- `integrations:checkGoogleAuth` (Line 4046)
- `integrations:disconnectGoogle` (Line 6653)

**OAuth Flow:** Lines 3941-4045 (HTTP server, OAuth callback)

**Functions Already in `src/integrations.js`:**
- `getGoogleAccessToken()`
- `checkForNewEmails()`

**Tool Implementations in main.js:**
- Google Workspace tools (Lines 6673-6818)
- Calendar events fetch (Lines 1803-1846)

**Dependencies:**
- HTTP server (for OAuth callback)
- Google OAuth2 API
- Settings service

**Complexity:** Very High (3 handlers, OAuth flow, token refresh)

**Action:** Create `src/integrations/google/service.js`

---

#### 4.3 SlackIntegrationService
**Location in main.js:** Lines 4059-4385
**IPC Handlers:**
- `integrations:startSlackTunnel` (Line 4059)
- `integrations:stopSlackTunnel` (Line 4190)
- `integrations:getSlackTunnelUrl` (Line 4199)
- `integrations:startSlackOAuth` (Line 4204)
- `integrations:checkSlackAuth` (Line 4323)
- `integrations:disconnectSlack` (Line 4342)
- `integrations:testSlack` (Line 4360)

**OAuth Flow:** Lines 4204-4322 (LocalTunnel, HTTP server, OAuth callback)

**Helper Functions:**
- `fetchSlackChannels()` (Lines 6474-6493)
- `postSlackMessage()` (Lines 6494-6509)
- `fetchSlackUsers()` (Lines 6511-6518)

**Functions Already in `src/integrations.js`:**
- `getSlackAccessToken()`
- `checkForNewSlackMessages()`

**Dependencies:**
- LocalTunnel (for OAuth callback)
- HTTP server
- Slack API
- Settings service

**Complexity:** Very High (7 handlers, tunnel setup, OAuth flow)

**Action:** Create `src/integrations/slack/service.js`

---

#### 4.4 IMessageService
**Location in main.js:** Integration test at Line 3398
**Functions Already in `src/integrations/imessage-integration.js`:**
- `getIMessageChatId()`
- `checkForNewIMessages()`

**IPC Handlers:**
- `integrations:testIMessage` (Line 3398)

**Dependencies:**
- macOS Contacts database
- macOS Messages database

**Complexity:** Low (1 handler, platform-specific)

**Action:** Create `src/integrations/imessage/service.js`

---

#### 4.5 TelegramService
**Location in main.js:** Lines 4385-4451
**IPC Handlers:**
- `telegram:setToken` (Line 4385)
- `telegram:checkAuth` (Line 4409)
- `telegram:disconnect` (Line 4414)
- `telegram:test` (Line 4430)

**Dependencies:**
- Telegram Bot API
- Settings service

**Complexity:** Low (4 handlers, simple bot integration)

**Action:** Create `src/integrations/telegram/service.js`

---

#### 4.6 WhatsAppService
**Location in main.js:** Lines 1847-2100, 6524-6611
**IPC Handlers:**
- `whatsapp:connect` (Line 6524)
- `whatsapp:disconnect` (Line 6533)
- `whatsapp:getStatus` (Line 6542)
- `whatsapp:checkAuth` (Line 6550)
- `whatsapp:sendMessage` (Line 6566)
- `whatsapp:syncToSelfChat` (Line 6586)
- `whatsapp:isSyncReady` (Line 6606)

**Core Functions:**
- `getWhatsAppAuthDir()` (Lines 1847-1853)
- `connectWhatsApp()` (Lines 1854-2045)
- `disconnectWhatsApp()` (Lines 2047-2067)
- `notifyWhatsAppStatus()` (Lines 2069-2076)

**Global State:**
- `whatsappSocket`
- `whatsappQR`
- `whatsappStatus`
- `whatsappSelfChatJid`
- `whatsappAuthState`
- `whatsappSaveCreds`

**Dependencies:**
- `@whiskeysockets/baileys` library
- QRCode generation
- File system (auth state)
- External message processor

**Complexity:** Very High (7 handlers, WebSocket management, QR auth)

**Action:** Create `src/integrations/whatsapp/service.js`

---

#### 4.7 TelegramInterfaceService
**Location in main.js:** Lines 2103-2278, 6613-6650
**IPC Handlers:**
- `telegramInterface:connect` (Line 6617)
- `telegramInterface:disconnect` (Line 6626)
- `telegramInterface:getStatus` (Line 6635)
- `telegramInterface:checkAuth` (Line 6642)

**Core Functions:**
- `connectTelegramInterface()` (Lines 2119-2253)
- `disconnectTelegramInterface()` (Lines 2255-2278)
- `notifyTelegramInterfaceStatus()` (Lines 2111-2117)

**Global State:**
- `telegramInterfaceActive`
- `telegramPollingInterval`
- `telegramLastUpdateId`
- `telegramInterfaceStatus`

**Dependencies:**
- Telegram Bot API (polling)
- External message processor
- Settings service

**Complexity:** High (4 handlers, long-polling, message processing)

**Action:** Create `src/integrations/telegram-interface/service.js`

---

#### 4.8-4.13 Third-Party OAuth Services
Each follows similar pattern:

**DiscordService** (Lines 4451-4580)
- Handlers: `discord:startOAuth`, `discord:checkAuth`, `discord:disconnect`, `discord:test`

**XService (Twitter)** (Lines 4580-4716)
- Handlers: `x:startOAuth`, `x:checkAuth`, `x:disconnect`, `x:test`

**NotionService** (Lines 4716-4846)
- Handlers: `notion:startOAuth`, `notion:checkAuth`, `notion:disconnect`, `notion:test`

**GitHubService** (Lines 4846-4976)
- Handlers: `github:startOAuth`, `github:checkAuth`, `github:disconnect`, `github:test`

**AsanaService** (Lines 4976-5103)
- Handlers: `asana:startOAuth`, `asana:checkAuth`, `asana:disconnect`, `asana:test`

**RedditService** (Lines 5103-5239)
- Handlers: `reddit:startOAuth`, `reddit:checkAuth`, `reddit:disconnect`, `reddit:test`

**SpotifyService** (Lines 5239-5369)
- Handlers: `spotify:startOAuth`, `spotify:checkAuth`, `spotify:disconnect`, `spotify:test`

**Common Pattern:**
- OAuth 2.0 flow with HTTP callback server
- Token storage in settings
- Token refresh for services that expire
- Disconnect/cleanup handlers

**Complexity per Service:** Medium-High (4 handlers each, OAuth flow)

**Action:** Create individual service files in `src/integrations/{service}/`

---

### Phase 5: Application-Level Services

#### 5.1 WebScraperService
**Already Extracted:** ✅ (`src/webscraper/`)
**Location in main.js:** Lines 5552-5939
**IPC Handlers:**
- `webscraper:analyzeUrl` (Line 5552)
- `webscraper:launchVisualSelector` (Line 5706)
- `webscraper:saveConfiguration` (Line 5756)
- `webscraper:listIntegrations` (Line 5773)
- `webscraper:updateIntegration` (Line 5790)
- `webscraper:deleteIntegration` (Line 5807)
- `webscraper:testIntegration` (Line 5824)
- `webscraper:launchOAuthLogin` (Line 5863)
- `webscraper:testConfiguration` (Line 5902)

**Complexity:** High (9 handlers, browser automation)

**Action:** Move IPC handlers to `src/webscraper/service.js`

---

#### 5.2 ChatService
**Location in main.js:** Lines 15417-17487
**IPC Handlers:**
- `chat:send` (Line 15657)
- `chat:sendStream` (Line 16247)
- `chat:executeInline` (Line 16647)

**Core Functions:**
- `processChatQuery()` - Massive function handling full chat pipeline
- Tool executor (`buildToolsAndExecutor()`)
- Decomposition flow
- Inline execution

**Helper Functions:**
- `checkSkillDemoCompletionShared()` (Lines 163-196)
- `getConversationStyleContext()` (Lines 1482-1704)
- `generateStyleGuide()` (Lines 1705-1802)

**Global Tool Definitions:**
- Google Workspace tools (Lines 6673-6818)
- Profile tools (Lines 6820-6846)
- Memory tools (Lines 6848-6915)
- Documentation tools (Lines 7380-7500)

**Dependencies:**
- All integration services
- All data services
- LLM APIs (Anthropic, OpenAI, Google)
- Browser controller
- Skills, Tasks, Memory

**Complexity:** Extremely High (3 handlers, 2000+ lines of logic)

**Action:** Create `src/chat/service.js` - requires careful extraction

---

#### 5.3 MessageConfirmationService
**Location in main.js:** Lines 213-382, 15417-15436
**IPC Handlers:**
- `message:confirmationApprove` (Line 15417)
- `message:confirmationReject` (Line 15428)

**Core Functions:**
- `buildMessagePreview()` (Lines 237-295)
- `requestMessageConfirmation()` (Lines 304-382)

**Global State:**
- `pendingConfirmations` Map
- `confirmationIdCounter`
- `TOOLS_REQUIRING_CONFIRMATION` array

**Dependencies:**
- Task service (for pending messages in tasks)
- Window reference (for UI notifications)

**Complexity:** Medium (2 handlers, confirmation workflow)

**Action:** Create `src/message-confirmation/service.js`

---

#### 5.4 WelcomeService
**Location in main.js:** Lines 3006-3328
**IPC Handlers:**
- `welcome:generate` (Line 3006)

**Function:** Generates personalized welcome message using LLM

**Dependencies:**
- Profile service
- Calendar service
- LLM APIs

**Complexity:** Low (1 handler, straightforward logic)

**Action:** Create `src/welcome/service.js`

---

#### 5.5 ShellService
**Location in main.js:** Line 3650
**IPC Handlers:**
- `shell:openExternal` (Line 3650)

**Function:** Opens URLs in external browser

**Dependencies:**
- Electron `shell` module

**Complexity:** Very Low (1 handler, one-liner)

**Action:** Keep in main.js or create minimal `src/shell/service.js`

---

## Helper Functions and Schedulers

### Global Helper Functions (Not in Services)

**Location:** Lines 163-2280

1. **checkSkillDemoCompletionShared()** (163-196)
   - Used by chat:send and chat:executeInline
   - Should move to OnboardingService

2. **buildMessagePreview()** (237-295)
   - Move to MessageConfirmationService

3. **requestMessageConfirmation()** (304-382)
   - Move to MessageConfirmationService

4. **addPendingMessageToTask()** (387-411)
   - Move to TaskService

5. **evaluateReplyWithLLM()** (439-515)
   - Move to TaskService (wait-for-reply workflow)

6. **generateFollowupMessage()** (528-592)
   - Move to TaskService

7. **sendFollowupMessage()** (605-788)
   - Move to TaskService

8. **Task Scheduler Functions** (797-1194)
   - `startTaskScheduler()`
   - `stopTaskScheduler()`
   - Move to TaskService

9. **Memory Scheduler Functions** (1195-1227)
   - `startMemoryScheduler()`
   - `stopMemoryScheduler()`
   - Move to MemoryService

10. **Insights Scheduler Functions** (1228-1365)
    - `runInsightsCheck()`
    - `startInsightsScheduler()`
    - `stopInsightsScheduler()`
    - Move to InsightsService

11. **Task Lifecycle Functions** (1366-1480)
    - `resumeTasksOnStartup()`
    - `runOnLoginTasks()`
    - `setTaskExecutor()`
    - Move to TaskService

12. **Conversation Style Functions** (1482-1802)
    - `getConversationStyleContext()`
    - `generateStyleGuide()`
    - Move to ChatService or new StyleService

13. **Calendar Helper** (1803-1846)
    - `fetchCalendarEvents()`
    - Move to CalendarService

14. **WhatsApp Core** (1847-2100)
    - `getWhatsAppAuthDir()`
    - `connectWhatsApp()`
    - `disconnectWhatsApp()`
    - `notifyWhatsAppStatus()`
    - Move to WhatsAppService

15. **External Message Processing** (2078-2100)
    - `processExternalMessage()`
    - `setExternalMessageProcessor()`
    - Move to ChatService

16. **Telegram Interface Core** (2103-2278)
    - `notifyTelegramInterfaceStatus()`
    - `connectTelegramInterface()`
    - `disconnectTelegramInterface()`
    - Move to TelegramInterfaceService

---

## Extraction Sequencing

### Phase 1: Utilities (Week 1, Days 1-2)
**Risk:** Very Low
**Effort:** 4 hours

✅ Already complete (performance, cache, retry, streaming)

---

### Phase 2: Data Access Layer (Week 1, Days 3-5)
**Risk:** Low-Medium
**Effort:** 12 hours

**Day 3 (4 hours):**
1. Create `src/storage/settings.js`
   - Extract settings handlers
   - Add validation logic
   - Test: settings:get, settings:set

**Day 4 (4 hours):**
2. Enhance `src/storage/profile.js`
   - Add fact conflict resolution
   - Extract all profile handlers
   - Test: profile:* handlers

**Day 5 (4 hours):**
3. Create `src/storage/credentials.js`
   - Extract credential encryption/decryption
   - Move credential handlers
   - Test: credentials:* handlers

---

### Phase 3: Business Logic (Week 2)
**Risk:** Medium-High
**Effort:** 20 hours

**Day 1 (6 hours):**
4. Create `src/auth/service.js`
   - Extract auth handlers
   - Coordinate with schedulers
   - Test: auth:* handlers, login/logout flow

**Day 2 (4 hours):**
5. Create `src/onboarding/service.js`
   - Consolidate onboarding handlers
   - Move skill demo check
   - Test: onboarding:* handlers

**Day 3 (2 hours):**
6. Create `src/skills/service.js`
   - IPC layer only (logic already extracted)
   - Test: skills:* handlers

**Day 4-5 (8 hours):**
7. Create `src/tasks/service.js`
   - Extract all task handlers
   - Move scheduler logic
   - Move wait-for-reply workflow
   - Test: tasks:* handlers, scheduler

---

### Phase 4: Integrations (Week 3)
**Risk:** Very High
**Effort:** 24 hours

**Day 1 (6 hours):**
8. Create `src/integrations/google/service.js`
   - OAuth flow
   - Token management
   - Test: Google OAuth, calendar, email

**Day 2 (6 hours):**
9. Create `src/integrations/slack/service.js`
   - LocalTunnel setup
   - OAuth flow
   - Test: Slack OAuth, messaging

**Day 3 (4 hours):**
10. Create `src/integrations/whatsapp/service.js`
    - WebSocket management
    - QR auth
    - Test: WhatsApp connection, messaging

11. Create `src/integrations/telegram-interface/service.js`
    - Polling logic
    - Test: Telegram interface

**Day 4 (4 hours):**
12. Create OAuth services (batch):
    - `src/integrations/discord/service.js`
    - `src/integrations/x/service.js`
    - `src/integrations/notion/service.js`
    - `src/integrations/github/service.js`

**Day 5 (4 hours):**
13. Create remaining services:
    - `src/integrations/asana/service.js`
    - `src/integrations/reddit/service.js`
    - `src/integrations/spotify/service.js`
    - `src/integrations/telegram/service.js` (bot integration)
    - `src/integrations/imessage/service.js`

---

### Phase 5: Application Services (Week 4, Days 1-3)
**Risk:** Very High
**Effort:** 12 hours

**Day 1 (2 hours):**
14. Create `src/message-confirmation/service.js`
    - Move confirmation handlers
    - Test: message confirmations

**Day 2 (2 hours):**
15. Create `src/insights/service.js`
    - Move scheduler
    - Move handlers
    - Test: insights:* handlers

16. Create `src/calendar/service.js`
    - Simple wrapper
    - Test: calendar:getEvents

**Day 3 (8 hours):**
17. Create `src/chat/service.js`
    - Extract chat handlers (CRITICAL)
    - Move tool definitions
    - Move processChatQuery
    - Test: chat:send, chat:sendStream, chat:executeInline

---

## Risk Assessment by Service

| Service | Risk Level | Reason | Mitigation |
|---------|-----------|--------|------------|
| SettingsService | Low | Simple CRUD | Direct extraction |
| ProfileService | Low | Well-defined API | Add validation tests |
| CredentialsService | Medium | Encryption/decryption | Test with real credentials |
| MemoryService | High | Complex search logic | Incremental extraction |
| AuthService | Very High | Global state, schedulers | Careful state management |
| OnboardingService | Medium | Tutorial flow | Test all stages |
| SkillsService | Low | Already extracted | IPC wrapper only |
| TaskService | Very High | Scheduler, workflows | Extensive testing |
| InsightsService | High | Multi-integration | Test scheduler |
| CalendarService | Low | Simple wrapper | Direct extraction |
| GoogleIntegration | Very High | OAuth, tokens | Test OAuth flow |
| SlackIntegration | Very High | Tunnel, OAuth | Test with real workspace |
| WhatsAppService | Very High | WebSocket, auth | Test QR flow |
| TelegramInterface | High | Long-polling | Test polling |
| OAuth Services | High | OAuth flows | Test each service |
| MessageConfirmation | Medium | State management | Test approval/rejection |
| ChatService | Extreme | 2000+ lines, all deps | Incremental, heavy testing |
| WebScraperService | Medium | Already extracted | Move IPC only |

---

## Testing Strategy

### Unit Tests
Create tests for each service in `tests/services/`:
- `auth.test.js`
- `tasks.test.js`
- `integrations/google.test.js`
- etc.

### Integration Tests
Test cross-service interactions:
- Auth → Task scheduler startup
- Task → Google/Slack message checking
- Chat → All services

### Manual Testing Checklist
After each extraction:
- [ ] Run app, verify no crashes
- [ ] Test all IPC handlers for the service
- [ ] Test service with real integrations
- [ ] Check error handling
- [ ] Verify UI still works

---

## Success Criteria

### Per-Service Success
- ✅ All IPC handlers moved and working
- ✅ All functions extracted
- ✅ No circular dependencies
- ✅ Unit tests passing
- ✅ Manual testing complete

### Overall Success
- ✅ main.js reduced from 17,509 to <2,000 lines
- ✅ All 125 IPC handlers working
- ✅ All integrations functional
- ✅ No regressions in core features
- ✅ Clear service boundaries
- ✅ Improved maintainability

---

## Post-Extraction main.js Structure

After all extractions, main.js should contain only:

1. **Imports** (Lines 1-150)
   - Electron modules
   - Service imports

2. **Window Management** (Lines 150-200)
   - `createWindow()`
   - `win` reference

3. **IPC Registration** (Lines 200-500)
   - Service IPC registration calls
   - Example: `AuthService.registerHandlers(ipcMain)`

4. **App Lifecycle** (Lines 500-600)
   - `app.whenReady()`
   - Scheduler startup
   - Auto-reconnect logic

5. **Cleanup** (Lines 600-650)
   - `app.on('window-all-closed')`
   - Service cleanup calls

**Estimated Final Size:** ~650 lines (96% reduction)

---

## Rollback Strategy

### Per-Service Rollback
If extraction fails:
1. Keep extracted service files
2. Revert main.js to previous commit
3. Debug extracted service in isolation
4. Retry extraction

### Git Strategy
- Create branch per service: `feature/extract-auth-service`
- Commit after each service extraction
- Tag stable points: `v1.0-settings-extracted`
- Easy rollback to last stable state

---

## Dependencies Diagram

```
main.js (17,509 lines)
│
├─ Phase 1: Utilities (DONE)
│  ├─ PerformanceService ✅
│  ├─ CacheService ✅
│  ├─ RetryService ✅
│  └─ StreamingService ✅
│
├─ Phase 2: Data Access
│  ├─ SettingsService
│  ├─ ProfileService
│  ├─ CredentialsService
│  └─ MemoryService
│      ├─ Depends on: FileSystem
│      └─ Depends on: LLM APIs
│
├─ Phase 3: Business Logic
│  ├─ AuthService
│  │   ├─ Depends on: SettingsService, ProfileService
│  │   └─ Coordinates: TaskScheduler, MemoryScheduler
│  │
│  ├─ OnboardingService
│  │   └─ Depends on: ProfileService
│  │
│  ├─ SkillsService
│  │   └─ Depends on: FileSystem
│  │
│  ├─ TaskService
│  │   ├─ Depends on: MemoryService, ProfileService
│  │   └─ Uses: GoogleIntegration, SlackIntegration
│  │
│  ├─ InsightsService
│  │   ├─ Depends on: ProfileService
│  │   └─ Uses: GoogleIntegration, SlackIntegration
│  │
│  └─ CalendarService
│      └─ Depends on: GoogleIntegration
│
├─ Phase 4: Integrations
│  ├─ IntegrationsService (parent)
│  │   └─ Coordinates all integrations
│  │
│  ├─ GoogleIntegrationService
│  │   └─ Depends on: SettingsService
│  │
│  ├─ SlackIntegrationService
│  │   └─ Depends on: SettingsService
│  │
│  ├─ WhatsAppService
│  │   └─ Depends on: ChatService (external message processor)
│  │
│  ├─ TelegramInterfaceService
│  │   └─ Depends on: ChatService
│  │
│  └─ OAuth Services (Discord, X, Notion, GitHub, Asana, Reddit, Spotify)
│      └─ Each depends on: SettingsService
│
└─ Phase 5: Application Services
   ├─ MessageConfirmationService
   │   └─ Depends on: TaskService
   │
   ├─ ChatService
   │   ├─ Depends on: All Services
   │   └─ Orchestrates: Tools, LLMs, Integrations
   │
   ├─ WebScraperService ✅
   │   └─ Depends on: BrowserController
   │
   ├─ WelcomeService
   │   └─ Depends on: ProfileService, CalendarService
   │
   └─ ShellService
       └─ Minimal wrapper
```

---

## IPC Handler Summary (All 125)

### Auth (7)
- auth:hasUsers
- auth:listUsers
- auth:register
- auth:login
- auth:logout
- auth:checkSession
- auth:getCurrentUser

### Settings (2)
- settings:get
- settings:set

### Profile (6)
- profile:get
- profile:update
- profile:needsOnboarding
- profile:addFacts
- profile:getMarkdown
- profile:saveMarkdown

### Onboarding (3)
- onboarding:getStatus
- onboarding:setStage
- onboarding:skip

### Skills (5)
- skills:list
- skills:get
- skills:save
- skills:delete
- skills:getTemplate

### Tasks (16)
- tasks:create
- tasks:list
- tasks:get
- tasks:update
- tasks:cancel
- tasks:hide
- tasks:getUpdates
- tasks:getRawMarkdown
- tasks:saveRawMarkdown
- tasks:execute
- tasks:approvePendingMessage
- tasks:rejectPendingMessage
- tasks:setAutoSend
- tasks:setNotificationsDisabled
- tasks:setPollFrequency
- tasks:getPollFrequencyPresets

### Insights (3)
- insights:setLimit
- insights:getToday
- insights:refresh

### Calendar (1)
- calendar:getEvents

### Credentials (5)
- credentials:list
- credentials:get
- credentials:save
- credentials:delete
- credentials:updateLastUsed

### Integrations (8)
- integrations:testGoogle
- integrations:testIMessage
- integrations:testWeather
- integrations:setWeatherEnabled
- integrations:getWeatherEnabled
- integrations:getBrowserEnabled
- integrations:setBrowserEnabled
- integrations:testBrowser

### Google Integration (3)
- integrations:startGoogleOAuth
- integrations:checkGoogleAuth
- integrations:disconnectGoogle

### Slack Integration (7)
- integrations:startSlackTunnel
- integrations:stopSlackTunnel
- integrations:getSlackTunnelUrl
- integrations:startSlackOAuth
- integrations:checkSlackAuth
- integrations:disconnectSlack
- integrations:testSlack

### Telegram (4)
- telegram:setToken
- telegram:checkAuth
- telegram:disconnect
- telegram:test

### Telegram Interface (4)
- telegramInterface:connect
- telegramInterface:disconnect
- telegramInterface:getStatus
- telegramInterface:checkAuth

### WhatsApp (7)
- whatsapp:connect
- whatsapp:disconnect
- whatsapp:getStatus
- whatsapp:checkAuth
- whatsapp:sendMessage
- whatsapp:syncToSelfChat
- whatsapp:isSyncReady

### Discord (4)
- discord:startOAuth
- discord:checkAuth
- discord:disconnect
- discord:test

### X/Twitter (4)
- x:startOAuth
- x:checkAuth
- x:disconnect
- x:test

### Notion (4)
- notion:startOAuth
- notion:checkAuth
- notion:disconnect
- notion:test

### GitHub (4)
- github:startOAuth
- github:checkAuth
- github:disconnect
- github:test

### Asana (4)
- asana:startOAuth
- asana:checkAuth
- asana:disconnect
- asana:test

### Reddit (4)
- reddit:startOAuth
- reddit:checkAuth
- reddit:disconnect
- reddit:test

### Spotify (4)
- spotify:startOAuth
- spotify:checkAuth
- spotify:disconnect
- spotify:test

### WebScraper (9)
- webscraper:analyzeUrl
- webscraper:launchVisualSelector
- webscraper:saveConfiguration
- webscraper:listIntegrations
- webscraper:updateIntegration
- webscraper:deleteIntegration
- webscraper:testIntegration
- webscraper:launchOAuthLogin
- webscraper:testConfiguration

### Message Confirmation (2)
- message:confirmationApprove
- message:confirmationReject

### Chat (3)
- chat:send
- chat:sendStream
- chat:executeInline

### Welcome (1)
- welcome:generate

### Shell (1)
- shell:openExternal

**Total:** 125 handlers

---

## Next Steps

1. **Review this plan** with the team
2. **Set up testing infrastructure** (Jest, test fixtures)
3. **Create feature branches** for each phase
4. **Start Phase 2** (Data Access Layer)
5. **Track progress** with GitHub issues/project board

---

## Appendix: Line Number Reference

### Quick Reference Guide

| Service | Lines | Handler Count |
|---------|-------|---------------|
| Imports | 1-156 | 0 |
| Confirmation System | 163-382 | 0 |
| WhatsApp State | 416-423 | 0 |
| Wait-for-Reply Helpers | 429-788 | 0 |
| Task Scheduler | 797-1194 | 0 |
| Memory Scheduler | 1195-1227 | 0 |
| Insights Scheduler | 1228-1365 | 0 |
| Task Lifecycle | 1366-1480 | 0 |
| Conversation Style | 1482-1802 | 0 |
| Calendar Helper | 1803-1846 | 0 |
| WhatsApp Core | 1847-2100 | 0 |
| Telegram Interface | 2103-2278 | 0 |
| Window Creation | 2280-2303 | 0 |
| App Lifecycle | 2304-2558 | 0 |
| Settings Handlers | 2559-2593 | 2 |
| Profile Handlers | 2593-2722 | 6 |
| Insights Handlers | 2722-2788 | 3 |
| Onboarding Handlers | 2788-2928 | 3 |
| Skills Handlers | 2928-3006 | 5 |
| Welcome Handler | 3006-3328 | 1 |
| Calendar Handler | 3328-3349 | 1 |
| Integration Tests | 3349-3516 | 8 |
| Credentials Handlers | 3516-3650 | 5 |
| Shell Handler | 3650-3694 | 1 |
| Auth Handlers | 3694-3941 | 7 |
| Google OAuth | 3941-4046 | 2 |
| Slack OAuth | 4059-4385 | 7 |
| Telegram Handlers | 4385-4451 | 4 |
| Discord OAuth | 4451-4580 | 4 |
| X OAuth | 4580-4716 | 4 |
| Notion OAuth | 4716-4846 | 4 |
| GitHub OAuth | 4846-4976 | 4 |
| Asana OAuth | 4976-5103 | 4 |
| Reddit OAuth | 5103-5239 | 4 |
| Spotify OAuth | 5239-5369 | 4 |
| Task Handlers | 5369-6474 | 16 |
| Slack Helpers | 6474-6518 | 0 |
| WhatsApp Handlers | 6524-6611 | 7 |
| Telegram Interface | 6613-6650 | 4 |
| Google Disconnect | 6653-6672 | 1 |
| Tool Definitions | 6673-7500 | 0 |
| Memory Tools | 6917-7378 | 0 |
| Chat Handlers | 15417-17487 | 5 |
| App Cleanup | 17490-17509 | 0 |

---

**End of Document**
