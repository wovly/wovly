# Wovly

**Your Autonomous Personal AI Communication Assistant**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS-blue)](https://github.com/wovly/wovly)
[![Beta](https://img.shields.io/badge/Status-Beta-orange)](https://github.com/wovly/wovly/issues)
[![Electron](https://img.shields.io/badge/Electron-Latest-47848F)](https://www.electronjs.org/)
[![Documentation](https://img.shields.io/badge/Docs-wovly.mintlify.app-blue.svg)](https://wovly.mintlify.app/)

A privacy-first desktop AI communication assistant that manages your contacts, follow ups, chat analysis, and remembers context across Email, Slack, iMessage, WhatsApp, Telegram, and more.

> **🚧 Beta Notice:** Wovly is currently in beta. We appreciate your feedback! Please [report bugs and request features](https://github.com/wovly/wovly/issues) on GitHub.
>
> **Platform Support:** Currently macOS only. Windows and Linux support coming soon.

<p align="center">
  <img src="assets/screenshot.png" alt="Wovly Screenshot" width="900">
</p>

---

## Features

### 💬 Multi-Platform Communication and Research
- **Unified Inbox** – Manage Email, Slack, iMessage, WhatsApp, Telegram, and Discord from one interface
- **Voice Mimic** – Learns your communication style per contact and platform
- **Cross-Platform Coordination** – "Text my wife, then Slack my boss" in a single command
- **Conversation Research** - "Extract any issues from the Sales slack channel and email the summary to the CEO"

### 🤖 Autonomous Customizable Task Execution
- **Natural Language Tasks** – Describe your task and goals in the chat "monitor my email and schedule any appointment requests that come in"
- **Persistent Follow-ups** – Monitors for replies and follows up intelligently in your voice
- **Scheduling** – Automatically schedule meetings on your calendar or others (e.g. Calendly)

### 🧠 Intelligent Memory System
- **Long-term Memory** – Remembers facts, relationships, and preferences across conversations
- **Daily Logs** – Automatic conversation summarization and context retention
- **Personal Profile** – Remembers who you are and your core facts, like spouse, family, job, location, allergies, hobbies, airline seat preference

### 🤖 Customizable Skills
- **Teach Once, Automate Forever** – Define standard operating procedures once, and Wovly follows them consistently: "When a customer reports a bug, always log it in Jira and notify the eng team on Slack"
- **Personal Playbooks** – Create reusable workflows tailored to your role: "Weekly status report: summarize my sent emails, check Asana tasks, draft update to manager"
- **Constraint-Aware Execution** – Set guardrails for sensitive actions: "Never auto-send messages to executives without approval"

### 📱 Remote Interfaces
- **Talk to Wovly from Anywhere** – Chat with Wovly via WhatsApp or Telegram when you're away from your computer
- **Full Capability Access** – Run tasks, check emails, send messages, and get updates from your phone
- **Real-time Notifications** – Receive task alerts and important updates wherever you are

### 🌐 Browser Automation
- **Web Research** – Navigate websites, extract data, fill forms
- **Credential Management** – Securely stored login credentials for automated authentication
- **Anti-Detection** – Built-in measures to reduce bot detection

### 🔒 Privacy-First Architecture
- **Local Storage** – App data (profiles, tasks, skills, credentials) stored on your machine
- **LLM API Calls** – Chat conversations are sent to your chosen LLM provider via API
- **No Wovly Servers** – Direct API calls to providers, nothing passes through us
- **Multi-User Support** – Per-user data isolation for shared computers
- **Encrypted Credentials** – OS-level encryption via Keychain/DPAPI/libsecret

---

## Integrations

| Integration | Capabilities |
|-------------|-------------|
| **Google Workspace** | Gmail read/write, Calendar management, event creation |
| **Slack** | Send messages, read channels, search DMs, user lookup |
| **iMessage** | Send/read texts, contact resolution (macOS only) |
| **WhatsApp** | Two-way messaging, remote control interface |
| **Telegram** | Bot interface, remote commands, notifications |
| **Discord** | Server messaging, channel management |
| **Asana** | Task management, project tracking |
| **Notion** | Page access, database queries |
| **GitHub** | Repository access, issue tracking |
| **Reddit** | Browse posts, read comments |
| **Spotify** | Playback control, music search |
| **Browser Automation** | Web navigation, form filling, data extraction |

---

## LLM Providers

Choose your preferred AI model:

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Sonnet 4, Claude Haiku, Claude Opus |
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-4o Mini |
| **Google** | Gemini 1.5 Pro, Gemini 1.5 Flash |

---

## Use Cases

### Scheduling & Coordination
```
"Schedule a meeting with John next week"
→ Emails John, negotiates times, checks your calendar, creates the event

"Text my wife to coordinate kid pickup today"
→ Converses to align schedules and confirms the plan

"Chris sent me a calendar link in Slack. Find a time and book it"
→ Opens the link, cross-references your calendar, completes booking
```

### Communication & Research
```
"Based on the PRD and recent Slack messages, write an update to the sales team"
→ Synthesizes context and drafts a personalized message

"Email the top 3 candidates and ask about availability"
→ Sends personalized outreach and tracks responses

"Scan the sales channel conversations over the past 30 days and provide insights on how I can help"
→ Process all the of the chat and historical context to generate actional insights
```

### Web Automation
```
"Go to LinkedIn and get the profile summary of [person]"
→ Navigates and extracts the information

"Check flight prices from Boston to Miami on Google Flights"
→ Browses the site and reports options

"Fill out the contact form on [website] with my information"
→ Navigates, fills fields, and submits
```

### Monitoring & Alerts
```
"Monitor the weather and alert me if it's going to rain"
→ Checks periodically and notifies before rain

"Watch my inbox for emails from [client] and summarize immediately"
→ Monitors and alerts in real-time
```

### Remote Access (via WhatsApp/Telegram)
```
[WhatsApp] "Any important emails today?"
→ Get summaries and updates on your phone from anywhere

[Telegram] "Create a task to remind me to call mom at 5pm"
→ Create and manage tasks remotely

[WhatsApp] "Text my wife I'm running 10 min late"
→ Send messages across platforms from your phone
```

---

## Installation

### Prerequisites

- **macOS** 10.15 (Catalina) or later
- **Node.js** 18+
- API key for at least one LLM provider

### Quick Start

```bash
# Clone the repository
git clone https://github.com/wovly/wovly.git
cd wovly

# Install dependencies
npm install

# Start the application (from root directory!)
npm run dev
```

> **Note:** `npm run dev` must be run from the **root** `wovly/` directory, not from a subdirectory. This command starts both the UI dev server (Vite on port 5173) and the Electron app simultaneously.

### Configuration

#### 1. LLM API Keys

Go to **Settings** → **AI Providers** and add your API keys:

| Provider | Get API Key |
|----------|-------------|
| Anthropic | https://console.anthropic.com/ |
| OpenAI | https://platform.openai.com/api-keys |
| Google | https://aistudio.google.com/app/apikey |

#### 2. Google Workspace

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** and **Google Calendar API**
4. Create OAuth 2.0 credentials (Desktop app)
5. In Wovly: **Integrations** → **Google Workspace** → Enter Client ID & Secret

#### 3. Slack

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app "From scratch"
3. Add **User Token Scopes**:
   - `channels:history`, `channels:read`, `chat:write`
   - `groups:history`, `groups:read`, `im:history`, `im:read`, `im:write`
   - `users:read`
4. In Wovly: **Integrations** → **Slack** → Follow setup wizard

#### 4. iMessage (macOS only)

- Works automatically on macOS
- Grant Contacts access when prompted
- Full Disk Access may be required for message history

#### 5. Other Integrations

Configure WhatsApp, Telegram, Discord, and other integrations from the **Integrations** page in the app.

---

## Architecture

```
wovly/
├── apps/
│   ├── desktop/              # Electron main process
│   │   ├── main.js           # Core logic, IPC handlers, integrations
│   │   └── preload.js        # IPC bridge to renderer
│   └── ui/                   # React frontend
│       └── src/
│           ├── App.tsx       # Main UI components
│           └── styles.css
├── packages/                 # Shared modules
│   ├── agent-core/
│   ├── memory/
│   ├── integrations/
│   ├── llm/
│   ├── scheduler/
│   └── tools/
├── docs/                     # Documentation (Mintlify)
└── ~/.wovly-assistant/       # User data (outside repo)
    ├── users.json            # User registry
    └── users/
        └── {username}/       # Per-user isolated data
            ├── settings.json # API keys, tokens
            ├── credentials.enc # Encrypted credentials
            ├── memory/       # Daily logs, long-term memory
            ├── tasks/        # Active and completed tasks
            ├── skills/       # Custom skill definitions
            ├── profiles/     # User profile data
            └── browser-data/ # Per-user browser sessions
```

---

## Privacy & Security

- **App data stored locally** – Profiles, tasks, skills, and credentials stay on your device
- **Chat prompts sent to LLMs** – Your conversations are sent to your chosen provider (Anthropic, OpenAI, or Google) via their APIs
- **No Wovly servers** – Direct API calls to providers, nothing passes through us
- **Per-user isolation** – Each user's data is completely separated
- **Encrypted credentials** – OS-level encryption (Keychain/DPAPI/libsecret)
- **Local browser automation** – Chromium runs on your machine

---

## Documentation

Full documentation available at: **[docs.wovly.dev](https://wovly.mintlify.app/)** 

Or browse the `/docs` directory for:
- [Installation Guide](docs/installation.mdx)
- [Features](docs/features/)
- [Integrations](docs/integrations/)
- [Architecture Reference](docs/reference/architecture.mdx)
- [Security](docs/reference/security.mdx)
- [Troubleshooting](docs/reference/troubleshooting.mdx)

---

## Development

**Important:** All commands should be run from the **root** `wovly/` directory.

```bash
# Development mode (runs UI + Electron together)
npm run dev

# Build for production
npm run build

# Run linter
npm run lint
```

### Troubleshooting Development

If `npm run dev` fails or the app window doesn't open:

```bash
# 1. Make sure you're in the root directory
pwd  # Should show /path/to/wovly

# 2. Kill any lingering processes from previous runs
pkill -f "vite" ; pkill -f "electron"

# 3. If port 5173 is in use, kill that process
lsof -ti:5173 | xargs kill -9

# 4. Try again
npm run dev
```

### Running Components Separately

If needed, you can run the UI and Electron separately in two terminals:

```bash
# Terminal 1: Start UI dev server
cd apps/ui && npm run dev

# Terminal 2: Start Electron (after UI is running)
cd apps/desktop && npm run dev
```

---

## Feedback & Bug Reports

Wovly is in **beta** and we'd love your feedback! Help us improve by reporting issues on GitHub.

### Filing an Issue

1. Go to [GitHub Issues](https://github.com/wovly/wovly/issues)
2. Click **New Issue**
3. Choose a template:
   - **Bug Report** – Something isn't working
   - **Feature Request** – Suggest an improvement
4. Provide as much detail as possible

### What to Include

For bug reports:
- Steps to reproduce the issue
- Expected vs actual behavior
- macOS version and Wovly version
- Console logs (Cmd + Option + I → Console tab)

For feature requests:
- Clear description of the desired functionality
- Use case explaining why it would be helpful

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with:
- [Electron](https://www.electronjs.org/) – Desktop framework
- [React](https://reactjs.org/) – UI library
- [TypeScript](https://www.typescriptlang.org/) – Type safety
- [Puppeteer](https://pptr.dev/) – Browser automation
- [Mintlify](https://mintlify.com/) – Documentation

---

**Questions?** Open an issue or check the [FAQ](docs/reference/faq.mdx).
