# Implementation Plan: OAuth Support for Custom Web Integrations

## Problem Statement

Many modern websites use OAuth providers (Google, Microsoft, Facebook, etc.) instead of traditional username/password login forms. The current custom web integration system only supports form-based authentication, which excludes a significant number of important websites.

### Current Limitations

1. **Form-only authentication**: Requires username/password fields, submit button
2. **No OAuth support**: Cannot handle "Sign in with Google/Microsoft/Facebook" workflows
3. **2FA barriers**: Cannot automate 2FA (SMS codes, authenticator apps)
4. **CAPTCHA detection**: Automated logins often trigger security measures
5. **Limited website coverage**: Excludes many modern SaaS platforms using OAuth

### Examples of OAuth-Only Websites

- Notion (Google/Apple OAuth)
- Figma (Google OAuth)
- Miro (Google/Microsoft OAuth)
- Many school portals (Google Workspace SSO)
- Daycare apps (Google OAuth for institutional accounts)

## Solution Overview

**Hybrid Authentication System**: Support both traditional form-based login AND OAuth-based login with manual user authentication.

### Key Strategy

1. **User chooses auth method** during setup (username/password OR OAuth)
2. **Manual OAuth login** - user logs in via headful browser once
3. **Session persistence** - save and reuse cookies (works for weeks/months)
4. **Automatic re-login prompts** when session expires
5. **Unified scraping** - same message extraction regardless of auth method

### User Experience Flow

```
Setup Wizard Step 1: Basic Info
┌─────────────────────────────────────────┐
│ Website Name: Notion                    │
│ Website URL: https://notion.so          │
│                                         │
│ Login Method:                           │
│ ○ Username & Password                   │
│ ● Sign in with OAuth (Google/SSO)       │
│                                         │
│ [Next: AI Analysis]                     │
└─────────────────────────────────────────┘

If OAuth selected:
┌─────────────────────────────────────────┐
│ OAuth Login                             │
│                                         │
│ A browser window will open.             │
│ Please log in with your account.        │
│                                         │
│ • Click "Sign in with Google"           │
│ • Complete any 2FA if required          │
│ • We'll capture the session             │
│                                         │
│ [Open Browser & Login]                  │
└─────────────────────────────────────────┘

Browser opens → User logs in → Session saved ✓
```

## Architecture Components

```
┌──────────────────────────────────────────────────────────────┐
│ Authentication Flow                                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  TRADITIONAL LOGIN              OAUTH LOGIN                  │
│  ──────────────────              ───────────                 │
│                                                              │
│  1. AI detects form             1. User selects OAuth        │
│  2. Extract selectors           2. Open headful browser      │
│  3. Automate form fill          3. User logs in manually     │
│  4. Save session                4. Save session              │
│  5. Validate success            5. Validate success          │
│                                                              │
│  ↓                              ↓                            │
│  └──────────── Same scraping flow ────────────┘             │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Session Management                                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Every hourly scrape:                                        │
│  1. Load saved session cookies                               │
│  2. Navigate to site                                         │
│  3. Validate session (check for login page)                  │
│  4. If valid → scrape messages                               │
│  5. If invalid → prompt user to re-login                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Config Schema Changes

**Add `authMethod` field to site configuration**

**File**: Site config schema (`~/.wovly-assistant/users/{username}/web-integrations/sites/{siteName}.json`)

```json
{
  "id": "notion-workspace",
  "name": "Notion Workspace",
  "url": "https://www.notion.so/login",
  "enabled": true,

  // NEW: Authentication configuration
  "authMethod": "oauth", // "form" | "oauth"
  "oauthProvider": "google", // "google" | "microsoft" | "generic" | null

  // For form-based auth (existing)
  "credentialDomain": "notion.so",
  "selectors": {
    "login": {
      "usernameField": "input[name='email']",
      "passwordField": "input[name='password']",
      "submitButton": "button[type='submit']",
      "successIndicator": "div.notion-topbar"
    }
  },

  // For OAuth-based auth (NEW)
  "oauth": {
    "requiresManualLogin": true,
    "sessionValidationUrl": "https://www.notion.so/",
    "loginDetectionSelector": "button:contains('Sign in')", // Presence = logged out
    "successDetectionSelector": "div.notion-topbar" // Presence = logged in
  },

  // Session management (existing, used by both)
  "sessionManagement": {
    "saveSession": true,
    "sessionTimeout": 604800000 // 7 days (longer for OAuth)
  }
}
```

### 2. UI Changes - Setup Wizard Step 1

**File**: `/apps/ui/src/components/webscraper/AddWebIntegrationModal.tsx`

**Current Step 1** (lines ~50-120):
```tsx
<div className="form-group">
  <label>Website Name</label>
  <input value={siteName} onChange={...} />
</div>

<div className="form-group">
  <label>Website URL</label>
  <input value={url} onChange={...} />
</div>

<div className="form-group">
  <label>Username</label>
  <input value={username} onChange={...} />
</div>

<div className="form-group">
  <label>Password</label>
  <input type="password" value={password} onChange={...} />
</div>
```

**NEW Step 1** (replace credentials section):
```tsx
<div className="form-group">
  <label>Website Name</label>
  <input value={siteName} onChange={...} />
</div>

<div className="form-group">
  <label>Website URL</label>
  <input value={url} onChange={...} />
</div>

{/* NEW: Login method selection */}
<div className="form-group">
  <label>Login Method</label>
  <div className="auth-method-selector">
    <label className="auth-method-option">
      <input
        type="radio"
        name="authMethod"
        value="form"
        checked={authMethod === 'form'}
        onChange={(e) => setAuthMethod(e.target.value)}
      />
      <div className="auth-method-card">
        <div className="auth-method-icon">🔑</div>
        <div className="auth-method-title">Username & Password</div>
        <div className="auth-method-description">
          Traditional login form
        </div>
      </div>
    </label>

    <label className="auth-method-option">
      <input
        type="radio"
        name="authMethod"
        value="oauth"
        checked={authMethod === 'oauth'}
        onChange={(e) => setAuthMethod(e.target.value)}
      />
      <div className="auth-method-card">
        <div className="auth-method-icon">🔐</div>
        <div className="auth-method-title">OAuth / SSO</div>
        <div className="auth-method-description">
          Sign in with Google, Microsoft, etc.
        </div>
      </div>
    </label>
  </div>
</div>

{/* Show username/password only for form-based auth */}
{authMethod === 'form' && (
  <>
    <div className="form-group">
      <label>Username / Email</label>
      <input value={username} onChange={...} />
    </div>

    <div className="form-group">
      <label>Password</label>
      <input type="password" value={password} onChange={...} />
    </div>
  </>
)}

{/* Show OAuth info for OAuth-based auth */}
{authMethod === 'oauth' && (
  <div className="oauth-info-box">
    <div className="oauth-info-icon">ℹ️</div>
    <div className="oauth-info-content">
      <strong>How OAuth login works:</strong>
      <ul>
        <li>A browser window will open with the website</li>
        <li>Log in using your Google/Microsoft account</li>
        <li>Complete any 2FA or security checks</li>
        <li>We'll save your session for future access</li>
      </ul>
      <p className="oauth-privacy-note">
        Your login credentials are never stored. We only save session cookies.
      </p>
    </div>
  </div>
)}
```

**State changes**:
```tsx
const [authMethod, setAuthMethod] = useState<'form' | 'oauth'>('form');
const [username, setUsername] = useState('');
const [password, setPassword] = useState('');
```

### 3. Manual OAuth Login Flow

**Create**: `/apps/desktop/src/webscraper/oauth-login.js`

```javascript
/**
 * OAuth Login Handler
 *
 * Provides manual login flow for OAuth-based websites.
 * Opens headful browser, waits for user to complete login,
 * then captures and saves session cookies.
 */

const { saveSession } = require('./session-manager');

class OAuthLoginHandler {
  constructor(browserController, username) {
    this.browser = browserController;
    this.username = username;
  }

  /**
   * Launch manual OAuth login flow
   * @param {Object} siteConfig - Site configuration
   * @param {Object} options - Login options
   * @returns {Promise<Object>} Login result
   */
  async launchManualLogin(siteConfig, options = {}) {
    console.log(`[OAuthLogin] Starting manual login for ${siteConfig.name}`);

    const page = await this.browser.newPage({
      headless: false, // IMPORTANT: visible browser for user
      sessionId: `oauth-login-${siteConfig.id}-${Date.now()}`
    });

    try {
      // Navigate to login URL
      console.log(`[OAuthLogin] Navigating to ${siteConfig.url}`);
      await page.goto(siteConfig.url, { waitUntil: 'networkidle0', timeout: 30000 });

      // Inject instruction overlay
      await this.injectInstructionOverlay(page, siteConfig);

      // Wait for user to complete login
      const loginSuccess = await this.waitForLoginCompletion(page, siteConfig, options.timeout || 300000);

      if (!loginSuccess) {
        throw new Error('Login timeout or cancelled by user');
      }

      // Save session cookies
      console.log(`[OAuthLogin] Saving session cookies`);
      await saveSession(page, this.username, siteConfig.id);

      // Verify we're actually logged in
      const isLoggedIn = await this.verifyLoginSuccess(page, siteConfig);
      if (!isLoggedIn) {
        throw new Error('Login verification failed');
      }

      console.log(`[OAuthLogin] Manual login successful for ${siteConfig.name}`);

      return {
        success: true,
        message: 'Login successful, session saved',
        sessionSaved: true
      };

    } catch (error) {
      console.error(`[OAuthLogin] Login failed:`, error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // Don't close page immediately - let user see success message
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.close().catch(() => {});
    }
  }

  /**
   * Inject instruction overlay into page
   * @param {Page} page - Puppeteer page
   * @param {Object} siteConfig - Site configuration
   */
  async injectInstructionOverlay(page, siteConfig) {
    await page.evaluate((siteName) => {
      const overlay = document.createElement('div');
      overlay.id = 'wovly-oauth-instructions';
      overlay.innerHTML = `
        <div style="
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          z-index: 999999;
          max-width: 350px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        ">
          <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">
            🔐 Setting up ${siteName}
          </div>
          <div style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
            Please complete the login process:
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Click "Sign in with Google" (or other OAuth)</li>
              <li>Enter your credentials</li>
              <li>Complete any 2FA verification</li>
            </ul>
          </div>
          <div style="
            background: rgba(255,255,255,0.2);
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
          ">
            ℹ️ Your session will be saved automatically once you're logged in.
          </div>
          <button
            id="wovly-oauth-done"
            style="
              margin-top: 16px;
              width: 100%;
              padding: 12px;
              background: white;
              color: #667eea;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              font-size: 14px;
            "
          >
            I'm Logged In - Continue
          </button>
          <button
            id="wovly-oauth-cancel"
            style="
              margin-top: 8px;
              width: 100%;
              padding: 10px;
              background: transparent;
              color: white;
              border: 1px solid rgba(255,255,255,0.3);
              border-radius: 8px;
              cursor: pointer;
              font-size: 13px;
            "
          >
            Cancel
          </button>
        </div>
      `;
      document.body.appendChild(overlay);
    }, siteConfig.name);

    // Expose functions for user interaction
    await page.exposeFunction('wovlyOAuthDone', () => {
      console.log('[OAuthLogin] User confirmed login completion');
    });

    await page.exposeFunction('wovlyOAuthCancel', () => {
      console.log('[OAuthLogin] User cancelled login');
    });

    // Attach event listeners
    await page.evaluate(() => {
      document.getElementById('wovly-oauth-done')?.addEventListener('click', () => {
        window.wovlyOAuthDone();
        document.getElementById('wovly-oauth-instructions').remove();
      });

      document.getElementById('wovly-oauth-cancel')?.addEventListener('click', () => {
        window.wovlyOAuthCancel();
        window.close();
      });
    });
  }

  /**
   * Wait for user to complete login
   * @param {Page} page - Puppeteer page
   * @param {Object} siteConfig - Site configuration
   * @param {number} timeout - Max wait time in milliseconds
   * @returns {Promise<boolean>} True if login completed
   */
  async waitForLoginCompletion(page, siteConfig, timeout = 300000) {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Check every 2 seconds if login is complete
      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        // Timeout check
        if (elapsed > timeout) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        // Check if page is closed (user cancelled)
        if (page.isClosed()) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        // Check if login successful
        const loggedIn = await this.verifyLoginSuccess(page, siteConfig);
        if (loggedIn) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

      }, 2000);
    });
  }

  /**
   * Verify login was successful
   * @param {Page} page - Puppeteer page
   * @param {Object} siteConfig - Site configuration
   * @returns {Promise<boolean>} True if logged in
   */
  async verifyLoginSuccess(page, siteConfig) {
    try {
      // Method 1: Check for success indicator
      if (siteConfig.oauth?.successDetectionSelector) {
        const successElement = await page.$(siteConfig.oauth.successDetectionSelector);
        if (successElement) {
          return true;
        }
      }

      // Method 2: Check that login page elements are gone
      if (siteConfig.oauth?.loginDetectionSelector) {
        const loginElement = await page.$(siteConfig.oauth.loginDetectionSelector);
        if (!loginElement) {
          // Login page gone = likely logged in
          return true;
        }
      }

      // Method 3: Check URL changed from login page
      const currentUrl = page.url();
      if (siteConfig.url && !currentUrl.includes('login') && !currentUrl.includes('signin')) {
        return true;
      }

      return false;

    } catch (error) {
      console.error('[OAuthLogin] Error verifying login:', error);
      return false;
    }
  }
}

module.exports = OAuthLoginHandler;
```

### 4. Modified Scraper Integration

**File**: `/apps/desktop/src/webscraper/scraper.js`

**Modify `scrapeMessages` method** (currently lines 60-120):

```javascript
async scrapeMessages(siteConfig) {
  console.log(`[WebScraper] Starting scrape for ${siteConfig.name}`);

  const sessionId = `webscraper-${siteConfig.id}`;
  const page = await this.browser.newPage({ sessionId });

  try {
    // Load existing session if available
    const sessionTimeout = siteConfig.sessionManagement?.sessionTimeout || 3600000;
    const hasValidSession = await this.loadAndValidateSession(page, siteConfig, sessionTimeout);

    // If no valid session, need to login
    if (!hasValidSession) {
      // MODIFIED: Check auth method
      if (siteConfig.authMethod === 'oauth') {
        // OAuth login requires manual user intervention
        console.log(`[WebScraper] OAuth site detected, cannot auto-login`);
        return {
          success: false,
          error: 'oauth_session_expired',
          message: 'Session expired. Please log in again via the Integrations page.',
          requiresManualLogin: true
        };
      } else {
        // Traditional form-based login (existing logic)
        await this.performLogin(page, siteConfig);
      }
    }

    // Execute navigation steps (existing logic)
    await this.executeNavigationSteps(page, siteConfig);

    // Extract messages (existing logic)
    const rawMessages = await this.extractMessages(page, siteConfig);

    // Convert to standard format (existing logic)
    const messages = this.convertToStandardFormat(rawMessages, siteConfig);

    console.log(`[WebScraper] Successfully scraped ${messages.length} messages`);

    return {
      success: true,
      messages,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[WebScraper] Error scraping ${siteConfig.name}:`, error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    await page.close().catch(() => {});
  }
}
```

### 5. AI Detection Enhancement

**File**: `/apps/desktop/src/webscraper/ai-selector-generator.js`

**Modify `analyzeUrl` function** to detect OAuth:

```javascript
async function analyzeUrl(url, siteType, username) {
  // ... existing code to load page and take screenshot ...

  const prompt = `Analyze this login page for ${url}.

Determine the authentication method and provide appropriate selectors.

HTML: ${html}
Screenshot: [attached]

Tasks:
1. **Detect authentication method**:
   - FORM: Traditional username/password fields with submit button
   - OAUTH: "Sign in with Google/Microsoft/Facebook" buttons, SSO redirects
   - If you see OAuth buttons, set authMethod to "oauth"

2. **For FORM auth**, provide selectors for:
   - usernameField (CSS selector)
   - passwordField (CSS selector)
   - submitButton (CSS selector)
   - successIndicator (element visible after login)

3. **For OAUTH auth**, provide selectors for:
   - loginDetectionSelector (element only visible when NOT logged in)
   - successDetectionSelector (element only visible when logged in)
   - oauthProvider (detect: "google", "microsoft", "facebook", or "generic")

Return JSON:
{
  "authMethod": "form" | "oauth",
  "confidence": "high|medium|low",

  // For form-based auth
  "login": {
    "usernameField": "...",
    "passwordField": "...",
    "submitButton": "...",
    "successIndicator": "..."
  },

  // For OAuth-based auth
  "oauth": {
    "oauthProvider": "google" | "microsoft" | "facebook" | "generic",
    "loginDetectionSelector": "button:contains('Sign in')",
    "successDetectionSelector": "div.user-menu",
    "requiresManualLogin": true
  }
}`;

  // ... rest of existing LLM call ...
}
```

### 6. Setup Wizard Flow Changes

**File**: `/apps/ui/src/components/webscraper/AddWebIntegrationModal.tsx`

**Modified wizard steps**:

```
Step 1: Basic Info
  ↓
  - If authMethod === 'form': collect username/password
  - If authMethod === 'oauth': show OAuth info box
  ↓
Step 2: AI Analysis
  ↓
  - Detects actual auth method from page
  - May override user selection if wrong
  - Shows detected OAuth provider
  ↓
Step 3a: Form Login Setup (if form)
  ↓
  - AI suggests login selectors
  - User can refine with visual tool
  - Test automated login
  ↓
Step 3b: OAuth Login (if OAuth)
  ↓
  - "Please log in manually" button
  - Opens headful browser
  - User completes OAuth flow
  - Session captured automatically
  - Shows "✓ Login successful, session saved"
  ↓
Step 4: Navigation Recording
  ↓
  - Same for both auth methods
  - Record clicks to messages area
  ↓
Step 5: Message Extraction
  ↓
  - Same for both auth methods
  - AI + visual selector for messages
  ↓
Step 6: Test & Save
  ↓
  - Test full flow with saved session
  - Save configuration
```

**Step 3b Implementation**:

```tsx
{step === 3 && authMethod === 'oauth' && (
  <div className="wizard-step oauth-login-step">
    <h3>OAuth Login Setup</h3>

    <div className="oauth-detection-info">
      {aiAnalysis?.oauth?.oauthProvider && (
        <div className="detected-provider">
          <span className="provider-icon">
            {aiAnalysis.oauth.oauthProvider === 'google' && '🔵'}
            {aiAnalysis.oauth.oauthProvider === 'microsoft' && '🟦'}
            {aiAnalysis.oauth.oauthProvider === 'facebook' && '🔷'}
          </span>
          <span className="provider-name">
            Detected: Sign in with {aiAnalysis.oauth.oauthProvider}
          </span>
        </div>
      )}
    </div>

    <div className="oauth-instructions">
      <h4>How this works:</h4>
      <ol>
        <li>Click the button below to open a browser window</li>
        <li>Complete the login process (including any 2FA)</li>
        <li>Once logged in, click "I'm Logged In - Continue"</li>
        <li>Your session will be saved automatically</li>
      </ol>
    </div>

    {!oauthLoginComplete ? (
      <button
        className="btn btn-primary btn-large"
        onClick={handleOAuthLogin}
        disabled={oauthLoginInProgress}
      >
        {oauthLoginInProgress ? (
          <>
            <span className="spinner"></span>
            Waiting for login...
          </>
        ) : (
          <>
            🔐 Open Browser & Log In
          </>
        )}
      </button>
    ) : (
      <div className="oauth-success">
        <div className="success-icon">✓</div>
        <div className="success-message">
          <strong>Login Successful!</strong>
          <p>Your session has been saved. You can now continue with setup.</p>
        </div>
      </div>
    )}

    {oauthError && (
      <div className="error-box">
        <span className="error-icon">⚠️</span>
        <span>{oauthError}</span>
      </div>
    )}

    <div className="wizard-actions">
      <button className="btn btn-ghost" onClick={() => setStep(2)}>Back</button>
      <button
        className="btn btn-primary"
        onClick={() => setStep(4)}
        disabled={!oauthLoginComplete}
      >
        Next: Navigation
      </button>
    </div>
  </div>
)}
```

**Handler implementation**:

```tsx
const handleOAuthLogin = async () => {
  setOAuthLoginInProgress(true);
  setOAuthError(null);

  try {
    // Call backend to launch OAuth login flow
    const result = await (window as any).wovly.webscraper.launchOAuthLogin({
      url,
      siteName,
      oauth: aiAnalysis.oauth
    });

    if (result.success) {
      setOAuthLoginComplete(true);
      setSessionSaved(true);
    } else {
      setOAuthError(result.error || 'Login failed');
    }
  } catch (err: any) {
    setOAuthError(err.message || 'Login failed');
  } finally {
    setOAuthLoginInProgress(false);
  }
};
```

### 7. IPC Handler for OAuth Login

**File**: `/apps/desktop/main.js`

**Add new IPC handler** (after existing webscraper handlers ~line 5860):

```javascript
ipcMain.handle("webscraper:launchOAuthLogin", async (_event, { url, siteName, oauth }) => {
  try {
    if (!currentUser) {
      return { success: false, error: 'No user logged in' };
    }

    const { default: OAuthLoginHandler } = require('./src/webscraper/oauth-login');
    const { default: browserController } = require('./src/browser/controller');

    // Create temporary site config for OAuth login
    const tempConfig = {
      id: `temp-${Date.now()}`,
      name: siteName,
      url,
      authMethod: 'oauth',
      oauth: {
        oauthProvider: oauth?.oauthProvider || 'generic',
        loginDetectionSelector: oauth?.loginDetectionSelector,
        successDetectionSelector: oauth?.successDetectionSelector,
        requiresManualLogin: true
      }
    };

    const oauthHandler = new OAuthLoginHandler(browserController, currentUser.username);
    const result = await oauthHandler.launchManualLogin(tempConfig, { timeout: 300000 });

    return result;

  } catch (error) {
    console.error('[IPC] OAuth login error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});
```

**Add to preload** (`/apps/desktop/preload.js` line ~259):

```javascript
webscraper: {
  // ... existing methods ...
  launchOAuthLogin: (config) => ipcRenderer.invoke("webscraper:launchOAuthLogin", config)
}
```

### 8. Session Expiry Handling

**File**: `/apps/desktop/src/insights/processor.js`

**Modify `collectWebScraperMessages`** (currently line ~450):

```javascript
async function collectWebScraperMessages(username, sinceTimestamp, contactMappings = {}) {
  const configManager = require('../webscraper/config-manager');
  const sites = await configManager.listIntegrations(username);
  const enabledSites = sites.filter(s => s.enabled && !s.status?.paused);

  const scraper = new WebScraper(browserController, username);
  const messages = [];
  const expiredOAuthSites = []; // Track OAuth sites needing re-login

  for (const siteConfig of enabledSites) {
    try {
      const result = await scraper.scrapeMessages(siteConfig);

      if (result.success) {
        // Save messages to persistent storage
        const today = new Date().toISOString().split('T')[0];
        await webMessages.saveMessages(username, siteConfig.id, result.messages);
        await webMessages.appendToAnalyzedMarkdown(username, today, siteConfig.id, siteConfig.name, result.messages);

        // Filter new messages
        const newMessages = result.messages.filter(m =>
          new Date(m.timestamp) > new Date(sinceTimestamp)
        );

        messages.push(...newMessages);

      } else {
        // NEW: Check if OAuth session expired
        if (result.error === 'oauth_session_expired' || result.requiresManualLogin) {
          console.log(`[Insights] OAuth session expired for ${siteConfig.name}`);
          expiredOAuthSites.push({
            siteId: siteConfig.id,
            siteName: siteConfig.name,
            authMethod: siteConfig.authMethod
          });

          // Try to use cached messages as fallback
          const cached = await webMessages.loadMessagesSince(username, siteConfig.id, sinceTimestamp, 7);
          if (cached.length > 0) {
            messages.push(...cached.map(m => ({ ...m, _cached: true })));
          }
        } else {
          // Other errors - try cache fallback
          const cached = await webMessages.loadMessagesSince(username, siteConfig.id, sinceTimestamp, 7);
          if (cached.length > 0) {
            messages.push(...cached);
          }
        }

        // Increment failure count
        siteConfig.status = siteConfig.status || {};
        siteConfig.status.consecutiveFailures = (siteConfig.status.consecutiveFailures || 0) + 1;
        siteConfig.status.lastError = result.error;

        // Auto-pause after 3 failures (but not for OAuth expiry - we notify instead)
        if (siteConfig.status.consecutiveFailures >= 3 && !result.requiresManualLogin) {
          siteConfig.status.paused = true;
        }

        await configManager.updateIntegration(username, siteConfig.id, {
          'status.consecutiveFailures': siteConfig.status.consecutiveFailures,
          'status.lastError': siteConfig.status.lastError,
          'status.paused': siteConfig.status.paused
        });
      }

    } catch (error) {
      console.error(`[Insights] Error collecting from ${siteConfig.name}:`, error);
    }
  }

  // NEW: Send notification for expired OAuth sessions
  if (expiredOAuthSites.length > 0) {
    sendOAuthReloginNotification(mainWindow, expiredOAuthSites);
  }

  return messages;
}
```

**Add notification function**:

```javascript
function sendOAuthReloginNotification(mainWindow, expiredSites) {
  if (!mainWindow) return;

  mainWindow.webContents.send('webscraper:oauthExpired', {
    sites: expiredSites,
    message: `Session expired for ${expiredSites.length} OAuth integration(s). Please log in again.`
  });
}
```

### 9. UI Notification Handler

**File**: `/apps/ui/src/App.tsx`

**Add listener** (in useEffect with other listeners):

```tsx
useEffect(() => {
  // ... existing listeners ...

  // NEW: OAuth session expiry notification
  const handleOAuthExpired = (data: any) => {
    const siteNames = data.sites.map((s: any) => s.siteName).join(', ');

    setNotification({
      type: 'warning',
      message: `Session expired for: ${siteNames}`,
      action: {
        label: 'Re-login',
        onClick: () => {
          setCurrentView('integrations');
          // TODO: Open re-login modal for first expired site
        }
      },
      persistent: true
    });
  };

  const unsubscribeOAuthExpired = (window as any).wovly?.webscraper?.onOAuthExpired?.(handleOAuthExpired);

  return () => {
    unsubscribeOAuthExpired?.();
  };
}, []);
```

**Add to preload** (`/apps/desktop/preload.js`):

```javascript
webscraper: {
  // ... existing ...
  onOAuthExpired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('webscraper:oauthExpired', handler);
    return () => ipcRenderer.removeListener('webscraper:oauthExpired', handler);
  }
}
```

### 10. Re-login Flow in Management UI

**File**: `/apps/ui/src/components/webscraper/ManageWebIntegrationsModal.tsx`

**Add re-login button for OAuth sites**:

```tsx
{integration.authMethod === 'oauth' && integration.status?.lastError === 'oauth_session_expired' && (
  <button
    className="btn btn-sm btn-warning"
    onClick={() => handleRelogin(integration.id)}
  >
    🔐 Re-login Required
  </button>
)}
```

**Handler**:

```tsx
const handleRelogin = async (siteId: string) => {
  try {
    const integration = integrations.find(i => i.id === siteId);
    if (!integration) return;

    setError(null);

    // Launch OAuth login flow
    const result = await (window as any).wovly.webscraper.launchOAuthLogin({
      url: integration.url,
      siteName: integration.name,
      oauth: integration.oauth
    });

    if (result.success) {
      // Clear error status
      await (window as any).wovly.webscraper.updateIntegration(siteId, {
        'status.lastError': null,
        'status.consecutiveFailures': 0,
        'status.paused': false
      });

      await loadIntegrations();

      alert('Re-login successful! Integration is now active.');
    } else {
      setError(result.error || 'Re-login failed');
    }
  } catch (err: any) {
    setError(err.message || 'Re-login failed');
  }
};
```

## Critical Files Summary

### New Files (Create)

```
apps/desktop/src/webscraper/
└── oauth-login.js                 # Manual OAuth login handler (~250 lines)
```

### Modified Files

1. **`/apps/ui/src/components/webscraper/AddWebIntegrationModal.tsx`** (~line 50-150)
   - Add auth method selector (radio buttons)
   - Show username/password conditionally (form only)
   - Show OAuth info box (OAuth only)
   - Add Step 3b: OAuth login flow
   - Add `handleOAuthLogin` function
   - Add state: `authMethod`, `oauthLoginComplete`, `oauthLoginInProgress`

2. **`/apps/desktop/src/webscraper/scraper.js`** (line ~85)
   - Modify `scrapeMessages` to check `authMethod`
   - Return `requiresManualLogin` error for expired OAuth sessions
   - Skip auto-login for OAuth sites

3. **`/apps/desktop/src/webscraper/ai-selector-generator.js`** (~line 30)
   - Enhance prompt to detect OAuth buttons
   - Return `authMethod` and `oauth` object in analysis
   - Detect OAuth provider (Google, Microsoft, etc.)

4. **`/apps/desktop/src/insights/processor.js`** (line ~450)
   - Track expired OAuth sites
   - Send notification for OAuth re-login needed
   - Don't auto-pause OAuth sites on session expiry

5. **`/apps/desktop/main.js`** (~line 5860)
   - Add IPC handler: `webscraper:launchOAuthLogin`
   - Add notification sender for OAuth expiry

6. **`/apps/desktop/preload.js`** (~line 259)
   - Add `launchOAuthLogin` binding
   - Add `onOAuthExpired` event listener

7. **`/apps/ui/src/App.tsx`** (multiple locations)
   - Add OAuth expiry notification listener
   - Show persistent notification with re-login action

8. **`/apps/ui/src/components/webscraper/ManageWebIntegrationsModal.tsx`** (~line 245)
   - Add "Re-login Required" button for expired OAuth sessions
   - Add `handleRelogin` function

## CSS Additions

**File**: `/apps/ui/src/components/webscraper/WebIntegrationModal.css`

```css
/* Auth method selector */
.auth-method-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.auth-method-option {
  cursor: pointer;
}

.auth-method-option input[type="radio"] {
  display: none;
}

.auth-method-card {
  border: 2px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  text-align: center;
  transition: all 0.2s;
}

.auth-method-option input[type="radio"]:checked + .auth-method-card {
  border-color: var(--color-primary);
  background: var(--color-primary-alpha-10);
}

.auth-method-card:hover {
  border-color: var(--color-primary);
}

.auth-method-icon {
  font-size: 40px;
  margin-bottom: var(--space-2);
}

.auth-method-title {
  font-weight: 600;
  margin-bottom: var(--space-1);
}

.auth-method-description {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

/* OAuth info box */
.oauth-info-box {
  background: var(--color-info-bg);
  border: 1px solid var(--color-info-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  gap: var(--space-3);
}

.oauth-info-icon {
  font-size: 24px;
}

.oauth-info-content ul {
  margin: var(--space-2) 0;
  padding-left: var(--space-4);
}

.oauth-info-content li {
  margin: var(--space-1) 0;
}

.oauth-privacy-note {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  font-style: italic;
}

/* OAuth login step */
.oauth-login-step {
  text-align: center;
}

.detected-provider {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--color-success-bg);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
}

.provider-icon {
  font-size: 20px;
}

.oauth-instructions {
  text-align: left;
  background: var(--color-bg-secondary);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  margin: var(--space-4) 0;
}

.oauth-instructions h4 {
  margin-bottom: var(--space-2);
}

.oauth-instructions ol {
  margin: var(--space-2) 0;
  padding-left: var(--space-4);
}

.oauth-instructions li {
  margin: var(--space-2) 0;
}

.oauth-success {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  margin: var(--space-4) 0;
}

.oauth-success .success-icon {
  font-size: 40px;
  color: var(--color-success);
}

.oauth-success .success-message {
  text-align: left;
}

.btn-warning {
  background: var(--color-warning);
  color: white;
}

.btn-warning:hover {
  background: var(--color-warning-dark);
}
```

## Implementation Sequence

### Phase 1: Core OAuth Infrastructure (Week 1)
1. Create `oauth-login.js` with manual login flow
2. Add IPC handler for OAuth login
3. Test manual OAuth flow with a simple OAuth site
4. Verify session capture and persistence

### Phase 2: UI Integration (Week 2)
1. Modify AddWebIntegrationModal Step 1 (auth method selector)
2. Add Step 3b (OAuth login flow)
3. Add CSS for auth method cards and OAuth UI
4. Test end-to-end setup wizard with OAuth site

### Phase 3: AI Detection (Week 3)
1. Enhance AI prompt to detect OAuth
2. Test OAuth detection accuracy on 5-10 sites
3. Add OAuth provider detection
4. Integrate detected auth method into wizard flow

### Phase 4: Session Management (Week 4)
1. Modify scraper to handle OAuth session expiry
2. Add OAuth expiry notification system
3. Add re-login flow to ManageWebIntegrationsModal
4. Test session expiry and re-login UX

### Phase 5: Testing & Polish (Week 5)
1. E2E tests with real OAuth sites (Notion, Figma, school portals)
2. Test session persistence (wait 7+ days, verify still works)
3. Test session expiry and re-login flow
4. UI/UX refinements based on testing

## Verification Steps

### 1. OAuth Detection Test
```javascript
// Test with Notion login page
const result = await analyzeUrl('https://www.notion.so/login', 'productivity');

// Verify:
// - authMethod: 'oauth'
// - oauth.oauthProvider: 'google'
// - oauth.loginDetectionSelector exists
// - oauth.successDetectionSelector exists
```

### 2. Manual OAuth Login Test
```javascript
// Launch OAuth login for Notion
const config = {
  id: 'notion-test',
  name: 'Notion',
  url: 'https://www.notion.so/login',
  authMethod: 'oauth',
  oauth: {
    oauthProvider: 'google',
    loginDetectionSelector: 'button:contains("Sign in")',
    successDetectionSelector: 'div.notion-topbar'
  }
};

const handler = new OAuthLoginHandler(browserController, 'testuser');
const result = await handler.launchManualLogin(config);

// Verify:
// - Browser opens (headful)
// - Instruction overlay visible
// - User can log in with Google
// - Session cookies saved
// - result.success === true
```

### 3. Setup Wizard Flow Test (OAuth)
```javascript
// 1. Start wizard, enter Notion URL
// 2. Select "OAuth / SSO" auth method
// 3. Click "Next: AI Analysis"
// 4. Verify AI detects OAuth (shows "Detected: Google")
// 5. Click "Open Browser & Log In"
// 6. Complete OAuth flow in browser
// 7. Verify "✓ Login successful" message
// 8. Complete navigation and message extraction
// 9. Save integration
// 10. Verify appears in integrations list
```

### 4. Session Reuse Test
```javascript
// 1. Set up OAuth integration (Notion)
// 2. Trigger manual scrape (uses saved session)
// 3. Verify login page NOT shown
// 4. Verify messages extracted successfully
// 5. Check logs: "Loaded session for notion (age: Xs)"
```

### 5. Session Expiry Test
```javascript
// 1. Set up OAuth integration
// 2. Manually delete session file
// 3. Trigger insights collection
// 4. Verify error: 'oauth_session_expired'
// 5. Verify notification appears in UI
// 6. Click "Re-login" button
// 7. Complete OAuth flow
// 8. Verify integration works again
```

### 6. Mixed Auth Test
```javascript
// 1. Set up 2 integrations:
//    - Brightwheel (form-based)
//    - Notion (OAuth-based)
// 2. Trigger insights collection
// 3. Verify both scraped successfully
// 4. Expire Brightwheel session → auto re-login works
// 5. Expire Notion session → notification shown, manual re-login required
```

## Design Decisions

### 1. Manual OAuth vs Automated OAuth
**Decision**: Manual user login for OAuth sites
**Rationale**:
- Google/Microsoft detect and block automated logins
- 2FA cannot be automated
- Session cookies work for weeks/months - manual login is rare
- Reduces complexity and failure rate

### 2. Auth Method Selection in UI
**Decision**: User selects auth method upfront in Step 1
**Rationale**:
- Clear user intent from the start
- AI can override if detection differs from selection
- Better UX than requiring username/password then discovering OAuth
- Educational - users learn their site's auth method

### 3. Session Timeout for OAuth Sites
**Decision**: Longer timeout (7 days default) for OAuth vs form-based (1 hour default)
**Rationale**:
- OAuth sessions typically last much longer
- Re-login is manual (not automated), so minimize frequency
- Can configure per-site if needed

### 4. Notification vs Auto-Pause for OAuth Expiry
**Decision**: Send notification for re-login, don't auto-pause
**Rationale**:
- OAuth expiry is expected and easily fixable (user logs in)
- Auto-pause would be annoying for normal session expiry
- Notification keeps user informed without blocking

### 5. Headful Browser for OAuth Login
**Decision**: Always use headful (visible) browser for OAuth
**Rationale**:
- User needs to see OAuth provider page
- Helps user understand what's happening
- Debugging easier (can see errors)
- Required for user interaction

### 6. Store Auth Method in Config
**Decision**: Add `authMethod` field to site config
**Rationale**:
- Scraper needs to know whether to attempt auto-login
- Affects error handling (OAuth expiry vs form failure)
- Enables different session timeout defaults
- Future-proof for other auth methods (SAML, etc.)

---

## Success Metrics

After implementation, OAuth support should enable:
- ✅ 50%+ more websites supported (many modern sites use OAuth)
- ✅ 95%+ success rate for OAuth logins (manual = reliable)
- ✅ <1 re-login per month per site (long session persistence)
- ✅ <30 seconds for OAuth login during setup
- ✅ Zero credentials stored for OAuth sites (privacy win)

## User Benefits

1. **Access more websites**: Notion, Figma, Miro, Google Workspace portals
2. **Better security**: No password storage for OAuth sites
3. **2FA compatible**: Manual login handles any 2FA method
4. **Rare re-login**: Sessions last weeks, minimal maintenance
5. **Clear UX**: Know upfront if site supports OAuth
