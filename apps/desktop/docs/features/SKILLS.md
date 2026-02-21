# Customizable Skills

<p align="center">
  <img src="../../../../assets/skills.png" alt="Skills" width="800">
</p>

## Overview

Skills are custom behaviors you teach Wovly to handle specific scenarios automatically. Think of them as "when X happens, do Y" rules combined with custom instructions for how Wovly should respond in certain situations. Skills enable you to automate repetitive workflows, enforce specific response patterns, and create personalized shortcuts tailored to your needs.

## How Skills Work

### Skill Execution Flow

```
User Message → Skill Matcher → Skill Executor → Response
     ↓              ↓                ↓              ↓
  "marco"    Match found      Execute      "polo"
              (marco skill)    instructions  returned
```

**Step-by-step:**
1. **User sends message** (via desktop, WhatsApp, Telegram, etc.)
2. **Skill matcher** checks if message matches any skill triggers
3. **Skill executor** runs the matched skill's instructions
4. **Response sent** back to user

### Skill Components

Every skill has three parts:

**1. Trigger** - What activates the skill
```
Trigger: User says "marco"
```

**2. Conditions** (Optional) - Additional requirements
```
Conditions:
- Only between 9am-5pm
- Only if user is "jeff"
- Only in desktop chat (not WhatsApp)
```

**3. Instructions** - What to do
```
Instructions:
Respond with "polo" and include the current time.
```

## Creating Skills

### Method 1: Natural Language (Easiest)

Simply describe what you want in plain English:

**Example 1:**
```
You: Create a skill that when I say "marco", you respond with "polo"

Wovly: Skill created:
✓ Trigger: Message contains "marco"
✓ Instructions: Respond with "polo"
✓ Enabled: Yes

Test it now by saying "marco"!
```

**Example 2:**
```
You: When someone mentions "urgent" in Slack, send me an iMessage notification

Wovly: Skill created:
✓ Trigger: Slack message contains "urgent"
✓ Action: Send iMessage to your phone
✓ Enabled: Yes

You'll now get instant notifications for urgent Slack messages.
```

**Example 3:**
```
You: Every time I ask about my schedule, also check if there are conflicts

Wovly: Skill created:
✓ Trigger: User asks about schedule/calendar
✓ Instructions: Fetch calendar events AND check for conflicts
✓ Priority: High

Your calendar queries will now include conflict detection automatically.
```

### Method 2: Skills Page (Advanced)

For more control, use the Skills management page:

1. Go to **Skills** tab in sidebar
2. Click **+ Create Skill** button
3. Fill in details:
   - **Name:** "Marco Polo Response"
   - **Trigger Type:** Message contains
   - **Trigger Value:** "marco"
   - **Instructions:** "Respond with 'polo'"
4. Click **Save**

### Method 3: JSON File (Power Users)

Manually create skill files in `~/.wovly-assistant/users/{username}/skills/`

**File:** `marco-polo.json`
```json
{
  "id": "marco-polo",
  "name": "Marco Polo Response",
  "enabled": true,
  "trigger": {
    "type": "message_contains",
    "value": "marco",
    "caseSensitive": false
  },
  "conditions": [],
  "instructions": "Respond with 'polo' and include a fun fact about Marco Polo the explorer.",
  "priority": 1,
  "createdAt": "2026-02-21T10:00:00Z",
  "updatedAt": "2026-02-21T10:00:00Z"
}
```

## Trigger Types

### 1. Message Contains

Activates when user message includes specific text.

```json
{
  "trigger": {
    "type": "message_contains",
    "value": "urgent",
    "caseSensitive": false
  }
}
```

**Examples:**
- "urgent" → Matches "This is URGENT" ✓
- "help" → Matches "I need help with this" ✓
- "EOD" → Matches "Send by eod" ✓ (if caseSensitive: false)

### 2. Message Matches (Exact)

Activates only on exact message match.

```json
{
  "trigger": {
    "type": "message_matches",
    "value": "status"
  }
}
```

**Examples:**
- "status" → Matches "status" ✓
- "status" → Does NOT match "what's the status?" ✗

### 3. Message Pattern (Regex)

Activates on regex pattern match.

```json
{
  "trigger": {
    "type": "message_pattern",
    "value": "^remind me .* at \\d{1,2}(am|pm)$"
  }
}
```

**Examples:**
- Matches: "remind me to call John at 3pm" ✓
- Matches: "remind me to eat lunch at 12pm" ✓
- Does NOT match: "remind me later" ✗

### 4. Platform-Specific

Activates when message comes from specific platform.

```json
{
  "trigger": {
    "type": "platform",
    "value": "slack"
  },
  "conditions": [
    {
      "type": "message_contains",
      "value": "urgent"
    }
  ]
}
```

Only triggers on Slack messages containing "urgent".

### 5. Sender-Specific

Activates when message from specific person.

```json
{
  "trigger": {
    "type": "sender",
    "value": "boss@company.com"
  }
}
```

**Use case:** Auto-prioritize messages from your boss.

### 6. Time-Based

Activates during specific time windows.

```json
{
  "trigger": {
    "type": "schedule",
    "value": {
      "type": "time_range",
      "start": "09:00",
      "end": "17:00",
      "timezone": "America/New_York",
      "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    }
  }
}
```

**Use case:** "Only respond to work questions during business hours."

### 7. Keyword List

Activates on any keyword from a list.

```json
{
  "trigger": {
    "type": "keywords",
    "value": ["help", "assist", "support", "question"]
  }
}
```

## Conditions (Optional)

Add requirements beyond the trigger:

### Time Condition
```json
{
  "conditions": [
    {
      "type": "time_range",
      "start": "09:00",
      "end": "17:00"
    }
  ]
}
```

### User Condition
```json
{
  "conditions": [
    {
      "type": "user",
      "value": "jeff"
    }
  ]
}
```

### Platform Condition
```json
{
  "conditions": [
    {
      "type": "platform",
      "value": "desktop"
    }
  ]
}
```

### Integration Status Condition
```json
{
  "conditions": [
    {
      "type": "integration_connected",
      "value": "slack"
    }
  ]
}
```

### Multiple Conditions (AND logic)
```json
{
  "conditions": [
    {
      "type": "platform",
      "value": "whatsapp"
    },
    {
      "type": "time_range",
      "start": "18:00",
      "end": "23:59"
    }
  ]
}
```

All conditions must be met for skill to activate.

## Instruction Types

### 1. Simple Response

Return a fixed message.

```json
{
  "instructions": "Respond with: polo"
}
```

### 2. Dynamic Response with Tools

Execute tools and format response.

```json
{
  "instructions": "Check the user's calendar for today and list all events in chronological order. If there are conflicts, highlight them with a warning emoji."
}
```

### 3. Multi-Step Procedure

Chain multiple actions together.

```json
{
  "instructions": `
    1. Search Gmail for messages from the sender
    2. Summarize the last 3 conversations
    3. Check if there are any pending action items
    4. If yes, add them to the task list
    5. Respond with a summary and confirmation of tasks added
  `
}
```

### 4. Conditional Logic

Different actions based on context.

```json
{
  "instructions": `
    IF it's before 12pm:
      Respond with "Good morning!" and show today's schedule
    ELSE IF it's before 6pm:
      Respond with "Good afternoon!" and show remaining tasks
    ELSE:
      Respond with "Good evening!" and summarize the day
  `
}
```

### 5. Template Response

Use variables and context.

```json
{
  "instructions": `
    Respond with:
    "Hello {{user_name}}! You have {{email_count}} unread emails and {{task_count}} pending tasks."

    Then list the top 3 priority items.
  `
}
```

## Skill Priority

When multiple skills match, priority determines execution order:

**Priority levels:**
- **10 (Critical)** - Override all other skills
- **5 (High)** - Execute before normal skills
- **1 (Normal)** - Default priority
- **0 (Low)** - Only if no other skills match

**Example scenario:**
```
User: "help"

Skills matched:
1. General Help Skill (priority: 1)
2. Emergency Help Skill (priority: 10)

→ Emergency Help Skill executes (higher priority)
```

## Practical Examples

### Example 1: Auto-Reply to VIPs

**Scenario:** Instantly notify when your boss emails you.

```json
{
  "id": "boss-email-notification",
  "name": "Boss Email Alert",
  "enabled": true,
  "trigger": {
    "type": "platform",
    "value": "gmail"
  },
  "conditions": [
    {
      "type": "sender",
      "value": "boss@company.com"
    }
  ],
  "instructions": "Send me an iMessage immediately saying: 'New email from boss: {{email_subject}}'. Include the first 100 characters of the email body.",
  "priority": 10
}
```

### Example 2: Morning Briefing

**Scenario:** Every time you say "morning", get a full briefing.

```json
{
  "id": "morning-briefing",
  "name": "Morning Briefing",
  "enabled": true,
  "trigger": {
    "type": "message_contains",
    "value": "morning"
  },
  "conditions": [
    {
      "type": "time_range",
      "start": "06:00",
      "end": "12:00"
    }
  ],
  "instructions": `
    Respond with a comprehensive morning briefing:

    1. Greeting with current date and weather
    2. Calendar for today (list all events)
    3. Unread emails count and top 3 important ones
    4. Pending tasks due today
    5. Any insights with priority 4+
    6. Motivational quote to end

    Format with emojis and clear sections.
  `,
  "priority": 5
}
```

### Example 3: Smart Reminders

**Scenario:** Parse natural language reminders.

```json
{
  "id": "smart-reminders",
  "name": "Natural Language Reminders",
  "enabled": true,
  "trigger": {
    "type": "message_pattern",
    "value": "remind me (to )?(.+) (at|in) (.+)"
  },
  "instructions": `
    Parse the reminder from the user's message:
    - Extract the task description
    - Extract the time (convert natural language like "in 2 hours" to actual time)
    - Create a task with the correct due time
    - Respond with confirmation: "✓ Reminder set: [task] at [time]"
  `,
  "priority": 5
}
```

**Usage:**
```
You: Remind me to call John at 3pm
Wovly: ✓ Reminder set: Call John at 3:00pm today

You: Remind me to submit report in 2 hours
Wovly: ✓ Reminder set: Submit report at 4:30pm today
```

### Example 4: Meeting Coordinator

**Scenario:** Streamline meeting scheduling.

```json
{
  "id": "meeting-coordinator",
  "name": "Meeting Coordinator",
  "enabled": true,
  "trigger": {
    "type": "keywords",
    "value": ["schedule meeting", "book meeting", "set up meeting", "arrange meeting"]
  },
  "instructions": `
    Act as a meeting coordinator:

    1. Ask who the meeting is with
    2. Check user's calendar for availability this week
    3. Ask preferred day/time or suggest 3 options
    4. Once confirmed:
       - Send email to attendee with meeting request
       - Create calendar event
       - Add to user's task list: "Prepare for [meeting]"
    5. Confirm all actions completed
  `,
  "priority": 5
}
```

**Conversation:**
```
You: Schedule a meeting with Sarah

Wovly: I'll help you schedule a meeting with Sarah.

Checking your calendar... You have availability:
• Tuesday 2pm-4pm
• Wednesday 10am-12pm
• Thursday 2pm-5pm

When would you prefer?

You: Wednesday at 10am

Wovly: Perfect! Actions completed:
✓ Email sent to sarah@company.com requesting meeting
✓ Calendar event created: Wednesday, Feb 26 at 10:00am
✓ Task added: "Prepare for Sarah meeting"

Anything else you need to prepare?
```

### Example 5: Context-Aware Responses

**Scenario:** Different responses based on platform.

```json
{
  "id": "context-aware-status",
  "name": "Context-Aware Status",
  "enabled": true,
  "trigger": {
    "type": "message_matches",
    "value": "status"
  },
  "instructions": `
    IF platform is "whatsapp":
      Respond with mobile-friendly brief status:
      "✓ All systems operational
       📧 3 unread emails
       📅 2 meetings today
       ✅ 5 tasks pending"

    ELSE IF platform is "desktop":
      Respond with detailed status including:
      - System health (integrations, last sync times)
      - Full email breakdown
      - Complete calendar with event details
      - Task list with priorities
      - Recent insights
      - LLM usage stats

    ELSE:
      Respond with: "Status check available on desktop or WhatsApp"
  `,
  "priority": 5
}
```

### Example 6: Daycare Updates

**Scenario:** Summarize daycare messages from custom website integration.

```json
{
  "id": "daycare-summary",
  "name": "Daycare Updates",
  "enabled": true,
  "trigger": {
    "type": "keywords",
    "value": ["daycare", "brightwheel", "school"]
  },
  "instructions": `
    Search custom web messages from source "brightwheel" for the past 7 days.

    Summarize:
    1. Important updates (field trips, permission forms, schedule changes)
    2. Daily reports (naps, meals, activities)
    3. Teacher notes or concerns
    4. Upcoming events

    Format with clear date headers and categorization.
    Flag any action items (forms due, payments needed, etc.)
  `,
  "priority": 5
}
```

## Skill Management

### Enable/Disable Skills

**Via UI:**
1. Go to **Skills** tab
2. Toggle switch next to skill name
3. Disabled skills won't activate

**Via File:**
Set `"enabled": false` in skill JSON file.

### Edit Skills

**Via UI:**
1. Click skill card
2. Click **Edit** button
3. Modify trigger, conditions, or instructions
4. Click **Save**

**Via File:**
Edit JSON file directly and save (changes detected automatically).

### Delete Skills

**Via UI:**
1. Click skill card
2. Click **Delete** button
3. Confirm deletion

**Via File:**
Delete JSON file from `~/.wovly-assistant/users/{username}/skills/`

### Test Skills

**Test specific skill:**
```
You: Test skill "marco-polo"

Wovly: Testing skill "Marco Polo Response"...

Trigger: ✓ Would match "marco"
Conditions: ✓ All met
Instructions: ✓ Valid

Sample output: "polo - Marco Polo was a Venetian merchant
                who traveled to China in the 13th century!"

Test passed ✓
```

### View Skill Logs

**Location:** `~/.wovly-assistant/users/{username}/logs/skills.log`

**Example log:**
```
[2026-02-21 14:30:15] Skill matched: marco-polo
[2026-02-21 14:30:15] Trigger: message_contains "marco"
[2026-02-21 14:30:15] Conditions: all met (0 conditions)
[2026-02-21 14:30:15] Executing instructions...
[2026-02-21 14:30:16] Response sent: "polo - Marco Polo was..."
[2026-02-21 14:30:16] Execution time: 1.2s
```

## Advanced Features

### Skill Variables

Use dynamic variables in instructions:

**Available variables:**
- `{{user_name}}` - Current user's name
- `{{user_email}}` - User's primary email
- `{{platform}}` - Where message came from (desktop, whatsapp, telegram)
- `{{current_date}}` - Today's date (YYYY-MM-DD)
- `{{current_time}}` - Current time (HH:MM)
- `{{sender}}` - Who sent the triggering message (if applicable)
- `{{message}}` - The full triggering message

**Example:**
```json
{
  "instructions": "Hello {{user_name}}! You sent this at {{current_time}} on {{platform}}. Your message was: {{message}}"
}
```

### Skill Chaining

One skill can trigger another:

```json
{
  "id": "morning-email-check",
  "instructions": "Check emails. If there are urgent ones, activate the 'urgent-email-handler' skill."
}
```

### Skill Templates

Create reusable skill templates:

**Template:** "Notify on keyword"
```json
{
  "template": "notify-on-keyword",
  "parameters": {
    "keyword": "{{KEYWORD}}",
    "notification_method": "{{METHOD}}",
    "notification_recipient": "{{RECIPIENT}}"
  },
  "trigger": {
    "type": "message_contains",
    "value": "{{KEYWORD}}"
  },
  "instructions": "Send {{METHOD}} to {{RECIPIENT}} saying: 'Keyword detected: {{KEYWORD}}'"
}
```

**Instantiate:**
```json
{
  "id": "urgent-slack-notifier",
  "fromTemplate": "notify-on-keyword",
  "parameters": {
    "keyword": "urgent",
    "notification_method": "iMessage",
    "notification_recipient": "+1234567890"
  }
}
```

### Skill Groups

Organize related skills:

```json
{
  "group": "work-automation",
  "skills": [
    "boss-email-notification",
    "meeting-coordinator",
    "urgent-slack-notifier"
  ],
  "enabled": true
}
```

Enable/disable entire group at once.

## Best Practices

### 1. Start Simple

Begin with basic skills:
- ✅ "marco" → "polo"
- ✅ "morning" → calendar + tasks
- ✅ Keyword notifications

Avoid complex multi-step procedures initially.

### 2. Use Descriptive Names

**Good:**
- "Boss Email Notification"
- "Morning Briefing"
- "Urgent Slack Alert"

**Bad:**
- "Skill 1"
- "Test"
- "Reminder thing"

### 3. Test Thoroughly

Before enabling:
- Test all trigger conditions
- Verify instructions work correctly
- Check edge cases (empty results, errors)
- Ensure no conflicts with other skills

### 4. Set Appropriate Priorities

- **10:** Critical overrides (emergency alerts)
- **5:** Important automations (boss emails, meeting coordinators)
- **1:** General helpers (summaries, searches)
- **0:** Fallback responses

### 5. Document Your Skills

Add comments in JSON:
```json
{
  "id": "marco-polo",
  "description": "Fun response to test skill system. Created 2026-02-21 as first skill example.",
  "notes": "Based on the children's game Marco Polo"
}
```

### 6. Monitor Performance

Check skill logs weekly:
- Which skills activate most?
- Any errors or failures?
- Skills that never trigger? (delete them)

### 7. Avoid Skill Conflicts

If two skills match the same trigger, use priority or conditions to differentiate:

```json
// General help skill
{
  "trigger": {"type": "message_contains", "value": "help"},
  "priority": 1
}

// Emergency help skill (higher priority)
{
  "trigger": {"type": "message_contains", "value": "help"},
  "conditions": [{"type": "message_contains", "value": "urgent"}],
  "priority": 10
}
```

## Troubleshooting

### Skill Not Activating

**Check:**
1. Skill is enabled (toggle in UI)
2. Trigger matches your message exactly
3. All conditions are met
4. No higher-priority skill overriding

**Debug:**
Enable debug logging:
```json
{
  "debug": true
}
```

Logs will show why skill didn't match.

### Skill Activating Too Often

**Possible causes:**
- Trigger too broad ("help" matches "helpful", "helped", etc.)
- No conditions to limit activation

**Solutions:**
- Use `message_matches` instead of `message_contains` for exact matching
- Add time or platform conditions
- Use regex pattern for precise matching

### Skill Instructions Not Working

**Check:**
1. Instructions reference valid tools
2. Tool parameters are correct
3. Required integrations are connected
4. Syntax is valid (no typos)

**Debug:**
Test skill with simple instruction first:
```json
{
  "instructions": "Respond with 'test'"
}
```

If that works, gradually add complexity.

### Multiple Skills Conflicting

**Symptoms:**
- Unexpected behavior
- Wrong skill activating
- Skills not activating at all

**Solutions:**
1. Review all skills with similar triggers
2. Adjust priorities
3. Add conditions to disambiguate
4. Disable conflicting skills temporarily

## Related Documentation

- [Tasks](./TASKS.md) - Schedule automated workflows
- [Insights](./INSIGHTS.md) - Skills can trigger on insights
- [Integrations](./INTEGRATIONS.md) - Tools available in skill instructions
- [Interfaces](./INTERFACES.md) - Skills work across all interfaces

## Support

For skill questions:
- [GitHub Issues](https://github.com/wovly/wovly/issues)
- [FAQ](../reference/faq.mdx)
- [Examples Repository](https://github.com/wovly/wovly-skills)
