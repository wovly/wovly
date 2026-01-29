# Wovly AI Assistant

A powerful, privacy-focused personal AI assistant that runs locally on your desktop. Wovly combines multiple LLM providers with deep integrations into your daily tools, enabling autonomous task execution, context-rich advice, and intelligent scheduling.

## Why Wovly?

- **100% UI-Driven** - No coding, no configuration files, no terminal commands. Everything is managed through a clean, intuitive interface. Connect integrations with a few clicks, manage tasks visually, and chat naturally.
- **Privacy-First** - All data stays on your machine. No cloud sync, no telemetry.
- **Truly Autonomous** - Tasks run in the background, monitor for events, and complete multi-step workflows without constant oversight.
- **Works With Your Tools** - Deep integrations with Google Workspace, Slack, iMessage, web browsers, and more.

## Features

### Example Use Cases

**Scheduling & Coordination**
- "Schedule a meeting with John next week" → Wovly emails John, negotiates times, checks your calendar, and creates the event automatically
- "Text my wife to coordinate who is doing kid pickup today" → Wovly converses with your wife to align schedules and confirms the plan
- "Chris sent me a calendar link in Slack. Find a time that works and book it" → Wovly retrieves the link, opens the booking page, cross-references your calendar, and completes the booking

**Communication & Research**
- "Based on the PRD docs and recent Slack messages, write an encouraging update to the sales team" → Wovly synthesizes context and drafts a personalized message
- "Email the top 3 candidates from the job posting and ask about their availability" → Wovly sends personalized outreach and tracks responses
- "Find Jeff's favorite Marvel movie - email him and follow up until you get a specific answer" → Wovly persists through vague responses until getting a definitive answer

**Web Automation & Data Gathering**
- "Go to LinkedIn and get me the profile summary of [person]" → Wovly navigates to the page and extracts the relevant information
- "Check the flight prices from Boston to Miami for next month on Google Flights" → Wovly browses the site and reports back with options
- "Fill out the contact form on [website] with my information" → Wovly navigates, fills fields, and submits
- "Take a screenshot of the homepage of [competitor's website]" → Wovly captures visual snapshots for reference

**Monitoring & Alerts**
- "Monitor the weather and alert me if it's going to rain today" → Wovly checks periodically and notifies you before rain
- "Watch my inbox for emails from [important client] and summarize them immediately" → Wovly monitors and alerts in real-time
- "Check [website] every hour and tell me if the price drops below $500" → Wovly monitors and alerts on price changes

**Multi-Step Workflows**
- "Research [topic], compile findings into a summary, and email it to my team" → Wovly searches, synthesizes, and delivers
- "Get the agenda from tomorrow's meeting invite, prepare talking points, and Slack them to me before 9am" → Wovly pulls calendar context, drafts points, and schedules delivery

### Multi-LLM Support
- **Anthropic Claude** (Sonnet 4, Haiku, Opus)
- **OpenAI GPT** (GPT-4o, GPT-4 Turbo)
- **Google Gemini** (1.5 Pro, 1.5 Flash)

### Integrations
- **Google Workspace** - Gmail, Calendar, Drive (read, write, send emails, create events with attendees)
- **Slack** - Send messages as yourself (user OAuth), read channels, search DMs
- **iMessage** - Send texts, read conversations (macOS only)
- **Playwright Browser Automation** - Full browser control: navigate websites, click, type, fill forms, take screenshots, extract data
- **Weather** - Current conditions and forecasts via Open-Meteo
- **WhatsApp** - Chat with Wovly from anywhere via WhatsApp

### Intelligent Query Decomposition
- Complex requests are automatically broken down into executable steps
- Choose to run as a background task or execute inline immediately
- Each step is validated before progressing to ensure conditions are met
- Context from previous steps flows automatically to subsequent actions

### Autonomous Task System
- Create background tasks that execute multi-step workflows independently
- Tasks monitor for replies and external events with lightweight polling
- Conditional step logic: tasks stay on steps until success criteria are met
- Supports both discrete tasks (clear end goal) and continuous monitoring tasks
- Real-time notifications in chat as tasks progress

### Customizable Skills
- Skills are markdown files that define reusable procedures
- Built-in skills for scheduling, email drafting, research, and more
- Create custom skills for your specific workflows
- Skills provide constraints and best practices for the AI to follow

### Memory System
- Daily conversation logs stored as markdown
- Automatic summarization of older conversations
- Long-term memory for context retention across sessions

## Getting Started

### Prerequisites

- **Node.js** 18+ 
- **macOS** (for iMessage integration) or Windows/Linux (without iMessage)
- API keys for at least one LLM provider

### Installation

```bash
# Clone the repository
git clone https://github.com/bluerune234/wovly.git
cd wovly

# Install dependencies
npm install

# Start the application
npm run dev
```

### Configuration

#### 1. LLM API Keys

Go to **Settings** in the app and add your API keys:

| Provider | Get API Key |
|----------|-------------|
| Anthropic | https://console.anthropic.com/ |
| OpenAI | https://platform.openai.com/api-keys |
| Google | https://makersuite.google.com/app/apikey |

#### 2. Google Workspace Integration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** and **Google Calendar API**
4. Create OAuth 2.0 credentials (Desktop app)
5. In Wovly, go to **Integrations** → **Google Workspace** → Enter Client ID & Secret

#### 3. Slack Integration

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app "From scratch"
3. Add **User Token Scopes** (not Bot):
   - `channels:history`, `channels:read`, `channels:write`
   - `chat:write`, `groups:history`, `groups:read`, `groups:write`
   - `im:history`, `im:read`, `im:write`, `users:read`
4. In Wovly, go to **Integrations** → **Slack** → Follow setup wizard

#### 4. iMessage (macOS only)

- Works automatically on macOS
- Grant Wovly access to Contacts when prompted
- Full Disk Access may be required for reading message history

#### 5. Playwright Browser Automation

1. Go to **Integrations** → **Playwright - Browser Automation**
2. Click **Enable** to start the browser automation service
3. Select your preferred browser:
   - **Chrome** (recommended) - Uses your existing Chrome with saved logins
   - **Chromium** - Isolated browser for sandboxed automation
   - **Firefox** / **Edge** / **WebKit** - Alternative browser engines

Playwright allows Wovly to:
- Navigate to any website and extract information
- Fill out forms and submit data
- Click buttons and interact with web pages
- Take screenshots for visual reference
- Automate multi-step web workflows

## Usage

### Chat
Ask questions, get help with tasks, or request information from your integrations:
- "What's on my calendar today?"
- "Check the weather in Boston"
- "Send an email to john@example.com about the project update"
- "Go to [website] and find the pricing information"
- "Send a Slack DM to Chris asking about the project status"

### Tasks
Create autonomous tasks for multi-step workflows:
- "Email jeff@example.com to schedule a meeting next week"
- "Text Sarah to coordinate dinner plans and follow up until we agree on a restaurant"
- "Monitor [website] and alert me when tickets go on sale"

Tasks will:
1. Break down complex requests into steps automatically
2. Execute actions using the appropriate tools (email, browser, Slack, etc.)
3. Monitor for replies and external events (lightweight polling)
4. Evaluate responses and determine if step conditions are met
5. Continue the conversation or workflow until the goal is achieved
6. Notify you of progress and completion in chat

### Web Automation
With Playwright enabled, Wovly can interact with any website:
- Navigate and browse pages
- Extract text, links, and structured data
- Fill out forms and submit information
- Click buttons and interact with UI elements
- Handle multi-page workflows (login, search, checkout)
- Take screenshots for documentation

### Skills
View and edit skills in the **Skills** page. Skills define procedures for:
- Scheduling meetings
- Email drafting
- Research tasks
- Web data extraction
- And more...

## Architecture

```
wovly/
├── apps/
│   ├── desktop/          # Electron main process
│   │   ├── main.js       # Core logic, IPC handlers, integrations
│   │   └── preload.js    # IPC bridge to renderer
│   └── ui/               # React frontend
│       └── src/
│           ├── App.tsx   # Main UI components
│           └── styles.css
├── packages/             # Shared modules (future use)
│   ├── memory/
│   ├── integrations/
│   └── ...
└── ~/.wovly-assistant/   # User data (outside repo)
    ├── settings.json     # API keys, tokens (local only)
    ├── memory/           # Conversation logs
    ├── tasks/            # Task state files
    └── skills/           # Skill markdown files
```

## Privacy & Security

- **All data stays local** - No cloud sync, no telemetry
- **Credentials stored locally** in `~/.wovly-assistant/settings.json`
- **API calls go directly** to providers (Anthropic, OpenAI, Google, Slack)
- **Browser automation runs locally** - Playwright controls a browser on your machine
- **No data leaves your machine** except for API requests and websites you navigate to

## Development

```bash
# Run in development mode (hot reload)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

## License

MIT

---

Built with Electron, React, and TypeScript.
