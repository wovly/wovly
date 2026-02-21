# Powerful Integrations

<p align="center">
  <img src="../../../../assets/integrations.png" alt="Integrations" width="800">
</p>

## Overview

Wovly connects to your favorite tools and platforms to provide a unified view of your communications and data. From email and messaging apps to productivity tools and custom websites, integrations enable Wovly to analyze, search, and act on information across your entire digital workspace.

## Available Integrations

### Communication Platforms

#### Gmail & Google Calendar
**Capabilities:**
- Read and send emails
- Search inbox and threads
- Create calendar events
- Check availability
- Get meeting details

**Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** and **Google Calendar API**
4. Create OAuth 2.0 credentials (Desktop app type)
5. In Wovly: **Integrations → Google Workspace**
6. Enter Client ID and Client Secret
7. Click **Authenticate** and grant permissions

**Configuration:**
```json
{
  "clientId": "your-client-id.apps.googleusercontent.com",
  "clientSecret": "your-client-secret"
}
```

**Required Scopes:**
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events`

**Tools Available:**
- `search_emails` - Full-text email search
- `get_email_content` - Read specific email
- `send_email` - Send new email or reply
- `get_calendar_events` - Fetch upcoming events
- `create_calendar_event` - Schedule new meeting

---

#### Slack
**Capabilities:**
- Send messages to channels and DMs
- Read channel history
- Search conversations
- List channels and users
- Get user information

**Setup:**
1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create new app "From scratch"
3. Add **User Token Scopes**:
   - `channels:history`, `channels:read`, `chat:write`
   - `groups:history`, `groups:read`
   - `im:history`, `im:read`, `im:write`
   - `users:read`
4. Install app to workspace
5. In Wovly: **Integrations → Slack**
6. Enter User OAuth Token

**Tools Available:**
- `send_slack_message` - Send to channel or user
- `get_slack_messages` - Read channel/DM history
- `list_slack_channels` - List available channels
- `search_slack` - Search workspace messages
- `lookup_slack_user` - Get user details

---

#### iMessage (macOS only)
**Capabilities:**
- Send text messages
- Read conversation history
- Search messages by contact or content
- Resolve contact names

**Setup:**
- Works automatically on macOS
- Grant **Contacts** access when prompted
- **Full Disk Access** required for message history:
  1. System Settings → Privacy & Security → Full Disk Access
  2. Add Wovly to the list

**Tools Available:**
- `send_imessage` - Send text to contact
- `search_imessage` - Search messages
- `get_recent_imessages` - Fetch recent conversations
- `lookup_contact` - Resolve contact info

**Privacy Note:**
iMessage integration reads from your local SQLite database (`~/Library/Messages/chat.db`). No data leaves your machine except when explicitly sent to your LLM provider for analysis.

---

#### WhatsApp
**Capabilities:**
- Two-way messaging (send and receive)
- Remote control interface
- Chat with Wovly from your phone
- Group messaging support

**Setup:**
1. In Wovly: **Integrations → WhatsApp**
2. Scan QR code with WhatsApp mobile app
3. Grant permissions to send/receive messages
4. Configure allowed numbers (optional security)

**Usage:**
- Send messages to Wovly's WhatsApp number to issue commands remotely
- Example: "What emails did I get today?"
- Wovly responds via WhatsApp with summaries and actions

**Tools Available:**
- `send_whatsapp_message` - Send to contact or group
- `get_whatsapp_messages` - Read conversation

---

#### Telegram
**Capabilities:**
- Bot interface for remote commands
- Notification delivery
- Async task monitoring

**Setup:**
1. Create Telegram bot via [@BotFather](https://t.me/botfather)
2. Get bot token
3. In Wovly: **Integrations → Telegram**
4. Enter bot token
5. Start conversation with your bot

**Usage:**
- Message your bot to interact with Wovly
- Receive notifications for important events
- Monitor long-running tasks

---

#### Discord
**Capabilities:**
- Send messages to servers and channels
- Read channel history
- Monitor specific channels

**Setup:**
1. Create Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create bot and get token
3. Invite bot to your server
4. In Wovly: **Integrations → Discord**
5. Enter bot token

**Tools Available:**
- `send_discord_message` - Send to channel
- `get_discord_messages` - Read history

---

### Productivity Tools

#### Notion
**Capabilities:**
- Read pages and databases
- Query database entries
- Search workspace

**Setup:**
1. Create Notion integration at [Notion Integrations](https://www.notion.so/my-integrations)
2. Get integration token
3. Share relevant pages/databases with integration
4. In Wovly: **Integrations → Notion**
5. Enter integration token

**Tools Available:**
- `search_notion` - Search workspace
- `get_notion_page` - Read specific page
- `query_notion_database` - Query database

---

#### Asana
**Capabilities:**
- Create tasks and projects
- Read task details
- Update task status
- Query workspaces

**Setup:**
1. Get Asana Personal Access Token from [Asana App Settings](https://app.asana.com/0/my-apps)
2. In Wovly: **Integrations → Asana**
3. Enter access token

**Tools Available:**
- `create_asana_task` - Create new task
- `get_asana_tasks` - List tasks
- `update_asana_task` - Modify task

---

#### GitHub
**Capabilities:**
- Access repositories
- Read issues and PRs
- Create issues
- Search code

**Setup:**
1. Create GitHub Personal Access Token at [GitHub Settings](https://github.com/settings/tokens)
2. Grant repo permissions
3. In Wovly: **Integrations → GitHub**
4. Enter token

**Tools Available:**
- `search_github_repos` - Find repositories
- `get_github_issues` - List issues
- `create_github_issue` - Create issue

---

### Content Platforms

#### Reddit
**Capabilities:**
- Browse posts
- Read comments
- Search subreddits

**Setup:**
1. Create Reddit app at [Reddit Apps](https://www.reddit.com/prefs/apps)
2. Get client ID and secret
3. In Wovly: **Integrations → Reddit**
4. Enter credentials

---

#### Spotify
**Capabilities:**
- Control playback
- Search music
- Get current track

**Setup:**
1. Create Spotify app at [Spotify Dashboard](https://developer.spotify.com/dashboard)
2. Get client ID and secret
3. In Wovly: **Integrations → Spotify**
4. Authenticate with OAuth

---

### Custom Websites

#### Web Scraper (No API Required)
**Capabilities:**
- Extract messages from any website
- Login automation
- Session persistence
- Multi-step navigation
- AI-powered selector detection

**Use Cases:**
- Daycare portals (Brightwheel, Procare)
- Tax accountant sites
- School systems
- Internal company tools
- Any site without an API

**Setup Wizard:**

**Step 1: Basic Info**
- Enter website URL
- Name your integration (e.g., "Brightwheel")
- Add credentials (username/password)

**Step 2: AI Analysis**
- Wovly analyzes the page with Claude
- Suggests login field selectors
- Identifies message structure
- Returns confidence score

**Step 3: Visual Refinement** (Optional)
- Click-to-select elements
- Hover highlighting
- Test selectors in real-time
- Edit CSS selectors manually

**Step 4: Navigation Recording**
- **Option A:** Use AI-suggested steps
- **Option B:** Record manually:
  - Click "🔴 Start Recording"
  - Navigate through the site (click Messages → Inbox → etc.)
  - System captures each step automatically
  - Review and edit sequence
  - Test playback

**Step 5: Message Extraction**
- Define message container selector
- Specify sender, content, timestamp selectors
- AI suggests selectors, visual tool for refinement

**Step 6: Test Configuration**
- Full flow test (login → navigate → extract)
- Verify messages appear correctly
- Check contact resolution

**Step 7: Save & Enable**
- Configuration saved to `~/.wovly-assistant/users/{username}/web-integrations/`
- Hourly checks scheduled automatically
- Messages appear in insights alongside Gmail/Slack

**Session Management:**
- Cookies saved after first login
- No re-login until session expires
- Automatic re-authentication on expiry
- Configurable session timeout

**Error Handling:**
- Detects page structure changes
- Auto-retries on network errors
- Pauses after 3 consecutive failures
- Email notification on critical errors

**Example Configuration:**
```json
{
  "id": "brightwheel",
  "name": "Brightwheel Daycare",
  "url": "https://schools.mybrightwheel.com/sign-in",
  "enabled": true,
  "selectors": {
    "login": {
      "usernameField": "input[name='email']",
      "passwordField": "input[name='password']",
      "submitButton": "button[type='submit']",
      "successIndicator": "div.dashboard"
    },
    "navigation": [
      {
        "step": 1,
        "action": "click",
        "selector": "a[href*='/messages']",
        "waitFor": "div.messages-container",
        "description": "Click Messages tab"
      }
    ],
    "messages": {
      "container": "div.messages-list",
      "messageItem": "div.message-card",
      "sender": ".message-author",
      "content": ".message-body",
      "timestamp": ".message-date"
    }
  }
}
```

**Storage:**
- Raw messages: `~/.wovly-assistant/users/{username}/web-integrations/messages/raw/{site-id}/`
- Session data: `~/.wovly-assistant/users/{username}/web-integrations/sessions/`
- Message retention: 90 days (configurable)

**Tools Available:**
- `search_custom_web_messages` - Search scraped messages
- `get_recent_custom_web_messages` - Recent messages from configured sites
- `get_custom_web_messages_by_date` - Date-range queries
- `list_custom_web_sites` - List configured integrations

---

### Browser Automation

#### Puppeteer Controller
**Capabilities:**
- Navigate websites
- Fill forms
- Extract data
- Take screenshots
- Execute JavaScript

**Usage:**
Ask Wovly to perform browser tasks:
- "Go to LinkedIn and get John's profile summary"
- "Check flight prices from Boston to Miami on Google Flights"
- "Fill out the contact form on example.com with my info"

**Technical Details:**
- Headless Chromium via Puppeteer
- Per-user browser sessions
- Cookie persistence
- JavaScript execution
- Screenshot capture

**Storage:**
- Browser data: `~/.wovly-assistant/users/{username}/browser-data/`
- Session cookies preserved between runs
- User agent: Desktop Chrome

---

## Integration Status

### Connection States

**Connected** (Green background)
- Integration authenticated and working
- Credentials valid
- Recent successful API calls

**Not Configured** (Default background)
- Integration available but not set up
- No credentials entered
- Not authenticated

**Error** (Red indicator)
- Authentication failed
- Credentials expired
- API quota exceeded
- Rate limited

**Paused** (Yellow indicator)
- Temporarily disabled by user
- Auto-paused after failures (custom websites)
- Waiting for user action

### Managing Integrations

**Enable/Disable:**
- Click integration card
- Toggle "Enabled" switch
- Saves immediately

**Test Connection:**
- Click "Test" button
- Verifies credentials
- Shows success/error message

**Reconfigure:**
- Click "Settings" on integration card
- Update credentials
- Re-authenticate if needed

**Remove:**
- Click "Remove" button
- Confirms before deletion
- Credentials securely deleted from keychain

---

## Security & Privacy

### Credential Storage

All credentials encrypted using OS-level encryption:
- **macOS:** Keychain
- **Windows:** DPAPI (Data Protection API)
- **Linux:** libsecret

Credentials never stored in plain text.

### Token Refresh

OAuth tokens automatically refreshed:
- Gmail/Calendar: Refresh token stored securely
- Slack: Long-lived tokens with workspace persistence
- Other OAuth: Follows standard refresh flow

### Data Access

**What Wovly accesses:**
- Only data you explicitly grant permissions for
- Inbox, calendar, messages based on enabled integrations
- No access to data from disabled integrations

**What Wovly sends to LLMs:**
- Message content for analysis (insights, chat queries)
- Context from your profile and memory
- Search results and extracted data

**What Wovly never does:**
- Send credentials to LLM providers
- Store data in the cloud
- Share data with third parties
- Track usage or analytics

### Per-User Isolation

Multi-user support with complete data separation:
```
~/.wovly-assistant/
  users/
    alice/
      settings.json     # Alice's API keys
      credentials.enc   # Alice's encrypted credentials
      memory/           # Alice's data
    bob/
      settings.json     # Bob's API keys (separate)
      credentials.enc   # Bob's encrypted credentials
      memory/           # Bob's data (isolated)
```

---

## Rate Limits & Quotas

### Gmail API
- **Free tier:** 1 billion quota units/day
- **Typical usage:** ~50-100 units per email read
- **Wovly impact:** Minimal (hourly checks use ~1,000 units)

### Slack API
- **Tier 2-4:** 20+ requests per minute
- **Wovly usage:** 5-10 requests per hour

### Custom Websites
- **No official API rate limits**
- **Best practice:** 1 scrape per hour (configurable)
- **Session reuse:** Reduces login frequency

### LLM Providers
- **Anthropic Claude:** Varies by plan (typically 5-20 RPM)
- **OpenAI GPT:** Varies by tier
- **Google Gemini:** 60 requests per minute (free tier)

**Wovly optimization:**
- Batches requests when possible
- Caches responses (1-hour TTL)
- Uses Haiku for simple tasks (lower cost)
- Prompt caching reduces token usage by 50-90%

---

## Troubleshooting

### Gmail Not Connecting

**Error:** "Invalid credentials"
- Verify Client ID and Secret are correct
- Ensure OAuth consent screen is configured
- Check that Gmail API is enabled in Google Cloud Console

**Error:** "Insufficient permissions"
- Re-authenticate with updated scopes
- Grant all requested permissions
- Check OAuth consent screen approved scopes

### Slack Messages Not Showing

**Possible causes:**
- Bot not added to channels
- User token lacks required scopes
- Private channels need explicit invitation

**Solutions:**
- Add bot to channels: `/invite @WovlyBot`
- Regenerate token with all scopes
- Invite bot to private channels

### iMessage Not Working

**Error:** "Cannot access chat database"
- Grant Full Disk Access in System Settings
- Restart Wovly after granting access
- Check that Messages app is configured

**Error:** "Contact not found"
- Ensure contact exists in Contacts app
- Try full name or phone number
- Check contact has iMessage enabled

### Custom Website Failing

**Error:** "Login failed"
- Verify credentials are correct
- Check if site requires 2FA (not supported)
- Ensure selectors haven't changed

**Error:** "Page structure changed"
- Site updated layout
- Re-run visual selector tool
- Update selectors in configuration

**Error:** "Session expired"
- Normal behavior, will re-login automatically
- Check if site has aggressive timeout
- Increase check frequency if needed

### Browser Automation Timeout

**Error:** "Navigation timeout"
- Slow website response
- Increase timeout in request
- Check internet connection

**Error:** "Element not found"
- Selector may be incorrect
- Try visual selector tool
- Inspect page HTML

---

## Best Practices

### 1. Connect All Your Platforms

The more integrations you enable, the better insights Wovly can provide:
- Enable Gmail for email context
- Add Slack for team communication
- Connect iMessage for personal messages
- Configure custom websites for unique sources

Cross-platform insights are most valuable (e.g., detecting that an email client request conflicts with a Slack team meeting).

### 2. Use Custom Websites for Unique Sources

Don't let lack of API stop you:
- Daycare portals often have critical updates
- Tax accountant sites have time-sensitive docs
- School systems send important notices
- Internal company tools may lack APIs

The web scraper makes these accessible.

### 3. Keep Credentials Up to Date

Set calendar reminders:
- Refresh tokens expire (usually 90 days for OAuth)
- Passwords change
- API keys rotate

Wovly will notify you when re-authentication is needed.

### 4. Test After Setup

After adding integration:
- Click "Test" button
- Verify messages appear in insights
- Try querying the integration via chat
- Check that tools work correctly

### 5. Monitor for Errors

Check integration status regularly:
- Red indicators mean action needed
- Yellow indicators mean paused (review reason)
- Green means healthy

### 6. Optimize for Cost

If using paid LLM APIs:
- Enable prompt caching (see [Token Optimization Guide](../../TOKEN_OPTIMIZATION_GUIDE.md))
- Use Haiku for simple tasks
- Configure batch processing for insights
- Limit integration check frequency if needed

---

## Advanced Configuration

### Custom Scheduler Intervals

Modify check frequency for each integration:

**Location:** `~/.wovly-assistant/users/{username}/tasks/scheduled/`

**Example** (insights.json):
```json
{
  "id": "insights-check",
  "schedule": {
    "type": "interval",
    "intervalMinutes": 30
  },
  "integrations": {
    "gmail": true,
    "slack": true,
    "custom-brightwheel": true
  }
}
```

Change `intervalMinutes` to 15, 30, 60, or custom value.

### Selective Integration Filtering

Enable integration but exclude certain channels/folders:

**Slack** (settings.json):
```json
{
  "slack": {
    "excludeChannels": ["#random", "#bots", "#notifications"],
    "includeOnlyDMs": false,
    "muteThreads": true
  }
}
```

**Gmail** (settings.json):
```json
{
  "gmail": {
    "excludeLabels": ["Promotions", "Social", "Forums"],
    "includeOnlyPrimary": true
  }
}
```

### Custom Website Advanced Options

**Retry logic:**
```json
{
  "errorHandling": {
    "maxRetries": 3,
    "retryDelayMs": 5000,
    "pauseAfterFailures": 3,
    "notifyOnError": true
  }
}
```

**Session management:**
```json
{
  "sessionManagement": {
    "saveSession": true,
    "sessionTimeoutMs": 3600000,
    "revalidateOnError": true
  }
}
```

---

## Integration Roadmap

### Coming Soon
- **Zoom** - Meeting transcription and summaries
- **Microsoft Teams** - Enterprise communication
- **Linear** - Issue tracking
- **Figma** - Design collaboration
- **Intercom** - Customer support

### Requested Features
Vote on [GitHub Discussions](https://github.com/wovly/wovly/discussions):
- Zapier integration
- IFTTT hooks
- Custom API endpoints
- Webhook receivers

---

## Related Documentation

- [Insights](./INSIGHTS.md) - How integrations power insights
- [Tasks](./TASKS.md) - Automate integration workflows
- [Interfaces](./INTERFACES.md) - Access integrations remotely
- [Security](../reference/security.mdx) - Data protection details

## Support

For integration issues:
- [GitHub Issues](https://github.com/wovly/wovly/issues)
- [Troubleshooting Guide](../reference/troubleshooting.mdx)
- [FAQ](../reference/faq.mdx)
