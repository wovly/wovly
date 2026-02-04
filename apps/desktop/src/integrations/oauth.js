/**
 * OAuth Token Helpers - Manage access tokens for integrations
 */

const fs = require("fs/promises");
const { getSettingsPath } = require("../utils/helpers");

// Get Google access token (with refresh if needed)
const getGoogleAccessToken = async (username) => {
  if (!username) {
    console.error("[Google] getGoogleAccessToken called without username");
    return null;
  }
  const settingsPath = await getSettingsPath(username);
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    return null;
  }

  if (!settings.googleTokens) {
    return null;
  }

  const { access_token, refresh_token, expires_at, client_id, client_secret } = settings.googleTokens;

  // Check if token is expired (with 5 min buffer)
  if (expires_at && Date.now() > expires_at - 300000 && refresh_token) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id,
          client_secret,
          refresh_token,
          grant_type: "refresh_token"
        })
      });

      if (response.ok) {
        const data = await response.json();
        settings.googleTokens.access_token = data.access_token;
        settings.googleTokens.expires_at = Date.now() + (data.expires_in * 1000);
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        return data.access_token;
      }
    } catch (err) {
      console.error("Token refresh failed:", err);
    }
  }

  return access_token;
};

// Helper to get Slack access token
const getSlackAccessToken = async (username) => {
  if (!username) {
    console.error("[Slack] getSlackAccessToken called without username");
    return null;
  }
  try {
    const settingsPath = await getSettingsPath(username);
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    
    if (!settings.slackTokens?.access_token) {
      return null;
    }
    
    return settings.slackTokens.access_token;
  } catch {
    return null;
  }
};

module.exports = {
  getGoogleAccessToken,
  getSlackAccessToken
};
