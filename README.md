# Wovly AI Assistant

A powerful, privacy-focused personal AI assistant that runs locally on your desktop. Wovly combines multiple LLM providers with deep integrations into your daily tools, enabling autonomous task execution, context rich advisor, and intelligent scheduling.

### Features

### Example use cases
- Say "Schedule a meeting with John", and Wovly will automatically email back and forth with John, sync with your calendar, find the right time, and create the calendar event.
- Say "Text my wife to coordinate who is doing kid pickup today" and Wovly will converse with your wife to align your schedules
- Say "Based on the PRD docs and recent slack messages, write a Slack message to the sales team" and Wovly will summarize and send an encouraging message to the team

### Multi-LLM Support
- **Anthropic Claude** (Sonnet 4, 3.5 Sonnet, Opus)
- **OpenAI GPT** (GPT-4o, GPT-4 Turbo)
- **Google Gemini** (1.5 Pro, 1.5 Flash)

### Integrations
- **Google Workspace** - Gmail, Calendar, Docs (read, write, send emails, create events with attendees)
- **Slack** - Send messages as yourself (user OAuth), read channels, DMs
- **iMessage** - Send texts, read conversations (macOS only)
- **Weather** - Current conditions and forecasts via Open-Meteo
- **Whatsapp** - Talk to Wovly anywhere via Whatsapp!

### Customizable Skill-Based Task System
- Create autonomous background tasks that execute multi-step workflows
- Skills are markdown files that define procedures (e.g., scheduling, email drafting)
- Tasks automatically detect replies and progress through steps
- Real-time notifications in chat as tasks progress

### Memory System for efficient context
- Daily conversation logs stored as markdown
- Automatic summarization of older conversations
- Long-term memory for context retention

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

## Usage

### Chat
Ask questions, get help with tasks, or request information from your integrations:
- "What's on my calendar today?"
- "Check the weather in Boston"
- "Send an email to john@example.com about the project update"

### Tasks
Create autonomous tasks for multi-step workflows:
- "Email jeff@example.com to schedule a meeting next week"
- "Text Sarah to coordinate dinner plans and follow up until we agree on a restaurant"

Tasks will:
1. Check your calendar for availability
2. Send the initial message
3. Monitor for replies (lightweight polling)
4. Process responses and continue the conversation
5. Create calendar invites when confirmed

### Skills
View and edit skills in the **Skills** page. Skills define procedures for:
- Scheduling meetings
- Email drafting
- Research tasks
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
- **No data leaves your machine** except for API requests you initiate

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
