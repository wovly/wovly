# Token Optimization Guide

**Problem**: Running out of Claude API tokens too quickly
**Solution**: Implement these optimizations to reduce costs by 80-95%!

---

## 📊 Current Situation

Your app currently uses:
- **Claude Sonnet 4** for most tasks ($3 per 1M tokens)
- **GPT-4o** for some tasks ($2.50 per 1M tokens)
- **In-memory caching** ✅ (already implemented)
- **No prompt caching** ❌ (missing - this is HUGE!)

---

## 🎯 Optimization Strategies

### 1. Enable Anthropic Prompt Caching (50-90% savings!)

**What it is**: Anthropic caches parts of your prompt (like system instructions, conversation context) and charges 90% less to reuse them.

**Example savings**:
- Without caching: 10,000 tokens × $3 = $0.03
- With caching: 1,000 new tokens × $3 + 9,000 cached × $0.30 = $0.0057 (81% cheaper!)

**How to use** (I've created the helper for you):

```typescript
import { callClaude, buildAnthropicRequest, CLAUDE_MODELS } from './src/utils/anthropic-helper';

// Simple usage - automatically caches system prompt
const response = await callClaude(
  apiKey,
  "Summarize this email",
  "You are a helpful AI assistant...", // This gets cached!
  CLAUDE_MODELS.HAIKU // Use cheap model for simple tasks
);

// Advanced usage with conversation context
const request = buildAnthropicRequest({
  model: CLAUDE_MODELS.HAIKU,
  systemPrompt: "Your system instructions...", // Cached
  messages: conversationHistory, // Last 3 messages cached if long enough
  enableCaching: true
});
```

### 2. Use Claude Haiku for Simple Tasks (90% savings!)

**Cost comparison**:
- Opus: $15 per 1M tokens
- Sonnet: $3 per 1M tokens
- **Haiku: $0.25 per 1M tokens** (60x cheaper than Opus!)

**Use Haiku for**:
- ✅ Answering simple questions ("What's on my calendar?")
- ✅ Extracting data ("Get all email addresses from this text")
- ✅ Classifying ("Is this urgent?")
- ✅ Summarizing short texts
- ✅ Entity extraction
- ✅ Fact checking

**Use Sonnet for**:
- General chat
- Multi-step reasoning
- Writing emails/content

**Use Opus for**:
- Complex analysis only
- Advanced code generation
- Very nuanced tasks

**Helper function** (included in anthropic-helper.ts):

```typescript
import { selectModelForTask } from './src/utils/anthropic-helper';

const model = selectModelForTask(userQuery); // Automatically picks best model!
// "What's my schedule?" → Haiku
// "Analyze this complex situation..." → Opus
```

### 3. Reduce Context Window Size

**Current issue**: You might be sending full conversation history every time.

**Optimization**:

```typescript
// ❌ BAD: Sending entire history (wastes tokens)
const messages = allConversationHistory; // Could be 50,000 tokens!

// ✅ GOOD: Only send recent relevant context
const messages = conversationHistory.slice(-10); // Last 10 messages

// ✅ EVEN BETTER: Summarize old context
const summary = await summarizeOldMessages(oldMessages); // 1,000 tokens
const messages = [
  { role: 'user', content: `Previous context: ${summary}` },
  ...recentMessages.slice(-5)
];
```

### 4. Optimize System Prompts

**Current**: You might have very long system prompts repeated in every request.

**Optimization**:

```typescript
// ❌ BAD: Huge system prompt (5,000 tokens) sent every time
const systemPrompt = `
  You are a helpful assistant...
  [5000 words of instructions]
`;

// ✅ GOOD: Cache the system prompt
const request = buildAnthropicRequest({
  systemPrompt: longInstructions, // Cached after first use!
  enableCaching: true
});

// 💡 EVEN BETTER: Keep system prompts concise
const systemPrompt = "You are a concise AI assistant."; // 10 tokens vs 5,000
```

### 5. Batch Similar Requests

**Instead of**:
```typescript
for (const email of emails) {
  await analyzeEmail(email); // 100 API calls!
}
```

**Do this**:
```typescript
const batch = emails.slice(0, 10).map(e => e.content).join('\n---\n');
const results = await analyzeBatch(batch); // 1 API call!
```

### 6. Use Streaming for Better UX

**Benefit**: Users see responses faster, can cancel if not needed (saves tokens on abandoned requests).

```typescript
import { streamAnthropicResponse } from './src/utils/streaming';

// Stream response - user sees it immediately, can cancel
for await (const chunk of streamAnthropicResponse(apiKey, request)) {
  // Show chunk to user
  // If user cancels, stop streaming (saves tokens!)
}
```

---

## 🔧 Implementation Checklist

### Quick Wins (Do First!)

- [ ] **Replace Sonnet with Haiku** for simple queries
  - Edit `src/llm/decomposition.js` line 11: `anthropic: "claude-3-5-haiku-20241022"`
  - Edit task classification to use Haiku
  - Edit entity extraction to use Haiku

- [ ] **Enable prompt caching** in main chat handler
  - Import `buildAnthropicRequest`
  - Use cached system prompts
  - Cache conversation context

- [ ] **Reduce conversation context** from full history to last 10 messages

### Medium Impact

- [ ] **Add model selection logic**
  - Use `selectModelForTask()` to auto-pick Haiku/Sonnet/Opus
  - Start with conservative rules (prefer Haiku)

- [ ] **Batch insight processing**
  - Process multiple emails/messages in one API call
  - Group similar tasks together

- [ ] **Optimize system prompts**
  - Review and shorten verbose prompts
  - Remove redundant instructions

### Advanced

- [ ] **Add token counting** to monitor usage
  - Log tokens per request
  - Track monthly usage
  - Alert when approaching limits

- [ ] **Implement smart caching invalidation**
  - Clear cache when user profile changes
  - Invalidate stale data queries

---

## 📈 Expected Results

**Before optimizations**:
- 100 requests/day
- 500,000 tokens/day (average 5,000 tokens/request)
- Using Sonnet: 500k × $3/1M = **$1.50/day** = **$45/month**

**After optimizations**:
- 100 requests/day
- 80% use Haiku: 80 × 1,000 tokens = 80k tokens
- 20% use Sonnet with caching: 20 × 1,000 tokens = 20k tokens
- Haiku cost: 80k × $0.25/1M = $0.02
- Sonnet cost: 20k × $3/1M = $0.06
- **Total: $0.08/day** = **$2.40/month** (94% savings!)

---

## 🚀 Getting Started

### Step 1: Try Haiku Right Now

Edit your settings to use Haiku as default:

```typescript
// In src/llm/decomposition.js
export const CLASSIFIER_MODELS = {
  anthropic: "claude-3-5-haiku-20241022", // ← Changed from Sonnet
  openai: "gpt-4o-mini" // Already using mini, good!
};
```

### Step 2: Enable Prompt Caching

Replace this pattern:
```typescript
// Old way (no caching)
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt
  })
});
```

With this:
```typescript
// New way (with caching!)
import { callClaude } from './src/utils/anthropic-helper';

const response = await callClaude(
  apiKey,
  prompt,
  systemPrompt, // Automatically cached
  'claude-3-5-haiku-20241022' // Cheaper model
);
```

### Step 3: Monitor Your Savings

Check the console logs - you'll see:
```
[Anthropic Cache] Read 4,523 cached tokens (saved 82.3%)
```

---

## 💡 Pro Tips

1. **Start conservative**: Switch to Haiku for 50% of requests first, then increase.

2. **Monitor quality**: If Haiku responses aren't good enough for some tasks, fall back to Sonnet for those.

3. **Cache system prompts**: Your system prompt is probably the same every time - cache it!

4. **Batch when possible**: 1 request with 10 items is cheaper than 10 requests with 1 item.

5. **Use streaming**: Better UX and you can cancel if the response isn't useful.

6. **Set token limits**: Use `max_tokens` parameter to prevent runaway costs.

---

## 📞 Questions?

The helper module is ready to use at `/src/utils/anthropic-helper.ts`. Key functions:

- `callClaude()` - Simple helper with automatic caching
- `buildAnthropicRequest()` - Build requests with prompt caching
- `selectModelForTask()` - Auto-pick the right model
- `CLAUDE_MODELS` - Model constants with pricing notes

**Want me to update specific parts of your code to use these optimizations?** Just let me know which handlers/services to optimize first!
