/**
 * Session persistence - keeps user logged in between app restarts
 */

const path = require("path");
const fs = require("fs/promises");
const { getWovlyDir } = require("../utils/helpers");

const getSessionPath = async () => {
  const dir = await getWovlyDir();
  return path.join(dir, "session.json");
};

const saveSession = async (user) => {
  try {
    const sessionPath = await getSessionPath();
    await fs.writeFile(sessionPath, JSON.stringify({
      username: user.username,
      displayName: user.displayName,
      savedAt: new Date().toISOString()
    }, null, 2));
    console.log(`[Auth] Session saved for ${user.username}`);
  } catch (err) {
    console.error("[Auth] Failed to save session:", err.message);
  }
};

const loadSession = async () => {
  try {
    const sessionPath = await getSessionPath();
    const data = await fs.readFile(sessionPath, "utf8");
    const session = JSON.parse(data);
    console.log(`[Auth] Found saved session for ${session.username}`);
    return session;
  } catch (err) {
    // No session file or invalid - that's fine
    return null;
  }
};

const clearSession = async () => {
  try {
    const sessionPath = await getSessionPath();
    await fs.unlink(sessionPath);
    console.log("[Auth] Session cleared");
  } catch (err) {
    // File doesn't exist - that's fine
  }
};

module.exports = {
  getSessionPath,
  saveSession,
  loadSession,
  clearSession
};
