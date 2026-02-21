# Quick Start: Custom Web Integration System

## Overview

The custom web integration system allows you to scrape messages from websites that don't have APIs (like Brightwheel, tax portals, school systems, etc.) and query them through the AI assistant.

## Current Status

✅ **Backend Complete**: Storage, tools, and insights integration are fully implemented and tested
⚠️ **UI Pending**: Currently requires manual configuration (UI coming soon)

## Manual Setup (Until UI is Built)

### Step 1: Create Site Configuration

Create a configuration file for your site:

**Location**: `~/.wovly-assistant/users/{username}/web-integrations/sites/brightwheel.json`

**Example Configuration**:
```json
{
  "id": "brightwheel",
  "name": "Brightwheel Daycare",
  "url": "https://schools.mybrightwheel.com/sign-in",
  "enabled": true,
  "credentialDomain": "mybrightwheel.com",
  "siteType": "daycare",
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
  },
  "messageFormat": {
    "platform": "custom-brightwheel",
    "subject": "Brightwheel"
  },
  "sessionManagement": {
    "saveSession": true,
    "sessionTimeout": 3600000
  },
  "credentials": {
    "username": "your-email@example.com",
    "password": "your-password"
  },
  "status": {
    "lastError": null,
    "consecutiveFailures": 0,
    "paused": false
  }
}
```

### Step 2: Add to Main Config

Update the main config file to include your site:

**Location**: `~/.wovly-assistant/users/{username}/web-integrations/config.json`

**Example**:
```json
{
  "version": "1.0.0",
  "sites": [
    {
      "id": "brightwheel",
      "name": "Brightwheel Daycare",
      "enabled": true
    }
  ],
  "lastUpdated": "2026-02-17T00:00:00.000Z"
}
```

### Step 3: Create Directory Structure

```bash
mkdir -p ~/.wovly-assistant/users/jeff/web-integrations/sites
mkdir -p ~/.wovly-assistant/users/jeff/web-integrations/sessions
mkdir -p ~/.wovly-assistant/users/jeff/web-integrations/messages/raw
mkdir -p ~/.wovly-assistant/users/jeff/web-integrations/messages/analyzed
```

### Step 4: Trigger Insights Collection

The scraper runs automatically as part of the hourly insights collection. To test immediately:

```javascript
// In the app, trigger insights collection manually
// Or wait for the next hourly check
```

## Using the AI Assistant

Once messages are scraped and stored, you can query them using the AI assistant:

### Example Queries

**Search for specific content**:
```
"Search my daycare messages for field trip"
"Find messages about school closures"
"What did Brightwheel say about the holiday schedule?"
```

**Get recent updates**:
```
"What's new from Brightwheel today?"
"Show me recent messages from the daycare"
"Any new messages from my custom websites?"
```

**Check specific dates**:
```
"What did the school say last Monday?"
"Show me all daycare messages from February 15th"
"Get messages from last week"
```

**List configured sites**:
```
"What custom websites do I have configured?"
"Show me the status of my web integrations"
```

## How to Find CSS Selectors

### Method 1: Browser DevTools
1. Open the website in Chrome/Firefox
2. Right-click the element you want → "Inspect"
3. In DevTools, right-click the highlighted HTML → Copy → Copy selector
4. Paste into your config

### Method 2: Use the Console
1. Open the website
2. Press F12 to open DevTools
3. Go to Console tab
4. Test your selector:
   ```javascript
   document.querySelector('input[name="email"]')
   ```
5. If it highlights the right element, use that selector

### Common Patterns
- **Email field**: `input[name='email']`, `input[type='email']`, `#email`
- **Password field**: `input[name='password']`, `input[type='password']`, `#password`
- **Submit button**: `button[type='submit']`, `button.login`, `input[type='submit']`
- **Messages container**: `.messages`, `#messages`, `div[role='main']`

## Troubleshooting

### Scraper Not Running
- Check that `enabled: true` in both site config and main config
- Check that credentials are correct
- Look for errors in the app console

### Messages Not Appearing
- Verify selectors are correct (use browser console)
- Check that messages container selector matches the actual page
- Look at `status.lastError` in site config for error details

### Login Failing
- Verify username/password selectors are correct
- Check that `successIndicator` appears after login
- Some sites may have CAPTCHA (not currently supported)

### Auto-Paused Integration
- Integration auto-pauses after 3 consecutive failures
- Check `status.paused` in site config
- Fix the issue, then set `status.paused: false` and `status.consecutiveFailures: 0`

## Viewing Stored Messages

### Raw JSON
```bash
cat ~/.wovly-assistant/users/jeff/web-integrations/messages/raw/brightwheel/2026-02-17.json
```

### Analyzed Markdown
```bash
cat ~/.wovly-assistant/users/jeff/web-integrations/messages/analyzed/2026-02-17.md
```

### List All Sites
```bash
ls ~/.wovly-assistant/users/jeff/web-integrations/sites/
```

## Configuration Tips

### Navigation Sequences
For sites where messages aren't on the main page, add navigation steps:

```json
"navigation": [
  {
    "step": 1,
    "action": "click",
    "selector": "a.messages-link",
    "waitFor": "div.messages-page",
    "description": "Click Messages tab",
    "delay": 2000
  },
  {
    "step": 2,
    "action": "click",
    "selector": "button.inbox",
    "waitFor": "div.message-list",
    "description": "Open Inbox"
  }
]
```

### Session Timeout
Adjust based on how long the site keeps you logged in:
- `3600000` = 1 hour
- `86400000` = 24 hours

### Message Parsing
The scraper uses AI to extract messages from the container. Just ensure:
- `container` selector points to the messages area
- The area contains visible text with sender/content/timestamp

## Advanced: LLM-Powered Parsing

The scraper uses Claude Haiku to parse messages from the HTML text, so you don't need precise selectors for each field. You only need:

1. **Container selector** - Points to the div/section containing all messages
2. **Login selectors** - Username, password, submit button
3. **Success indicator** - Element that appears after login

The LLM handles the rest - extracting sender, content, and timestamps from the text.

## Next Steps

### When UI is Built
You'll be able to:
- ✅ Add sites through a visual wizard
- ✅ Test selectors with click-to-select tool
- ✅ View/edit/delete integrations
- ✅ See scraping status and errors
- ✅ Test configurations before saving

### Current Workaround
Until then, use the manual configuration above. It works perfectly, just requires some technical knowledge.

## Example Sites

### Brightwheel (Daycare)
```json
{
  "id": "brightwheel",
  "name": "Brightwheel",
  "url": "https://schools.mybrightwheel.com/sign-in",
  "selectors": {
    "login": {
      "usernameField": "input[name='email']",
      "passwordField": "input[name='password']",
      "submitButton": "button[type='submit']",
      "successIndicator": "div[class*='dashboard']"
    },
    "messages": {
      "container": "div[class*='messages']"
    }
  }
}
```

### Generic School Portal
```json
{
  "id": "school-portal",
  "name": "School Portal",
  "url": "https://school.example.com/login",
  "selectors": {
    "login": {
      "usernameField": "#username",
      "passwordField": "#password",
      "submitButton": "button.login-btn",
      "successIndicator": ".home-page"
    },
    "navigation": [
      {
        "step": 1,
        "action": "click",
        "selector": "a[href='/messages']",
        "description": "Go to Messages"
      }
    ],
    "messages": {
      "container": "#message-list"
    }
  }
}
```

## Support

For issues or questions:
1. Check the logs in the app console
2. Verify selectors in browser DevTools
3. Check `~/.wovly-assistant/users/{username}/web-integrations/` for config files
4. Look at error messages in site status

## Conclusion

The backend is fully functional and tested. Manual configuration works perfectly. UI components will make this much easier in the future, but you can start using it now with manual setup.

Happy scraping! 🚀
