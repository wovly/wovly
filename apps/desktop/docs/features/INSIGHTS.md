# Smart Insights

<p align="center">
  <img src="../../../../assets/insight.png" alt="Insights Dashboard" width="800">
</p>

## Overview

Wovly's Smart Insights automatically analyzes your messages across all connected platforms (Gmail, Slack, iMessage, custom websites, etc.) to surface important information you might have missed. Every hour, the system cross-references new messages with your profile, goals, calendar, and historical context to generate actionable insights.

## How It Works

### 1. Message Collection (Every Hour)

The insights processor runs on a scheduled interval to collect new messages from:
- **Gmail** - Emails from the past hour
- **Slack** - Direct messages and channel activity
- **iMessage** - Text message conversations
- **Custom Websites** - Scraped messages from configured sites (Brightwheel, tax portals, etc.)

All messages are consolidated into a unified timeline regardless of source.

### 2. Fact Extraction

Each message is analyzed using AI to extract key facts:
- **People mentioned** - Names, roles, relationships
- **Dates and times** - Deadlines, meetings, events
- **Commitments** - Promises made, agreements reached
- **Questions** - Unanswered queries or action items
- **Sentiment** - Tone and urgency signals

Example extracted fact:
```json
{
  "fact": "Sarah needs the Q4 report by Friday at 3pm",
  "source": "gmail",
  "sender": "sarah@company.com",
  "timestamp": "2026-02-21T14:30:00Z",
  "confidence": "high"
}
```

### 3. Cross-Referencing

Extracted facts are cross-checked against multiple data sources:
- **Your profile** - Name, role, goals, preferences
- **Calendar** - Existing meetings and commitments
- **Conversation history** - Previous messages and context
- **Custom websites** - Information from non-API sources

This cross-referencing identifies:
- **Conflicts** - Scheduling overlaps, contradictory information
- **Gaps** - Missed follow-ups, pending responses
- **Patterns** - Recurring issues, communication breakdowns

### 4. Insight Generation

When conflicts, gaps, or patterns are detected, the system generates an insight:

```json
{
  "type": "conflict",
  "priority": 4,
  "title": "Scheduling conflict detected",
  "description": "You have two meetings scheduled at 2pm on Friday",
  "relatedMessages": [...],
  "suggestedAction": "Reschedule the team sync to 3pm"
}
```

### 5. Priority Scoring (1-5)

Each insight receives a priority score:
- **5 (Critical)** - Urgent conflicts, missed deadlines, important unanswered questions
- **4 (High)** - Scheduling conflicts, pending responses from VIPs
- **3 (Medium)** - General follow-ups, minor conflicts
- **2 (Low)** - FYI items, nice-to-know information
- **1 (Minimal)** - Archival facts, low-priority updates

Priority is determined by:
- Sender importance (based on your interaction history)
- Time sensitivity (deadlines, meeting proximity)
- Keyword signals (urgent, ASAP, important, etc.)
- Your stated goals and preferences

### 6. Smart Filtering

Only high-value insights are shown. The system filters out:
- ❌ Duplicate information already handled
- ❌ Low-priority updates not aligned with your goals
- ❌ Routine confirmations that don't need action
- ❌ Spam or marketing content

You'll typically see **3-10 insights per day** instead of hundreds of messages.

## Insight Types

### Conflict Detection

Identifies contradictory information or scheduling overlaps:
- **Scheduling conflicts** - Two meetings at the same time
- **Information conflicts** - Contradictory facts from different sources
- **Commitment conflicts** - Overlapping promises or deadlines

**Example:**
> **Conflict detected:** You promised to deliver the report to John by Wednesday, but Sarah expects it on Tuesday according to her Slack message.

### Follow-up Tracking

Reminds you of pending responses and action items:
- **Unanswered questions** - Messages asking for your input
- **Pending commitments** - Items you agreed to handle
- **Missed replies** - People waiting for your response

**Example:**
> **Follow-up needed:** Mike asked about the budget proposal 3 days ago and hasn't received a response.

### Miscommunication Alerts

Flags potential misunderstandings before they escalate:
- **Ambiguous language** - Unclear expectations or dates
- **Missing context** - References to unknown topics
- **Tone mismatches** - Potential friction in communication

**Example:**
> **Possible miscommunication:** The client mentioned "next Tuesday" but it's unclear if they mean Feb 25 or Mar 4.

### Action Needed

Highlights items requiring your immediate attention:
- **Urgent requests** - Time-sensitive asks
- **Deadline reminders** - Upcoming due dates
- **Decision points** - Questions requiring your input

**Example:**
> **Action needed:** Sign the contract by 5pm today (mentioned in email from legal team).

### Fact Conflicts

Detects inconsistencies in information across platforms:
- **Factual contradictions** - Different versions of the same story
- **Version mismatches** - Outdated information being referenced
- **Source disagreements** - Different platforms showing conflicting data

**Example:**
> **Fact conflict:** Calendar shows meeting at 2pm, but Slack message says 3pm.

## Integration Source Icons

Each insight card displays an icon showing which platform the information primarily came from:

- 📧 **Gmail** - Email-based insights
- 💬 **iMessage** - Text message insights
- 💼 **Slack** - Workspace communication insights
- 🌐 **Custom Website** - Scraped messages from configured sites
- 📅 **Calendar** - Event-based insights

The icon represents the **most common source** among the related messages for that insight.

## Using Insights Effectively

### 1. Check Daily

Review insights each morning to:
- See what you missed overnight
- Identify urgent action items
- Plan your day around priorities

### 2. Click for Context

Each insight card shows:
- **Related messages** - Source messages that generated the insight
- **Suggested actions** - Recommended next steps
- **Priority level** - How urgent it is

Click "View Details" to see the full context and message threads.

### 3. Take Action

Common actions:
- **Respond** - Send a reply directly from the insight card
- **Schedule** - Add to calendar or create a reminder
- **Dismiss** - Mark as handled or not relevant
- **Snooze** - Remind me later

### 4. Customize Settings

Tailor insights to your needs:
- **Filter by priority** - Only show priority 3+ insights
- **Filter by source** - Focus on specific platforms
- **Adjust frequency** - Check hourly, daily, or custom intervals
- **Set focus areas** - Define what's important to you

Go to **Settings → Insights** to configure preferences.

## Multi-Source Analysis

Insights can combine information from multiple platforms to give you the complete picture:

**Example scenario:**
1. Client sends email asking for meeting
2. Colleague messages you on Slack about preparing for that client
3. Calendar shows you already have a conflict at that time
4. Daycare sends message on Brightwheel about early pickup needed

**Generated insight:**
> **High-priority conflict:** Client meeting requested via email conflicts with existing calendar event. Additionally, early daycare pickup needed at 4pm limits afternoon availability. Colleague is waiting for prep discussion on Slack.
>
> **Suggested action:** Propose alternative meeting time, coordinate with colleague, arrange backup for daycare pickup.

This holistic view saves you from context-switching across multiple apps.

## Privacy & Data Retention

- **Local processing** - All analysis happens on your machine
- **No cloud storage** - Insights stored in `~/.wovly-assistant/users/{username}/insights/`
- **Auto-cleanup** - Old insights deleted after 90 days
- **Encrypted** - Sensitive data encrypted at rest
- **LLM calls** - Only sent to your chosen provider (Anthropic, OpenAI, Google)

## Technical Details

### Storage Format

Insights are stored as daily JSON files:

**Location:** `~/.wovly-assistant/users/{username}/insights/YYYY-MM-DD.json`

**Schema:**
```json
{
  "date": "2026-02-21",
  "insights": [
    {
      "id": "insight_abc123",
      "type": "conflict",
      "priority": 4,
      "title": "Scheduling conflict detected",
      "description": "...",
      "relatedMessages": [
        {
          "platform": "gmail",
          "from": "john@example.com",
          "subject": "Meeting request",
          "timestamp": "2026-02-21T10:00:00Z",
          "snippet": "Can we meet at 2pm Friday?"
        }
      ],
      "suggestedAction": "Reschedule the team sync",
      "createdAt": "2026-02-21T11:00:00Z",
      "dismissed": false
    }
  ],
  "metadata": {
    "totalInsights": 1,
    "processedMessages": 47,
    "sources": ["gmail", "slack", "imessage"]
  }
}
```

### Scheduling

Insights are processed:
- **Hourly** - Default schedule for most users
- **On-demand** - Manual refresh from UI
- **On login** - Catches up on messages since last check

Configure in `~/.wovly-assistant/users/{username}/tasks/scheduled/insights.json`

### Performance

- **Average processing time** - 30-60 seconds for 50 messages
- **LLM calls** - 2-3 per batch (fact extraction + insight generation)
- **Token usage** - ~5,000-10,000 tokens per hourly check
- **Cost** - $0.01-0.03 per hour with Claude Sonnet (lower with Haiku optimization)

## Troubleshooting

### No insights showing

**Possible causes:**
- No new messages in the past hour
- All insights below your priority filter threshold
- Integration not properly configured

**Solutions:**
- Check "Settings → Integrations" to verify connections
- Lower priority filter to see all insights
- Manually trigger refresh with the refresh button

### Insights seem inaccurate

**Possible causes:**
- Profile information outdated
- Calendar not connected
- Insufficient conversation history

**Solutions:**
- Update your profile in "Settings → About Me"
- Connect Google Calendar in "Settings → Integrations"
- Give the system 2-3 days to build context

### Too many insights

**Possible causes:**
- Priority threshold too low
- Too many connected integrations
- Noisy channels included

**Solutions:**
- Increase priority threshold to 3 or 4
- Configure per-platform filters
- Exclude low-value channels in Slack settings

## Best Practices

1. **Update your profile regularly** - The more context Wovly has about your role, goals, and preferences, the better insights will be

2. **Connect all platforms** - Insights are most valuable when analyzing across Gmail, Slack, iMessage, and custom sites together

3. **Act on high-priority items first** - Focus on priority 4-5 insights, review lower priorities when you have time

4. **Provide feedback** - Dismiss irrelevant insights to train the system on what matters to you

5. **Use custom websites** - Add daycare portals, tax sites, school systems to get insights from sources without APIs

6. **Review weekly patterns** - Look for recurring conflicts or communication issues to address systemically

## Examples

### Example 1: Cross-Platform Coordination
**Messages:**
- Gmail: Client asks for Friday 2pm meeting
- Slack: Colleague asks when the client meeting is
- iMessage: Wife asks to pick up kids at 2pm Friday
- Calendar: Already have team sync at 2pm Friday

**Generated Insight (Priority 5):**
> **Critical conflict:** Four conflicting commitments at 2pm Friday. Client meeting request (email), team sync (calendar), child pickup (text), and colleague inquiry (Slack) all need coordination.

### Example 2: Follow-up Detection
**Messages:**
- Slack (Monday): Boss asks for Q1 numbers
- Gmail (Wednesday): Boss follows up on Q1 numbers
- No response sent

**Generated Insight (Priority 4):**
> **Follow-up needed:** Boss has asked twice for Q1 numbers (Slack Mon, Email Wed) with no response yet. Deadline may be approaching.

### Example 3: Custom Website Integration
**Messages:**
- Brightwheel: Field trip permission form due Friday
- Calendar: Out of office all day Friday
- Gmail: No communication with teacher

**Generated Insight (Priority 3):**
> **Action needed:** Daycare field trip form due Friday, but you're OOO that day. Submit early or email teacher about extension.

---

## Related Documentation

- [Integrations](./INTEGRATIONS.md) - Configure message sources
- [Tasks](./TASKS.md) - Automate insight-driven workflows
- [Skills](./SKILLS.md) - Create custom insight triggers
- [Interfaces](./INTERFACES.md) - Access insights remotely

## Support

For issues or questions:
- [GitHub Issues](https://github.com/wovly/wovly/issues)
- [FAQ](../reference/faq.mdx)
- [Troubleshooting Guide](../reference/troubleshooting.mdx)
