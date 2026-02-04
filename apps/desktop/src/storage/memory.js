/**
 * Memory System - Daily and long-term memory storage with summarization
 */

const path = require("path");
const fs = require("fs/promises");
const {
  getUserDataDir,
  getSettingsPath,
  getTodayDate,
  getYesterdayDate,
  isOlderThanDays,
  isWithinDaysRange,
  truncateToLimit
} = require("../utils/helpers");

// Token limits for conversation context (chars, ~4 chars per token)
const CONTEXT_LIMITS = {
  TODAY_MAX_CHARS: 6000,      // ~1500 tokens - most recent conversations today
  YESTERDAY_MAX_CHARS: 3000,  // ~750 tokens - summary or recent from yesterday
  SUMMARIES_MAX_CHARS: 2000,  // ~500 tokens - summaries from past 2 weeks
  TOTAL_MAX_CHARS: 10000      // ~2500 tokens - hard cap on total context
};

const getMemoryDailyDir = async (username) => {
  const dir = await getUserDataDir(username);
  const dailyDir = path.join(dir, "memory", "daily");
  await fs.mkdir(dailyDir, { recursive: true });
  return dailyDir;
};

const getMemoryLongtermDir = async (username) => {
  const dir = await getUserDataDir(username);
  const longtermDir = path.join(dir, "memory", "longterm");
  await fs.mkdir(longtermDir, { recursive: true });
  return longtermDir;
};

// Extract summary from memory file (if exists)
const extractSummaryFromMemory = (content) => {
  const match = content.match(/## Summary\n([\s\S]*?)\n---/);
  return match ? match[1].trim() : null;
};

// Check if memory file has a summary section
const hasSummarySection = (content) => {
  return content.includes('## Summary\n');
};

// Generate summary for a memory file using LLM
const generateMemorySummary = async (content, apiKey) => {
  if (!apiKey) {
    console.log("[Memory] No API key for summarization");
    return null;
  }

  const prompt = `Analyze this conversation log and create a concise summary. Extract:
- Key facts learned about the user
- Decisions made
- Appointments or events discussed
- Problems or issues mentioned
- Tasks created
- Important questions asked and answers given

Be concise but capture important details. Format as bullet points.

Conversation log:
${content}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      console.error("[Memory] Summary generation failed:", response.status);
      return null;
    }

    const result = await response.json();
    const summaryText = result.content.find(b => b.type === "text")?.text || "";
    return summaryText;
  } catch (err) {
    console.error("[Memory] Summary generation error:", err.message);
    return null;
  }
};

// Process old memory files - summarize and move to longterm
const processOldMemoryFiles = async (username) => {
  if (!username) {
    console.log("[Memory] No user logged in, skipping memory processing");
    return;
  }
  console.log(`[Memory] Processing old memory files for ${username}...`);
  
  // Get API key for summarization
  let apiKey = null;
  try {
    const settingsPath = await getSettingsPath(username);
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    apiKey = settings.apiKeys?.anthropic;
  } catch {
    console.log("[Memory] No API key configured, skipping summarization");
    return;
  }

  if (!apiKey) {
    console.log("[Memory] No Anthropic API key, skipping summarization");
    return;
  }

  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);
  const today = getTodayDate();
  const yesterday = getYesterdayDate();

  let files;
  try {
    files = await fs.readdir(dailyDir);
  } catch {
    console.log("[Memory] No daily memory directory yet");
    return;
  }

  // Filter to only .md files and sort by date
  const mdFiles = files.filter(f => f.endsWith('.md')).sort();

  for (const file of mdFiles) {
    const dateStr = file.replace('.md', '');
    
    // Skip today and yesterday - keep in daily
    if (dateStr === today || dateStr === yesterday) {
      console.log(`[Memory] Keeping ${file} in daily (recent)`);
      continue;
    }

    // Check if older than 1 day
    if (!isOlderThanDays(dateStr, 1)) {
      continue;
    }

    const filePath = path.join(dailyDir, file);
    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    // Check if already has summary
    if (hasSummarySection(content)) {
      console.log(`[Memory] ${file} already has summary, moving to longterm`);
      // Just move it
      const destPath = path.join(longtermDir, file);
      await fs.rename(filePath, destPath);
      continue;
    }

    // Generate summary
    console.log(`[Memory] Generating summary for ${file}...`);
    const summary = await generateMemorySummary(content, apiKey);
    
    if (summary) {
      // Prepend summary to file
      const newContent = `## Summary\n${summary}\n\n---\n\n${content}`;
      
      // Write to longterm location
      const destPath = path.join(longtermDir, file);
      await fs.writeFile(destPath, newContent, "utf8");
      
      // Remove from daily
      await fs.unlink(filePath);
      
      console.log(`[Memory] Summarized and moved ${file} to longterm`);
    } else {
      console.log(`[Memory] Could not generate summary for ${file}, keeping in daily`);
    }
  }

  console.log("[Memory] Finished processing old memory files");
};

// Load conversation context for LLM - today, yesterday, and recent summaries
// With token limits to prevent context explosion
const loadConversationContext = async (username) => {
  const dailyDir = await getMemoryDailyDir(username);
  const longtermDir = await getMemoryLongtermDir(username);
  const today = getTodayDate();
  const yesterday = getYesterdayDate();

  let todayMessages = "";
  let yesterdayMessages = "";
  let recentSummaries = "";

  // Load today's messages (truncate to limit)
  try {
    const todayPath = path.join(dailyDir, `${today}.md`);
    const fullContent = await fs.readFile(todayPath, "utf8");
    todayMessages = truncateToLimit(fullContent, CONTEXT_LIMITS.TODAY_MAX_CHARS, "today's messages");
  } catch {
    // No messages today yet
  }

  // Load yesterday's messages (truncate to limit)
  try {
    const yesterdayPath = path.join(dailyDir, `${yesterday}.md`);
    const fullContent = await fs.readFile(yesterdayPath, "utf8");
    yesterdayMessages = truncateToLimit(fullContent, CONTEXT_LIMITS.YESTERDAY_MAX_CHARS, "yesterday's messages");
  } catch {
    // Try longterm (may have been moved)
    try {
      const yesterdayLongtermPath = path.join(longtermDir, `${yesterday}.md`);
      const content = await fs.readFile(yesterdayLongtermPath, "utf8");
      // Extract just the summary if available, otherwise use truncated full content
      const summary = extractSummaryFromMemory(content);
      yesterdayMessages = summary || truncateToLimit(content, CONTEXT_LIMITS.YESTERDAY_MAX_CHARS, "yesterday's messages");
    } catch {
      // No messages yesterday
    }
  }

  // Load summaries from longterm (2-14 days ago) with limit
  try {
    const longtermFiles = await fs.readdir(longtermDir);
    const summaryParts = [];
    let totalChars = 0;

    for (const file of longtermFiles.sort().reverse()) {
      if (!file.endsWith('.md')) continue;
      
      const dateStr = file.replace('.md', '');
      
      // Skip if it's yesterday (already loaded above)
      if (dateStr === yesterday) continue;
      
      // Only include files from 2-14 days ago
      if (!isWithinDaysRange(dateStr, 2, 14)) continue;

      try {
        const filePath = path.join(longtermDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const summary = extractSummaryFromMemory(content);
        
        if (summary) {
          // Check if adding this summary would exceed limit
          if (totalChars + summary.length > CONTEXT_LIMITS.SUMMARIES_MAX_CHARS) {
            console.log(`[Memory] Skipping older summaries to stay within limit`);
            break;
          }
          summaryParts.push(`**${dateStr}:**\n${summary}`);
          totalChars += summary.length;
        }
      } catch {
        // Skip unreadable files
      }
    }

    recentSummaries = summaryParts.join("\n\n");
  } catch {
    // No longterm directory yet
  }

  // Final safety check - ensure total doesn't exceed hard cap
  const totalLength = todayMessages.length + yesterdayMessages.length + recentSummaries.length;
  if (totalLength > CONTEXT_LIMITS.TOTAL_MAX_CHARS) {
    console.log(`[Memory] Total context ${totalLength} exceeds limit ${CONTEXT_LIMITS.TOTAL_MAX_CHARS}, trimming further`);
    // Prioritize today > yesterday > summaries
    const remaining = CONTEXT_LIMITS.TOTAL_MAX_CHARS - todayMessages.length;
    if (remaining < yesterdayMessages.length) {
      yesterdayMessages = truncateToLimit(yesterdayMessages, Math.max(remaining / 2, 500), "yesterday");
      recentSummaries = truncateToLimit(recentSummaries, Math.max(remaining / 2, 500), "summaries");
    }
  }

  console.log(`[Memory] Loaded context: today=${todayMessages.length}, yesterday=${yesterdayMessages.length}, summaries=${recentSummaries.length} chars`);
  return { todayMessages, yesterdayMessages, recentSummaries };
};

// Save a conversation exchange to today's daily memory file
const saveToDaily = async (username, userMessage, assistantResponse) => {
  if (!username) {
    console.log("[Memory] No user logged in, skipping memory save");
    return;
  }
  
  try {
    const dailyDir = await getMemoryDailyDir(username);
    const today = getTodayDate();
    const filePath = path.join(dailyDir, `${today}.md`);
    
    const timestamp = new Date().toISOString();
    const entry = `\n\n---\n**[${timestamp}]**\n\n**User:** ${userMessage}\n\n**Assistant:** ${assistantResponse}\n`;
    
    // Append to file (create if doesn't exist)
    await fs.appendFile(filePath, entry, "utf8");
    console.log(`[Memory] Saved conversation to ${today}.md`);
  } catch (err) {
    console.error("[Memory] Failed to save to daily:", err.message);
  }
};

// Save a fact or insight to today's memory
const saveFactToDaily = async (username, fact, source = "conversation") => {
  if (!username) return;
  
  try {
    const dailyDir = await getMemoryDailyDir(username);
    const today = getTodayDate();
    const filePath = path.join(dailyDir, `${today}.md`);
    
    const timestamp = new Date().toISOString();
    const entry = `\n\n**[${timestamp}] Fact learned (${source}):** ${fact}\n`;
    
    await fs.appendFile(filePath, entry, "utf8");
    console.log(`[Memory] Saved fact to ${today}.md`);
  } catch (err) {
    console.error("[Memory] Failed to save fact:", err.message);
  }
};

module.exports = {
  CONTEXT_LIMITS,
  getMemoryDailyDir,
  getMemoryLongtermDir,
  extractSummaryFromMemory,
  hasSummarySection,
  generateMemorySummary,
  processOldMemoryFiles,
  loadConversationContext,
  saveToDaily,
  saveFactToDaily
};
