# Custom Web Integration System

A robust web scraper system for extracting messages from websites without APIs (daycare portals, school systems, tax accountant sites, etc.).

## Features

- **AI-Powered Selector Generation**: Uses LLM with vision to analyze pages and suggest selectors
- **Visual Selector Tool**: Interactive browser overlay for click-to-select element refinement
- **Navigation Recording**: Record multi-step navigation sequences visually
- **Session Management**: Saves cookies to avoid re-login on every check
- **Error Detection**: Automatically detects page changes and pauses integrations
- **Message Pipeline Integration**: Feeds into existing insights/message consolidation system

## Architecture

```
webscraper/
├── index.js                  # Module exports
├── scraper.js                # Main WebScraper class
├── element-detector.js       # DOM element extraction (replaces accessibility tree)
├── ai-selector-generator.js  # LLM-powered selector generation
├── visual-selector.js        # Interactive visual selector tool
├── config-manager.js         # Configuration CRUD operations
├── session-manager.js        # Cookie persistence
├── error-detector.js         # Error classification and recovery
└── __tests__/                # Test files
```

## Usage

### 1. Add a New Web Integration

```javascript
const { config } = require('./src/webscraper');

const siteConfig = {
  name: 'Brightwheel Daycare',
  url: 'https://schools.mybrightwheel.com/sign-in',
  credentialDomain: 'mybrightwheel.com',
  credentials: {
    username: 'user@example.com',
    password: 'password123'
  },
  selectors: {
    login: {
      usernameField: 'input[name="email"]',
      passwordField: 'input[type="password"]',
      submitButton: 'button[type="submit"]',
      successIndicator: '.dashboard'
    },
    navigation: [
      {
        step: 1,
        action: 'click',
        selector: 'a[href*="/messages"]',
        waitFor: '.messages-container',
        description: 'Click Messages tab'
      }
    ],
    messages: {
      container: '.messages-list',
      messageItem: '.message-card',
      sender: '.message-author',
      content: '.message-body',
      timestamp: '.message-date'
    }
  }
};

await config.createIntegration('username', siteConfig);
```

### 2. Scrape Messages

```javascript
const { WebScraper } = require('./src/webscraper');
const browserController = require('./src/browser/controller');

const scraper = new WebScraper(browserController, 'username');
const result = await scraper.scrapeMessages(siteConfig);

if (result.success) {
  console.log(`Found ${result.messages.length} messages`);
  result.messages.forEach(msg => {
    console.log(`From: ${msg.from}, Content: ${msg.body}`);
  });
} else {
  console.error(`Error: ${result.error}`);
}
```

### 3. Use AI to Generate Selectors

```javascript
const { ai } = require('./src/webscraper');
const browserController = require('./src/browser/controller');

const page = await browserController.getPage('session-id');
await page.goto('https://example.com');

const selectors = await ai.generateSelectorsWithAI(page, 'daycare', apiKeys);
console.log(`AI Confidence: ${selectors.confidence}`);
console.log(`Login selectors:`, selectors.login);
console.log(`Message selectors:`, selectors.messages);
```

### 4. Visual Selector Tool

```javascript
const { VisualSelectorTool } = require('./src/webscraper');
const browserController = require('./src/browser/controller');

const visualTool = new VisualSelectorTool(browserController);

// Select a single element
const selector = await visualTool.selectElement(
  'https://example.com',
  'username field',
  'input[name="email"]' // suggested selector
);

// Record navigation sequence
const steps = await visualTool.recordNavigationSequence('https://example.com');
console.log(`Recorded ${steps.length} navigation steps`);
```

## Configuration Format

### Site Configuration

```json
{
  "id": "brightwheel",
  "name": "Brightwheel Daycare",
  "url": "https://schools.mybrightwheel.com/sign-in",
  "enabled": true,
  "credentialDomain": "mybrightwheel.com",
  "selectors": {
    "login": {
      "usernameField": "input[name='email']",
      "passwordField": "input[type='password']",
      "submitButton": "button[type='submit']",
      "successIndicator": ".dashboard"
    },
    "navigation": [
      {
        "step": 1,
        "action": "click",
        "selector": "a[href*='/messages']",
        "waitFor": ".messages-container",
        "description": "Click Messages tab"
      }
    ],
    "messages": {
      "container": ".messages-list",
      "messageItem": ".message-card",
      "sender": ".message-author",
      "content": ".message-body",
      "timestamp": ".message-date"
    }
  },
  "sessionManagement": {
    "saveSession": true,
    "sessionTimeout": 3600000
  },
  "messageFormat": {
    "platform": "custom-brightwheel",
    "subject": "Brightwheel Messages"
  },
  "status": {
    "lastCheck": "2024-01-15T10:30:00Z",
    "lastSuccess": "2024-01-15T10:30:00Z",
    "lastError": null,
    "consecutiveFailures": 0,
    "paused": false
  }
}
```

### Navigation Step Actions

- `click`: Click an element
- `type`: Type text into an input field
- `select`: Select an option from a dropdown

Each step includes:
- `selector`: CSS selector for the element
- `waitFor`: Optional selector to wait for after action
- `delay`: Optional delay in ms before next step
- `description`: Human-readable description

## Error Handling

The system automatically handles various error scenarios:

### Error Types

1. **AUTH_FAILURE**: Invalid credentials → Notify user immediately
2. **SESSION_EXPIRED**: Session cookies expired → Auto re-login
3. **TIMEOUT**: Network/page timeout → Retry with backoff
4. **PAGE_STRUCTURE_CHANGED**: Selectors no longer work → Pause integration, notify user
5. **NETWORK_ERROR**: Connection issues → Retry
6. **SELECTOR_NOT_FOUND**: Element not found → Check for page changes
7. **NAVIGATION_FAILED**: Failed to navigate → Check URL and network

### Auto-Pause Behavior

Integrations are automatically paused when:
- Authentication fails
- Page structure has changed
- 3+ consecutive failures occur

Users must manually resume after addressing the issue.

## Storage

Configurations and sessions are stored in:
```
~/.wovly-assistant/users/{username}/web-integrations/
├── config.json           # List of configured sites
├── sites/
│   ├── brightwheel.json  # Individual site configs
│   └── mytax.json
└── sessions/
    └── brightwheel.session  # Saved cookies
```

## Integration with Message Pipeline

The webscraper automatically integrates with the insights processor:

```javascript
// In processor.js
const messages = await collectWebScraperMessages(username, sinceTimestamp, contactMappings);
```

Messages are:
1. Filtered by timestamp
2. Contact names resolved
3. Merged with Gmail, Slack, iMessage
4. Passed through LLM for fact extraction
5. Cross-checked with user profile
6. Consolidated into insights

## Best Practices

### Selector Robustness

1. **Prefer IDs**: Most stable, least likely to change
   ```css
   #username-input
   ```

2. **Use semantic classes**: Better than generic classes
   ```css
   .login-form input[name="email"]
   ```

3. **Avoid positional selectors**: Fragile, breaks easily
   ```css
   /* Bad */
   div > div > div:nth-child(3)

   /* Good */
   .message-list .message-item
   ```

### Navigation Sequences

- Keep sequences as short as possible
- Add `waitFor` selectors to ensure page loads
- Use delays sparingly (only when necessary)
- Test thoroughly before saving

### Session Management

- Sessions expire after 1 hour by default (configurable)
- System validates sessions before scraping
- Failed validation triggers automatic re-login

## Troubleshooting

### Integration keeps getting paused

- Check if the website has changed
- Verify selectors are still correct
- Use visual selector tool to update

### Login fails repeatedly

- Verify credentials are correct
- Check if site requires CAPTCHA
- Some sites may detect automation

### Messages not appearing

- Verify navigation sequence reaches message page
- Check message extraction selectors
- Ensure timestamp parsing is working

## Future Enhancements

- [ ] CAPTCHA handling support
- [ ] Multi-page navigation (pagination)
- [ ] Form filling beyond login
- [ ] JavaScript-heavy SPA support
- [ ] Webhook notifications on new messages
- [ ] Bulk re-configuration tool

## Testing

Run tests with:
```bash
npm test src/webscraper
```

## License

Part of Wovly Assistant - Internal use only
