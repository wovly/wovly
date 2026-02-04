/**
 * Integrations Module - Re-exports all integration functionality
 */

const oauth = require("./oauth");
const messaging = require("./messaging");

module.exports = {
  // OAuth
  getGoogleAccessToken: oauth.getGoogleAccessToken,
  getSlackAccessToken: oauth.getSlackAccessToken,
  
  // Messaging
  messagingIntegrations: messaging.messagingIntegrations,
  registerMessagingIntegration: messaging.registerMessagingIntegration,
  findIntegrationByKeyword: messaging.findIntegrationByKeyword,
  getMessagingIntegration: messaging.getMessagingIntegration,
  getEnabledMessagingIntegrations: messaging.getEnabledMessagingIntegrations,
  getIMessageChatId: messaging.getIMessageChatId,
  checkForNewIMessages: messaging.checkForNewIMessages,
  checkForNewSlackMessages: messaging.checkForNewSlackMessages,
  checkForNewEmails: messaging.checkForNewEmails
};
