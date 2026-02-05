/**
 * Unified Messaging Registry - Stores and manages messaging integrations
 */

const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { exec } = require("child_process");

// Messaging integrations registry
const messagingIntegrations = {};

// Register a messaging integration
const registerMessagingIntegration = (integration) => {
  messagingIntegrations[integration.id] = integration;
  console.log(`[Messaging] Registered: ${integration.name}`);
};

// Find integration by keyword
const findIntegrationByKeyword = (text) => {
  const lowerText = text.toLowerCase();
  for (const integration of Object.values(messagingIntegrations)) {
    if (!integration.enabled) continue;
    for (const keyword of integration.keywords) {
      if (lowerText.includes(keyword)) {
        return integration;
      }
    }
  }
  return null;
};

// Get integration by ID
const getMessagingIntegration = (id) => messagingIntegrations[id];

// Get all enabled messaging integrations
const getEnabledMessagingIntegrations = () => {
  return Object.values(messagingIntegrations).filter(i => i.enabled);
};

// Get the chat_id for iMessage conversation with a contact
const getIMessageChatId = async (contactIdentifier) => {
  if (!contactIdentifier) {
    console.log(`[Messaging] getIMessageChatId: no contact identifier provided`);
    return null;
  }
  
  const dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db");
  
  try {
    await fs.access(dbPath);
  } catch {
    console.log(`[Messaging] getIMessageChatId: cannot access Messages database`);
    return null;
  }

  const digits = contactIdentifier.replace(/\D/g, "");
  const lastDigits = digits.slice(-10);
  
  console.log(`[Messaging] getIMessageChatId: looking for chat with ${contactIdentifier} (digits: ${lastDigits})`);
  
  const query = lastDigits 
    ? `SELECT c.ROWID, c.chat_identifier, h.id as handle_id 
       FROM chat c 
       JOIN chat_handle_join chj ON c.ROWID = chj.chat_id 
       JOIN handle h ON chj.handle_id = h.ROWID 
       WHERE h.id LIKE '%${lastDigits}%' 
       AND (c.chat_identifier LIKE 'iMessage;%' OR c.chat_identifier LIKE 'SMS;%' OR c.chat_identifier LIKE '+%')
       ORDER BY c.ROWID DESC LIMIT 1`
    : `SELECT c.ROWID, c.chat_identifier, h.id as handle_id 
       FROM chat c 
       JOIN chat_handle_join chj ON c.ROWID = chj.chat_id 
       JOIN handle h ON chj.handle_id = h.ROWID 
       WHERE h.id LIKE '%${contactIdentifier.replace(/'/g, "''")}%' 
       AND (c.chat_identifier LIKE 'iMessage;%' OR c.chat_identifier LIKE 'SMS;%' OR c.chat_identifier LIKE '+%')
       ORDER BY c.ROWID DESC LIMIT 1`;

  return new Promise((resolve) => {
    exec(`sqlite3 "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { timeout: 5000 }, (error, stdout) => {
      if (error) {
        console.error(`[Messaging] getIMessageChatId error: ${error.message}`);
        resolve(null);
        return;
      }
      const result = stdout.trim();
      if (result) {
        const parts = result.split("|");
        const chatId = parts[0];
        const chatIdentifier = parts[1];
        const handleId = parts[2];
        console.log(`[Messaging] Found chat_id ${chatId} (${chatIdentifier}) with handle ${handleId}`);
        resolve(chatId);
      } else {
        console.log(`[Messaging] No 1:1 chat found for ${contactIdentifier}`);
        resolve(null);
      }
    });
  });
};

// Check for new iMessages from a contact
const checkForNewIMessages = async (contactIdentifier, afterTimestamp, chatId = null) => {
  if (!contactIdentifier) {
    return { hasNew: false, reason: "missing contact" };
  }

  const dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db");
  
  try {
    await fs.access(dbPath);
  } catch {
    return { hasNew: false, reason: "cannot access Messages database" };
  }

  const appleEpoch = new Date("2001-01-01T00:00:00Z").getTime();
  const cutoffTimestamp = (afterTimestamp - appleEpoch) * 1000000;

  const phoneFilter = contactIdentifier;
  const digits = phoneFilter.replace(/\D/g, "");
  const lastDigits = digits.slice(-10);
  
  const contactFilter = lastDigits 
    ? `h.id LIKE '%${lastDigits}%'`
    : `h.id LIKE '%${contactIdentifier.replace(/'/g, "''")}%'`;
  
  let query;
  if (chatId) {
    query = `SELECT COUNT(*) as count, GROUP_CONCAT(SUBSTR(m.text, 1, 100), ' | ') as previews
             FROM message m 
             JOIN handle h ON m.handle_id = h.ROWID 
             JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
             WHERE cmj.chat_id = ${chatId}
             AND ${contactFilter}
             AND m.is_from_me = 0 
             AND m.date > ${cutoffTimestamp}`;
  } else {
    query = `SELECT COUNT(*) as count, GROUP_CONCAT(SUBSTR(m.text, 1, 100), ' | ') as previews
             FROM message m 
             JOIN handle h ON m.handle_id = h.ROWID 
             WHERE ${contactFilter}
             AND m.is_from_me = 0 
             AND m.date > ${cutoffTimestamp}`;
  }

  return new Promise((resolve) => {
    exec(`sqlite3 "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { timeout: 5000 }, (error, stdout) => {
      if (error) {
        console.error(`[Messaging] iMessage check error: ${error.message}`);
        resolve({ hasNew: false, reason: error.message });
        return;
      }
      const result = stdout.trim();
      const parts = result.split("|");
      const count = parseInt(parts[0]) || 0;
      const snippet = parts.length > 1 ? parts.slice(1).join("|").trim() : "";
      
      console.log(`[Messaging] iMessage check for ${contactIdentifier}: ${count} new messages`);
      
      resolve({ 
        hasNew: count > 0, 
        count,
        snippet: snippet || undefined
      });
    });
  });
};

// Check for new Slack messages
const checkForNewSlackMessages = async (channelOrUser, afterTimestamp, accessToken) => {
  if (!channelOrUser || !accessToken) {
    return { hasNew: false, reason: "missing parameters" };
  }

  try {
    const oldest = Math.floor(afterTimestamp / 1000);
    let channelId = channelOrUser;
    
    // If it's a user ID, open DM channel
    if (/^U[A-Z0-9]+$/i.test(channelOrUser)) {
      const dmResponse = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ users: channelOrUser })
      });
      const dmData = await dmResponse.json();
      if (dmData.ok && dmData.channel) {
        channelId = dmData.channel.id;
      } else {
        return { hasNew: false, reason: `failed to open DM: ${dmData.error}` };
      }
    }

    const response = await fetch(
      `https://slack.com/api/conversations.history?channel=${channelId}&oldest=${oldest}&limit=5`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    
    const data = await response.json();
    
    if (!data.ok) {
      return { hasNew: false, reason: data.error };
    }

    const messages = data.messages || [];
    const messageCount = messages.length;
    
    const messageDetails = messages.map(m => ({
      text: m.text || '',
      timestamp: m.ts,
      user: m.user
    }));
    
    return { 
      hasNew: messageCount > 0, 
      count: messageCount,
      messages: messageDetails,
      snippet: messages[0]?.text || ''
    };
  } catch (err) {
    return { hasNew: false, reason: err.message };
  }
};

// Check for new Gmail messages
// threadId parameter allows filtering to a specific email thread (for reply tracking)
const checkForNewEmails = async (accessToken, fromEmail, afterTimestamp, threadId = null) => {
  if (!accessToken || !fromEmail) {
    return { hasNew: false, reason: "missing parameters" };
  }

  try {
    // Build query - include threadId if provided to filter to same conversation
    let query = `from:${fromEmail} newer_than:2d`;
    
    // If threadId is provided, we'll filter results by thread after fetching
    // (Gmail API doesn't support direct thread filtering in search query)
    
    const url = new URL("https://www.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "10");

    const response = await fetch(url.toString(), {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return { hasNew: false, reason: "api_error" };
    }

    const data = await response.json();
    const messageIds = data.messages || [];
    
    if (messageIds.length === 0) {
      return { hasNew: false, count: 0 };
    }

    let newMessageCount = 0;
    const newMessages = [];
    
    for (const msg of messageIds.slice(0, 5)) {
      try {
        const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        
        if (msgResponse.ok) {
          const msgData = await msgResponse.json();
          
          // If threadId is specified (and not null/"null"/unresolved template), filter to only messages in the same thread
          // This ensures we only detect replies to our original email, not other emails from this contact
          // Note: threadId can be actual null, string "null", undefined, or unresolved template - all mean "don't filter by thread"
          const isUnresolvedTemplate = typeof threadId === 'string' && threadId.startsWith('{{') && threadId.endsWith('}}');
          const hasValidThreadId = threadId && threadId !== "null" && threadId !== "undefined" && !isUnresolvedTemplate;
          if (hasValidThreadId && msgData.threadId !== threadId) {
            console.log(`[Messaging] Skipping email ${msg.id} - different thread (${msgData.threadId} vs ${threadId})`);
            continue;
          }
          
          const internalDate = parseInt(msgData.internalDate, 10);
          
          if (internalDate > afterTimestamp) {
            newMessageCount++;
            const subjectHeader = msgData.payload?.headers?.find(h => h.name === "Subject");
            const snippet = msgData.snippet || '';
            newMessages.push({
              id: msg.id,
              threadId: msgData.threadId, // Include threadId in response
              timestamp: internalDate,
              subject: subjectHeader?.value || "(no subject)",
              snippet: snippet
            });
          }
        }
      } catch (msgErr) {
        console.error(`[Messaging] Error fetching message ${msg.id}:`, msgErr.message);
      }
    }
    
    return { 
      hasNew: newMessageCount > 0, 
      count: newMessageCount,
      messages: newMessages
    };
  } catch (err) {
    return { hasNew: false, reason: err.message };
  }
};

module.exports = {
  messagingIntegrations,
  registerMessagingIntegration,
  findIntegrationByKeyword,
  getMessagingIntegration,
  getEnabledMessagingIntegrations,
  getIMessageChatId,
  checkForNewIMessages,
  checkForNewSlackMessages,
  checkForNewEmails
};
