# Wovly: Your Autonomous Communication Agent

**The privacy-focused AI assistant that manages your inbox, replies, and follow-ups across Email, Slack, and iMessage.**

Wovly is a local desktop application designed to solve communication fatigue. It doesn't just draft text; it understands your relationships, remembers context, and autonomously executes the tedious work of scheduling, negotiating, and chasing down replies so you can focus on deep work.

---

## Why Wovly?

Communication is more than just typing; it's remembering who people are, finding time on calendars, and persisting until you get an answer. Wovly automates the entire loop.

- **Unified Communication Logic** – Wovly sits across your Gmail, Slack, and iMessage. It doesn't matter where the message comes from; Wovly can read, understand, and reply using the correct channel.

- **Context-Aware Drafting** – Because Wovly has Long-Term Memory and Personal Profile awareness, you don't need to write long prompts. You can simply say "Reply to him effectively"—Wovly knows who "he" is, what you last spoke about, and your relationship dynamics (e.g., "Connie is my mother").

- **Autonomous Follow-Ups** – Stop keeping mental tabs on pending replies. Wovly can send an email and monitor for a response in the background. If they don't reply, Wovly can nudge them automatically or notify you to intervene.

- **Zero-Friction Context Gathering** – Need to look up a flight price or a LinkedIn profile before replying? Wovly's Browser Automation handles the research and weaves the data directly into your draft.

- **100% Privacy-First** – Your emails, DMs, and texts are the most sensitive data you own. Wovly runs locally on your machine. No cloud sync, no telemetry. Your communication history never leaves your control.

---

## Communication Superpowers

### 1. The "Fire and Forget" Workflow

Wovly changes how you delegate communication. Instead of micromanaging the draft, you delegate the outcome.

| Workflow | How It Works |
|----------|--------------|
| **Smart Scheduling:** "Schedule a meeting with John next week." | Wovly emails John, negotiates times based on your real calendar availability, and sends the invite only when a time is confirmed. |
| **Cross-Platform Coordination:** "Text my wife to coordinate pickup, then Slack my boss I'll be leaving early." | Wovly creates a multi-step workflow, executing actions across iMessage and Slack simultaneously. |
| **Persistent Outreach:** "Email the candidates and follow up until you get availability." | Wovly maintains a background process that tracks the thread state and continues the workflow over days if necessary. |

### 2. Deep Context Engine

Most AI assistants have amnesia. Wovly remembers, making your communication faster and more natural.

- **Relationship Awareness** – Wovly detects and saves facts like "Igor is my contractor" or "My wife's birthday is March 15th." When you ask to "Email Igor," it knows exactly which address to use and the context of your renovations.

- **Pronoun Resolution** – Wovly tracks the conversation thread. If you are looking at an email and say "Send a reply to him," Wovly resolves "him" to the sender of the email.

- **Intelligent Summarization** – Wovly reads your daily logs and condenses them, so it can recall details from a Slack conversation three weeks ago to inform an email draft today.

---

## Core Capabilities

Wovly enables this communication automation through a suite of deep integrations and tools:

### Integrations

| Integration | Description |
|-------------|-------------|
| **Google Workspace** | Full read/write access to Gmail and Calendar |
| **Slack** | Send messages as yourself (User OAuth), read channels, search DMs |
| **iMessage** | Native macOS integration to send texts and read threads |
| **WhatsApp** | Control Wovly remotely from your phone |
| **Web Automation (Playwright)** | Navigates websites to fill contact forms, scrape data for emails, or take screenshots |

### Multi-LLM Support

Choose the best brain for your emails:
- **Anthropic Claude** (Sonnet 4, Haiku, Opus)
- **OpenAI GPT** (GPT-4o, GPT-4 Turbo)
- **Google Gemini** (1.5 Pro, 1.5 Flash)

### Customizable Skills

Your communication style is unique. Wovly lets you create **custom skills**—opinionated workflows and communication patterns tailored to how *you* work. Define templates for follow-up sequences, set rules for how certain contacts should be handled, or create step-by-step playbooks for recurring scenarios like vendor negotiations or candidate outreach.

### External Control via WhatsApp

Your communication doesn't stop when you leave your desk. With WhatsApp integration, you can message Wovly from your phone and trigger the same powerful automations—check your calendar, send a Slack message, or kick off a follow-up sequence—all without opening your laptop.

### 100% UI-Driven

No terminal commands or config files. Connect your accounts and manage your communication workflows through a clean, visual interface.

---

## Example Use Cases

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

**Monitoring & Alerts**
- "Monitor the weather and alert me if it's going to rain today" → Wovly checks periodically and notifies you before rain
- "Watch my inbox for emails from [important client] and summarize them immediately" → Wovly monitors and alerts in real-time

**Local Services & Outreach**
- "I need a contractor to fix my sink - find the top 10 nearby plumbers and email them asking for a quote" → Wovly searches for local plumbers, gathers contact info, and sends personalized quote requests
- "Find 5 highly-rated electricians in my area and ask about availability next week" → Wovly researches, compiles options, and handles outreach

---

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
   - **Chromium** (recommended) - Reliable automation browser, auto-installs if needed
   - **Chrome** - Uses your existing Chrome (may have profile conflicts)
   - **Firefox** / **Edge** / **WebKit** - Alternative browser engines

Playwright allows Wovly to:
- Navigate to any website and extract information
- Fill out forms and submit data
- Click buttons and interact with web pages
- Take screenshots for visual reference
- Automate multi-step web workflows

**Anti-Detection Features:**
- Automatic browser fallback if the selected browser fails
- Anti-detection browser flags to reduce bot detection
- Graceful captcha handling with suggestions for alternative sites
- Session persistence for maintaining login state

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
│           ├── App.tsx   # Main UI components (Chat, Tasks, Skills, About Me, etc.)
│           └── styles.css
├── packages/             # Shared modules (future use)
│   ├── memory/
│   ├── integrations/
│   └── ...
└── ~/.wovly-assistant/   # User data (outside repo)
    ├── settings.json     # API keys, tokens (local only)
    ├── profile.md        # Personal profile (About Me data)
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
