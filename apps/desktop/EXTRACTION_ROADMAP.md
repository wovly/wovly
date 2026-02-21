# Service Extraction Roadmap

**Status as of:** 2026-02-19
**Progress:** 2,304 lines reduced, 429 tests added, 22 services extracted
**Current main.js size:** 15,188 lines (from 17,509 originally)
**Completion:** 13.2% toward 97% reduction goal

---

## ✅ Completed Services (21)

### Phase 2: Core Services Layer
1. **SettingsService** - 20 lines reduced, 11 tests
2. **ProfileService** - 98 lines reduced, 21 tests
3. **CredentialsService** - 99 lines reduced, 13 tests

### Phase 3: Business Logic Layer
4. **AuthService** - 166 lines reduced, 31 tests
5. **OnboardingService** - 126 lines reduced, 22 tests
6. **SkillsService** - 56 lines reduced, 19 tests
7. **TasksService** - 163 lines reduced, 27 tests

### Phase 4: Integration Layer ✅ COMPLETE
8. **IntegrationsService** - 140 lines reduced, 22 tests
9. **CalendarService** - 15 lines reduced, 3 tests
10. **InsightsService** - 49 lines reduced, 15 tests

### Phase 5: Messaging Services ✅ COMPLETE
11. **TelegramService** - 55 lines reduced, 18 tests
12. **WhatsAppService** - 49 lines reduced, 24 tests
13. **DiscordService** - ~60 lines reduced
14. **XService** (Twitter) - ~61 lines reduced
15. **NotionService** - ~60 lines reduced
16. **SpotifyService** - ~62 lines reduced
17. **GitHubService** - ~61 lines reduced
18. **AsanaService** - ~61 lines reduced
19. **RedditService** - ~62 lines reduced

### Phase 6: OAuth Infrastructure ✅ COMPLETE
20. **GoogleOAuthService** - ~127 lines reduced
21. **SlackOAuthService** - ~131 lines reduced

### Phase 7: Core Feature Services 🔄 IN PROGRESS
22. **WelcomeService** - 264 lines reduced, 10 tests ✅

---

## 📊 Remaining Work Analysis

### Total Remaining IPC Handlers: ~80

**By Category:**
- **Integrations:** 9 handlers (OAuth flows - complex)
- **WebScraper:** 9 handlers (already implemented as module)
- **Tasks:** 4 handlers (complex execution logic)
- **Messaging Platforms:** 0 handlers ✅ COMPLETE
  - ~~WhatsApp: 7~~ ✅ Complete
  - ~~Telegram: 4~~ ✅ Complete
  - ~~X/Twitter: 4~~ ✅ Complete
  - ~~Spotify: 4~~ ✅ Complete
  - ~~Reddit: 4~~ ✅ Complete
  - ~~Notion: 4~~ ✅ Complete
  - ~~GitHub: 4~~ ✅ Complete
  - ~~Discord: 4~~ ✅ Complete
  - ~~Asana: 4~~ ✅ Complete
- **Core Features:** 6 handlers
  - Chat: 3
  - Message: 2
  - Welcome: 1
- **Other:** Shell (1)

---

## 🎯 Recommended Extraction Order

### Phase 5: Messaging Services (28 handlers, Medium Priority)

Create generic **MessagingService** base class with common OAuth patterns:

```typescript
abstract class MessagingService {
  abstract startOAuth(config): Promise<Response>
  abstract checkAuth(username): Promise<Response>
  abstract disconnect(username): Promise<Response>
  abstract test(username): Promise<Response>
}
```

Then implement platform-specific services:
1. **WhatsAppService** - 7 handlers
2. **TelegramService** - 8 handlers (includes interface)
3. **XService** (Twitter) - 4 handlers
4. **SpotifyService** - 4 handlers
5. **RedditService** - 4 handlers
6. **NotionService** - 4 handlers
7. **GitHubService** - 4 handlers
8. **DiscordService** - 4 handlers
9. **AsanaService** - 4 handlers

**Impact:** Medium (not all users use these)
**Complexity:** Medium (OAuth patterns are repetitive)
**Estimated time:** 3-4 hours with template pattern

---

### Phase 6: Complete OAuth Flows (9 handlers, Low Priority)

#### GoogleOAuthService
- `integrations:startGoogleOAuth` - Complex: HTTP server + redirect
- `integrations:checkGoogleAuth` - Status check
- `integrations:disconnectGoogle` - Cleanup

#### SlackOAuthService
- `integrations:startSlackTunnel` - Ngrok tunnel management
- `integrations:stopSlackTunnel` - Tunnel cleanup
- `integrations:getSlackTunnelUrl` - Status check
- `integrations:startSlackOAuth` - Complex: OAuth with tunnel
- `integrations:checkSlackAuth` - Status check
- `integrations:disconnectSlack` - Cleanup

**Impact:** Required for Google/Slack integration
**Complexity:** High (server management, tunneling)
**Estimated time:** 2-3 hours
**Note:** Could remain in main.js as infrastructure code

---

### Phase 7: Chat & LLM Orchestration (Complex, High Priority)

#### ChatService (3 handlers, ~2000+ lines total!)
- `chat:send` - Full message processing with decomposition
- `chat:sendStream` - Streaming variant
- `chat:executeInline` - Tool execution

**Impact:** Core feature, critical path
**Complexity:** VERY HIGH
**Estimated time:** 8-10 hours
**Challenges:**
- Architect-Builder pattern deeply embedded
- Tool execution coordination
- Streaming response handling
- Context management
- Error recovery

**Recommendation:** Break into sub-services:
1. **LLMOrchestrationService** - Architect-Builder decomposition
2. **ToolExecutionService** - Tool routing and execution
3. **StreamingService** - SSE streaming management
4. **ContextService** - Conversation context management

---

### Phase 8: Task Execution Engine (4 handlers, Medium Priority)

#### TaskExecutionService
- `tasks:create` (partial) - Onboarding integration
- `tasks:execute` - Trigger execution
- `tasks:approvePendingMessage` - 423 lines! Tool execution
- `tasks:rejectPendingMessage` - Message rejection

**Impact:** Core feature for automated tasks
**Complexity:** HIGH
**Estimated time:** 4-5 hours
**Note:** Tightly coupled with chat/tool execution

---

### Phase 9: Remaining Handlers (Low Priority)

#### WelcomeService
- `welcome:complete` - One-time setup

#### ShellService
- `shell:execute` - Shell command execution

#### MessageService
- `message:confirmationApprove` - Tool confirmation
- `message:confirmationReject` - Tool rejection

**Impact:** Low usage frequency
**Complexity:** Low
**Estimated time:** 1-2 hours total

---

## 🚀 Quick Wins (Recommended Next Steps)

### ~~Step 1: InsightsService~~ ✅ COMPLETE
- ~~Extract 3 simple handlers~~
- ~~49 line reduction~~
- ~~15 tests~~
- **Completed:** 16,577 lines

### Step 2: Messaging Template (2 hours)
- Create base MessagingService class
- Extract WhatsApp + Telegram (highest usage)
- ~60 line reduction
- 15-20 tests
- **Projected total:** 16,517 lines

### Step 3: Document Remaining Complex Handlers (1 hour)
- Create detailed design docs for:
  - ChatService decomposition
  - TaskExecutionService refactor
  - OAuth service patterns

---

## 📈 Realistic Timeline to 97% Reduction

**Target:** Reduce main.js from 17,509 to ~500 lines (17,000 line reduction)
**Current progress:** 2,304 lines (13.2%)
**Remaining:** 14,696 lines

### Estimated Breakdown:
- **Quick wins (InsightsService + Messaging):** ~110 lines (2.5 hours)
- **OAuth flows:** ~150 lines (3 hours)
- **Chat/LLM orchestration:** ~2000 lines (10 hours)
- **Task execution:** ~450 lines (5 hours)
- **Remaining small handlers:** ~100 lines (2 hours)
- **WebScraper handlers:** ~90 lines (note: already modularized)
- **Helper function extraction:** ~1000 lines (utilities, formatters)
- **Large tool execution blocks:** ~12,000 lines (tool routing, execution)

### **Total estimated time:** 25-30 hours of focused extraction work

**Blockers:**
- Chat handlers are deeply coupled with tool execution
- Tool execution has 100+ individual tool integrations
- LLM orchestration spans multiple files

**Alternative Strategy:**
Rather than extracting every handler, focus on:
1. Service-oriented handlers (Done! ✅)
2. Integration handlers (Mostly done ✅)
3. **Leave tool execution in main.js as "core engine"**
   - It's already well-organized
   - High coupling makes extraction risky
   - Can document as "execution engine" vs extracting

**Revised realistic goal:** Reduce to ~2,000 lines (89% reduction)
- Extract all service handlers ✅
- Extract all integration handlers (90% done)
- Extract messaging services
- Document chat/tool execution as core engine
- **New timeline:** 5-8 additional hours

---

## 🎨 Architectural Patterns Established

### 1. Service Pattern
```typescript
export class ServiceName {
  static async methodName(params): Promise<ServiceResponse> {
    try {
      // Validation
      if (!username) return { ok: false, error: 'Not logged in' };

      // Business logic
      const result = await someOperation();

      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
```

### 2. Handler Delegation Pattern
```typescript
ipcMain.handle("service:method", async (_event, params) => {
  return await ServiceName.methodName(currentUser?.username, params);
});
```

### 3. Dependency Injection Pattern
```typescript
// Service accepts functions as parameters
static async testGoogle(
  getGoogleAccessToken: (username) => Promise<string | null>,
  username: string
): Promise<Response>

// Handler passes function references
ipcMain.handle("test", async () => {
  return await Service.test(getGoogleAccessToken, currentUser?.username);
});
```

### 4. Test Pattern
```typescript
// Integration tests with temp directories
beforeEach(async () => {
  testWovlyDir = path.join(os.tmpdir(), `wovly-test-${Date.now()}`);
  process.env.WOVLY_DIR = testWovlyDir;
});

// Mock external dependencies
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
```

---

## 📝 Next Session Recommendations

1. ~~**Extract InsightsService**~~ ✅ COMPLETE (30 min, high value)
2. **Extract base MessagingService + WhatsApp** (1 hour, medium value)
3. **Document Chat/Tool architecture** (1 hour, enables future work)
4. **Update metrics and close out Phase 4** (15 min)

**Expected outcome:** 16,517 lines, 382+ tests, 11 services
