/**
 * Tool Result Formatting Utility
 * Formats tool results in human-readable format for better LLM comprehension
 */

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email?: string;
}

export interface EmailMessage {
  id?: string;
  from?: EmailAddress;
  to?: EmailAddress[] | string[];
  subject?: string;
  date?: string | number;
  body?: string;
}

export interface CalendarEvent {
  title?: string;
  start?: string | number;
  end?: string | number;
  location?: string;
  attendees?: Array<{ email?: string } | string>;
}

export interface SlackMessage {
  from?: string;
  user?: string;
  timestamp?: number;
  text?: string;
  message?: string;
}

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string | number;
  size?: number;
}

export interface Task {
  id?: string;
  title?: string;
  status?: string;
  created_at?: string | number;
}

export interface MemorySearchResult {
  date?: string;
  text?: string;
  content?: string;
}

export interface WeatherData {
  current?: {
    temp?: number;
    unit?: string;
    condition?: string;
    precipitation?: number;
  };
}

export interface BrowserResult {
  url?: string;
  title?: string;
  selector?: string;
  data?: unknown[];
}

export interface VariableResult {
  name?: string;
  value?: unknown;
  result?: boolean;
}

export interface ToolResult {
  error?: string;
  messages?: EmailMessage[] | SlackMessage[];
  emails?: EmailMessage[];
  events?: CalendarEvent[];
  files?: DriveFile[];
  tasks?: Task[];
  results?: MemorySearchResult[];
  to?: string;
  title?: string;
  start?: string | number;
  name?: string;
  id?: string;
  current?: WeatherData['current'];
  time?: string | number;
  current_time?: string | number;
  [key: string]: unknown;
}

export interface ToolResultPair {
  toolName: string;
  result: ToolResult;
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting Functions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format tool result based on tool type
 * @param toolName - Name of the tool
 * @param result - Tool result object
 * @returns Formatted result
 */
export function formatToolResult(toolName: string, result: ToolResult): string {
  // Handle errors
  if (result.error) {
    return `Error: ${result.error}`;
  }

  // Tool-specific formatting
  switch (toolName) {
    // ─────────────────────────────────────────────────────────────────────────
    // Email Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'search_emails':
      if (!result.messages || result.messages.length === 0) {
        return 'No emails found.';
      }
      return (
        `Found ${result.messages.length} email(s):\n\n` +
        (result.messages as EmailMessage[])
          .map((msg, i) => {
            const from = msg.from?.name || msg.from?.email || 'Unknown';
            const date = msg.date ? new Date(msg.date).toLocaleString() : 'Unknown date';
            return `${i + 1}. From: ${from}\n   Subject: ${msg.subject}\n   Date: ${date}\n   ID: ${msg.id}`;
          })
          .join('\n\n')
      );

    case 'get_email_contents':
    case 'get_email_contents_batch':
      if (!result.emails || result.emails.length === 0) {
        return 'No email contents retrieved.';
      }
      return result.emails
        .map((email, i) => {
          const from = email.from?.name || email.from?.email || 'Unknown';
          const to = Array.isArray(email.to)
            ? email.to.map((t) => (typeof t === 'string' ? t : t.email || t)).join(', ')
            : 'Unknown';
          const date = email.date ? new Date(email.date).toLocaleString() : 'Unknown';
          const preview = email.body?.substring(0, 200) || '';

          return (
            `Email ${i + 1}:\n` +
            `From: ${from}\n` +
            `To: ${to}\n` +
            `Subject: ${email.subject}\n` +
            `Date: ${date}\n` +
            `Preview: ${preview}${preview.length >= 200 ? '...' : ''}`
          );
        })
        .join('\n\n---\n\n');

    case 'send_email':
      return `Email sent successfully to ${result.to || 'recipient'}`;

    // ─────────────────────────────────────────────────────────────────────────
    // Calendar Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'get_calendar_events':
      if (!result.events || result.events.length === 0) {
        return 'No calendar events found.';
      }
      return (
        `Calendar events (${result.events.length}):\n\n` +
        result.events
          .map((event, i) => {
            const start = event.start ? new Date(event.start).toLocaleString() : 'Unknown';
            const end = event.end ? new Date(event.end).toLocaleString() : 'Unknown';
            const location = event.location ? `\n   Location: ${event.location}` : '';
            const attendees =
              event.attendees && event.attendees.length > 0
                ? `\n   Attendees: ${event.attendees.map((a) => (typeof a === 'string' ? a : a.email || a)).join(', ')}`
                : '';

            return `${i + 1}. ${event.title}\n   ${start} to ${end}${location}${attendees}`;
          })
          .join('\n\n')
      );

    case 'create_event':
      return `Calendar event created: "${result.title || 'Untitled'}" at ${result.start || 'scheduled time'}`;

    // ─────────────────────────────────────────────────────────────────────────
    // Messaging Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'get_slack_messages':
    case 'get_recent_messages':
      if (!result.messages || result.messages.length === 0) {
        return 'No messages found.';
      }
      return (
        `Found ${result.messages.length} message(s):\n\n` +
        (result.messages as SlackMessage[])
          .map((msg, i) => {
            const from = msg.from || msg.user || 'Unknown';
            const date = msg.timestamp
              ? new Date(msg.timestamp * 1000).toLocaleString()
              : 'Unknown';
            const text = msg.text || msg.message || '';

            return `${i + 1}. From: ${from}\n   Time: ${date}\n   Message: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`;
          })
          .join('\n\n')
      );

    case 'send_slack_message':
    case 'send_imessage':
      return `Message sent successfully`;

    // ─────────────────────────────────────────────────────────────────────────
    // File/Drive Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'search_drive':
      if (!result.files || result.files.length === 0) {
        return 'No files found.';
      }
      return (
        `Found ${result.files.length} file(s):\n\n` +
        result.files
          .map((file, i) => {
            const modified = file.modifiedTime
              ? new Date(file.modifiedTime).toLocaleString()
              : 'Unknown';
            const size = file.size ? `${(file.size / 1024).toFixed(2)} KB` : 'Unknown';

            return `${i + 1}. ${file.name}\n   Type: ${file.mimeType || 'Unknown'}\n   Modified: ${modified}\n   Size: ${size}\n   ID: ${file.id}`;
          })
          .join('\n\n')
      );

    case 'upload_drive_file':
      return `File uploaded: "${result.name || 'file'}" (ID: ${result.id || 'unknown'})`;

    // ─────────────────────────────────────────────────────────────────────────
    // Task Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'list_tasks':
      if (!result.tasks || result.tasks.length === 0) {
        return 'No tasks found.';
      }
      return (
        `Tasks (${result.tasks.length}):\n\n` +
        result.tasks
          .map((task, i) => {
            const status = task.status || 'unknown';
            const created = task.created_at
              ? new Date(task.created_at).toLocaleString()
              : 'Unknown';

            return `${i + 1}. ${task.title || 'Untitled'}\n   Status: ${status}\n   Created: ${created}`;
          })
          .join('\n\n')
      );

    case 'create_task':
      return `Task created: "${result.title || 'Untitled'}" (ID: ${result.id || 'unknown'})`;

    case 'update_task':
      return `Task updated successfully`;

    // ─────────────────────────────────────────────────────────────────────────
    // Memory/Search Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'search_memory':
      if (!result.results || result.results.length === 0) {
        return 'No relevant memories found.';
      }
      return (
        `Memory search results (${result.results.length}):\n\n` +
        result.results
          .map((r, i) => {
            const date = r.date || 'Unknown date';
            return `${i + 1}. [${date}] ${r.text || r.content || 'No content'}`;
          })
          .join('\n\n')
      );

    // ─────────────────────────────────────────────────────────────────────────
    // Weather Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'get_weather':
      if (result.current) {
        return (
          `Weather: ${result.current.temp}°${result.current.unit || 'F'}, ${result.current.condition || 'Unknown conditions'}` +
          (result.current.precipitation
            ? `\nPrecipitation: ${result.current.precipitation}%`
            : '')
        );
      }
      return JSON.stringify(result, null, 2);

    // ─────────────────────────────────────────────────────────────────────────
    // Browser Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'browser_navigate':
      return `Navigated to: ${result.url || 'page'}\nPage title: ${result.title || 'Unknown'}`;

    case 'browser_click':
      return `Clicked on element: ${result.selector || 'element'}`;

    case 'browser_type':
      return `Typed text into: ${result.selector || 'element'}`;

    case 'browser_extract':
      if (result.data && Array.isArray(result.data)) {
        return `Extracted ${result.data.length} item(s) from page`;
      }
      return `Extracted data from page`;

    // ─────────────────────────────────────────────────────────────────────────
    // Time Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'get_current_time': {
      const time = result.time || result.current_time || result;
      return `Current time: ${typeof time === 'string' ? time : new Date(time as number).toLocaleString()}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Variable/State Tools
    // ─────────────────────────────────────────────────────────────────────────

    case 'save_variable':
      return `Variable "${result.name || 'unknown'}" saved with value: ${JSON.stringify(result.value)}`;

    case 'get_variable':
      return `Variable "${result.name || 'unknown'}": ${JSON.stringify(result.value)}`;

    case 'check_variable':
      return `Variable check result: ${result.result ? 'TRUE' : 'FALSE'}`;

    // ─────────────────────────────────────────────────────────────────────────
    // Default: Return formatted JSON
    // ─────────────────────────────────────────────────────────────────────────

    default:
      // For unknown tools, return formatted JSON
      return JSON.stringify(result, null, 2);
  }
}

/**
 * Format multiple tool results
 * @param results - Array of tool results
 * @returns Formatted results
 */
export function formatToolResults(results: ToolResultPair[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No results';
  }

  if (results.length === 1) {
    return formatToolResult(results[0].toolName, results[0].result);
  }

  return results
    .map((r, i) => {
      const formatted = formatToolResult(r.toolName, r.result);
      return `Tool ${i + 1} (${r.toolName}):\n${formatted}`;
    })
    .join('\n\n---\n\n');
}
