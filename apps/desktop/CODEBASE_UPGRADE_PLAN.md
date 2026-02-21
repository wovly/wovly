# Wovly Codebase Upgrade Plan

**Created:** February 21, 2026
**Status:** Phase 7 Complete - Moving to Optimization & Enhancement Phase
**Current Progress:** 22 services extracted, 2,304 lines reduced (13.2%)

---

## 🎯 Strategic Goals

### 1. **Reduce Token Costs by 90%+** (PRIORITY: CRITICAL)
**Problem**: Running out of Claude API tokens
**Impact**: $45/month → $2.40/month
**Status**: Helper module created, ready to implement

### 2. **Complete Service Extraction** (PRIORITY: HIGH)
**Target**: Reduce main.js from 15,188 to <2,000 lines
**Impact**: Better maintainability, testability, modularity
**Status**: 13.2% complete

### 3. **Performance & Scalability** (PRIORITY: MEDIUM)
**Target**: Faster response times, better caching
**Impact**: Better UX, reduced costs
**Status**: Partially implemented

---

## 📋 Phase-by-Phase Plan

### Phase 8: Token Optimization (NEXT - 2-3 hours)

**Why this first?** Immediate cost savings while development continues.

#### Step 8.1: Enable Prompt Caching Everywhere (1 hour)
**Impact**: 50-90% token cost reduction

**Files to modify**:
1. **`main.js`** - Chat handlers (~line 13617)
   - Replace Anthropic fetch calls with `callAnthropicWithCaching`
   - Enable system prompt caching
   - Cache conversation context

2. **`src/insights/processor.js`** - Insight generation
   - Cache insight analysis prompts
   - Batch message processing

3. **`src/llm/decomposition.js`** - Architect-Builder
   - Cache tool definitions
   - Cache system prompts for Architect/Builder

4. **`src/services/welcome.ts`** - Welcome message generation
   - Cache welcome prompt template

**Implementation**:
```typescript
// Before (no caching)
const response = await fetch("https://api.anthropic.com/v1/messages", {
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt
  })
});

// After (with caching - 90% cheaper on repeated prompts!)
import { buildAnthropicRequest, callAnthropicWithCaching } from './src/utils/anthropic-helper';

const request = buildAnthropicRequest({
  model: "claude-3-5-haiku-20241022", // Also switch to cheaper model!
  systemPrompt: systemPrompt, // Cached automatically
  messages: conversationHistory,
  enableCaching: true
});
const response = await callAnthropicWithCaching(apiKey, request);
```

**Expected results**:
- ✅ 50-90% reduction in token costs
- ✅ Faster responses (cache hits are instant)
- ✅ Console logs showing cache statistics

#### Step 8.2: Replace Sonnet with Haiku for Simple Tasks (30 min)
**Impact**: 90% cost reduction for 60% of requests

**Changes**:
1. **Entity extraction** → Haiku
2. **Task classification** → Haiku
3. **Fact extraction** → Haiku
4. **Input type detection** → Haiku
5. **Simple Q&A** → Haiku

**Keep Sonnet for**:
- Complex reasoning
- Multi-step tasks
- Creative writing
- Code generation

**Implementation**:
```typescript
// In src/llm/decomposition.js
export const CLASSIFIER_MODELS = {
  anthropic: "claude-3-5-haiku-20241022", // ← Change from Sonnet
  openai: "gpt-4o-mini"
};

// Smart model selection
import { selectModelForTask, CLAUDE_MODELS } from './src/utils/anthropic-helper';

const model = selectModelForTask(userQuery);
// Simple queries → Haiku ($0.25/1M)
// Complex tasks → Sonnet ($3/1M)
```

#### Step 8.3: Reduce Context Window Size (30 min)
**Impact**: 40% reduction in tokens per request

**Changes**:
- Limit conversation history to last 10 messages (vs unlimited)
- Summarize old context with Haiku before adding to new requests
- Remove redundant system prompt repetition

**Implementation**:
```typescript
// In chat handler
const MAX_CONTEXT_MESSAGES = 10;
const contextMessages = conversationHistory.slice(-MAX_CONTEXT_MESSAGES);

// If there's older context, summarize it
let contextSummary = "";
if (conversationHistory.length > MAX_CONTEXT_MESSAGES) {
  const oldMessages = conversationHistory.slice(0, -MAX_CONTEXT_MESSAGES);
  contextSummary = await summarizeContext(oldMessages); // Use Haiku!
}
```

#### Step 8.4: Add Token Monitoring (30 min)
**Impact**: Visibility into costs and usage patterns

**Create**: `src/utils/token-tracker.ts`
```typescript
export class TokenTracker {
  private dailyUsage: Map<string, number> = new Map();

  track(model: string, inputTokens: number, outputTokens: number) {
    const date = new Date().toISOString().split('T')[0];
    const key = `${date}:${model}`;
    const current = this.dailyUsage.get(key) || 0;
    this.dailyUsage.set(key, current + inputTokens + outputTokens);
  }

  getDailyCost(date: string): number {
    // Calculate based on model pricing
  }

  getMonthlyProjection(): number {
    // Project based on current usage
  }
}
```

**Expected Phase 8 Results**:
- 💰 Token costs: $45/month → $2.40/month (94% reduction)
- ⚡ Response times: Faster (cache hits)
- 📊 Visibility: Daily/monthly usage tracking
- 🎯 Smart routing: Right model for each task

---

### Phase 9: WebScraper Service Wrapper (1 hour)

**Why**: Complete the service extraction pattern, consolidate IPC handlers

**Status**: WebScraper module exists (`src/webscraper/`) but handlers still in main.js

#### Step 9.1: Create WebScraperService (30 min)

**Create**: `src/services/webscraper.ts`
```typescript
export class WebScraperService {
  static async analyzeUrl(
    username: string,
    url: string,
    siteType?: string
  ): Promise<WebScraperResponse> {
    // Delegate to existing webscraper module
    const { analyzeUrl } = require('../webscraper');
    return await analyzeUrl(username, url, siteType);
  }

  static async launchVisualSelector(
    username: string,
    url: string,
    suggestions?: any
  ): Promise<WebScraperResponse> {
    const { launchVisualSelector } = require('../webscraper');
    return await launchVisualSelector(username, url, suggestions);
  }

  static async saveConfiguration(
    username: string,
    config: any
  ): Promise<WebScraperResponse> {
    const { saveConfiguration } = require('../webscraper');
    return await saveConfiguration(username, config);
  }

  static async listIntegrations(
    username: string
  ): Promise<WebScraperResponse> {
    const { listIntegrations } = require('../webscraper');
    return await listIntegrations(username);
  }

  static async testConfiguration(
    username: string,
    config: any
  ): Promise<WebScraperResponse> {
    const { testConfiguration } = require('../webscraper');
    return await testConfiguration(username, config);
  }
}
```

#### Step 9.2: Replace Handlers in main.js (30 min)

**Replace ~90 lines** with service delegations:
```typescript
ipcMain.handle("webscraper:analyzeUrl", async (_event, { url, siteType }) => {
  return await WebScraperService.analyzeUrl(currentUser?.username, url, siteType);
});

ipcMain.handle("webscraper:launchVisualSelector", async (_event, { url, suggestions }) => {
  return await WebScraperService.launchVisualSelector(currentUser?.username, url, suggestions);
});

// ... etc
```

**Expected results**:
- ✅ 23rd service extracted
- ✅ ~90 lines reduced
- ✅ Consistent pattern across all services

---

### Phase 10: Shell & Message Confirmation Services (30 min)

**Quick wins**: Extract remaining simple handlers

#### Step 10.1: ShellService (15 min)

**Create**: `src/services/shell.ts`
```typescript
export class ShellService {
  static async openExternal(url: string): Promise<ServiceResponse> {
    try {
      const { shell } = require("electron");
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}
```

**Replace in main.js** (~10 lines → 3 lines)

#### Step 10.2: MessageService (15 min)

**Note**: Message confirmation handlers are only ~20 lines and interact with module-scoped `pendingConfirmations` Map. Decision: Leave in main.js as they're already clean.

**Alternative**: Extract if we want 100% consistency, but marginal value.

**Expected results**:
- ✅ 24th service extracted (Shell)
- ✅ ~10 lines reduced
- ✅ All simple handlers extracted

---

### Phase 11: Chat & LLM Orchestration Optimization (4-6 hours)

**Why not extract?** The chat handlers (~2,586 lines) are the core engine and highly coupled with tool execution. Instead of risky extraction, we'll **optimize in place**.

#### Step 11.1: Optimize Chat Handler with Caching (2 hours)

**File**: `main.js` lines 13617-16203 (chat:send handler)

**Changes**:
1. Enable prompt caching for system prompts
2. Reduce conversation context to last 10 messages
3. Use Haiku for simple queries (classification, entity extraction)
4. Cache tool definitions (they rarely change)
5. Batch tool executions where possible

**Expected results**:
- ✅ 80% token reduction in chat
- ✅ Faster response times
- ✅ Better UX with streaming

#### Step 11.2: Optimize Architect-Builder Pattern (2 hours)

**File**: `src/llm/decomposition.js`

**Changes**:
1. Cache Architect system prompt (it's the same every time!)
2. Use Haiku for Builder tool mapping (simple task)
3. Reduce tool context (only send relevant tools, not all 100+)
4. Batch similar steps

**Example optimization**:
```typescript
// Before: Send all 100+ tool definitions to Builder
const builderPrompt = `Here are all tools: ${JSON.stringify(allTools)}...`; // 50,000 tokens!

// After: Send only relevant tools
const relevantTools = filterToolsByCategory(stepCategory); // 2,000 tokens
const builderPrompt = `Here are relevant tools: ${JSON.stringify(relevantTools)}...`;
```

**Expected results**:
- ✅ 60% token reduction in decomposition
- ✅ Faster task execution
- ✅ Better tool selection

#### Step 11.3: Document Chat Architecture (1 hour)

**Create**: `CHAT_ARCHITECTURE.md`
- Document the chat processing pipeline
- Explain Architect-Builder pattern
- Note optimization opportunities
- Add performance benchmarks

---

### Phase 12: Task Execution Optimization (2 hours)

**File**: `main.js` lines ~3284-3500 (tasks:execute, tasks:approvePendingMessage)

#### Step 12.1: Optimize Task Approval Handler (1 hour)

**Current**: `tasks:approvePendingMessage` is 423 lines!

**Optimization strategy**:
1. Extract helper functions
2. Enable caching for tool execution
3. Use Haiku for simple tool calls
4. Reduce logging verbosity

**Expected results**:
- ✅ 50% token reduction
- ✅ Faster task execution
- ✅ Better error handling

#### Step 12.2: Batch Task Execution (1 hour)

**Optimization**: Execute multiple scheduled tasks in one batch

```typescript
// Before: Execute tasks one by one
for (const task of tasks) {
  await executeTask(task); // 100 API calls!
}

// After: Batch by type
const emailTasks = tasks.filter(t => t.type === 'email');
await batchExecuteEmailTasks(emailTasks); // 1 API call!
```

---

### Phase 13: Testing & Quality (2 hours)

#### Step 13.1: Add Tests for New Helpers (1 hour)

**Create**: `src/utils/__tests__/anthropic-helper.test.ts`
- Test prompt caching
- Test model selection
- Test request building
- Test cache statistics

#### Step 13.2: Integration Testing (1 hour)

**Test scenarios**:
- Chat with caching enabled
- Token usage monitoring
- Cache hit rates
- Response quality with Haiku

---

## 📊 Success Metrics

### Cost Reduction
- **Before**: $45/month
- **Target**: $2.40/month (94% reduction)
- **Metric**: Track via TokenTracker

### Code Quality
- **Before**: main.js 15,188 lines
- **Target**: <2,000 lines (87% reduction)
- **Metric**: Line count, service count

### Performance
- **Before**: Unknown baseline
- **Target**: 30% faster responses
- **Metric**: Response time tracking

### Test Coverage
- **Before**: 429 tests
- **Target**: 450+ tests
- **Metric**: Test count, coverage %

---

## 🗓️ Timeline

### Week 1: Token Optimization (PRIORITY)
- **Day 1-2**: Phase 8 - Enable prompt caching everywhere (Steps 8.1-8.4)
- **Day 3**: Phase 9 - WebScraperService extraction
- **Day 4**: Phase 10 - ShellService extraction
- **Day 5**: Monitoring and validation

**Expected outcome**: 90%+ token cost reduction, 24 services extracted

### Week 2: Chat & Task Optimization
- **Day 1-2**: Phase 11 - Chat handler optimization (Steps 11.1-11.3)
- **Day 3-4**: Phase 12 - Task execution optimization
- **Day 5**: Testing and documentation

**Expected outcome**: Optimized core engine, better performance

### Week 3: Polish & Enhancement
- **Day 1-2**: Phase 13 - Testing
- **Day 3**: Documentation updates
- **Day 4**: Performance benchmarking
- **Day 5**: Deploy and monitor

**Expected outcome**: Production-ready optimized codebase

---

## 🚀 Quick Start (Do This Now!)

### 1. Enable Prompt Caching in Chat (15 min)

**File**: `main.js` line ~13617 (chat:send handler)

**Find this**:
```typescript
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
    messages: messages,
    system: systemPrompt
  })
});
```

**Replace with**:
```typescript
const { buildAnthropicRequest, callAnthropicWithCaching } = require('./src/utils/anthropic-helper');

const request = buildAnthropicRequest({
  model: anthropicModel,
  systemPrompt: systemPrompt, // ← Cached!
  messages: messages.slice(-10), // ← Only last 10 messages
  maxTokens: 4096,
  enableCaching: true
});

const response = await callAnthropicWithCaching(apiKeys.anthropic, request);
const responseText = response.content[0].text;
```

**Result**: Immediate 50-80% token savings in chat!

### 2. Switch to Haiku for Classification (5 min)

**File**: `src/llm/decomposition.js` line 11

**Change**:
```typescript
export const CLASSIFIER_MODELS = {
  anthropic: "claude-3-5-haiku-20241022", // ← Changed from Sonnet
  openai: "gpt-4o-mini"
};
```

**Result**: 90% cost reduction for task classification!

### 3. Compile TypeScript (2 min)

```bash
npm run compile
# or
npx tsc
```

**Result**: New helper module ready to use!

---

## 📈 Expected Overall Impact

### Cost Savings
```
Before: $45/month
Phase 8.1 (Caching):      -70% → $13.50/month
Phase 8.2 (Haiku):        -80% → $2.70/month
Phase 8.3 (Context):      -20% → $2.16/month
Phase 11 (Chat Opt):      -10% → $1.94/month
Phase 12 (Task Opt):      -10% → $1.75/month
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Final: $1.75/month (96% reduction!)
```

### Code Quality
```
Before: 15,188 lines main.js
Phase 9 (WebScraper):     -90 lines → 15,098
Phase 10 (Shell):         -10 lines → 15,088
Phase 11 (Chat docs):     No reduction (optimization)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After immediate work: 15,088 lines
After Phase 13+: ~2,000 lines (long-term goal)
```

### Services Extracted
```
Current: 22 services
Phase 9:  +1 (WebScraper) → 23
Phase 10: +1 (Shell)      → 24
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 24 services extracted
```

---

## 💡 Recommendations

### Do First (Maximum Impact)
1. ✅ **Phase 8: Token Optimization** (2-3 hours, 96% cost savings)
2. ✅ **Quick Start Steps 1-3** (22 min, 70% cost savings)

### Do Next (Clean Architecture)
3. **Phase 9: WebScraperService** (1 hour, consistency)
4. **Phase 10: ShellService** (30 min, completion)

### Do Eventually (Advanced)
5. **Phase 11: Chat Optimization** (4-6 hours, performance)
6. **Phase 12: Task Optimization** (2 hours, efficiency)
7. **Phase 13: Testing** (2 hours, reliability)

### Skip/Defer
- Full chat handler extraction (too risky, low ROI)
- Message confirmation extraction (already clean, 20 lines)

---

## ✅ Next Actions

**Ready to start?** Here's what I can do next:

1. **Implement Phase 8.1** - Add prompt caching to chat handler
2. **Implement Phase 8.2** - Switch to Haiku for simple tasks
3. **Create Phase 9** - Extract WebScraperService
4. **Create monitoring** - Add TokenTracker
5. **Update documentation** - Add usage examples

Which would you like me to start with?
