/**
 * Google Calendar Integration Module
 *
 * Provides Google Calendar functionality: get, create, and delete events.
 * Part of the Google Workspace integration.
 */

import { IntegrationContext } from '../../base';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const calendarTools = [
  {
    name: 'get_calendar_events',
    description: 'Get calendar events for a specific date or date range.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        days: { type: 'number', description: 'Number of days to fetch (default 1)' },
      },
      required: [],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a new calendar event with optional attendees. Attendees will receive email invitations.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start datetime in ISO format' },
        end: { type: 'string', description: 'End datetime in ISO format' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of email addresses to invite to the event. They will receive calendar invitations.',
        },
        sendNotifications: {
          type: 'boolean',
          description: 'Whether to send email notifications to attendees (default: true)',
        },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete a calendar event by ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'The event ID to delete' },
      },
      required: ['eventId'],
    },
  },
] as any[];

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch calendar events from Google Calendar API
 */
async function fetchCalendarEvents(
  accessToken: string,
  startDate: Date,
  endDate: Date
): Promise<any> {
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', startDate.toISOString());
  url.searchParams.set('timeMax', endDate.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as any;
    console.error('Calendar API error:', errorData);
    throw new Error(errorData.error?.message || 'Failed to fetch events');
  }

  const data = (await response.json()) as any;
  return {
    events: data.items || [],
    count: data.items?.length || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Google Calendar tool
 */
export async function executeCalendarTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.google;
  if (!accessToken) {
    return { error: 'Google access token not available' };
  }

  try {
    switch (toolName) {
      case 'get_calendar_events': {
        const today = new Date();
        const dateStr =
          toolInput.date ||
          `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const days = toolInput.days || 1;

        // Parse date in local timezone (not UTC)
        const [year, month, day] = dateStr.split('-').map(Number);
        const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
        const endDate = new Date(year, month - 1, day + days, 0, 0, 0, 0);

        console.log(
          `[Calendar] Requested date: ${dateStr}, local start: ${startDate.toLocaleString()}, local end: ${endDate.toLocaleString()}`
        );

        return await fetchCalendarEvents(accessToken, startDate, endDate);
      }

      case 'create_calendar_event': {
        const {
          title,
          start,
          end,
          description,
          location,
          attendees,
          sendNotifications = true,
        } = toolInput;

        const eventBody: any = {
          summary: title,
          start: { dateTime: start },
          end: { dateTime: end },
          description,
          location,
        };

        if (attendees && attendees.length > 0) {
          eventBody.attendees = attendees.map((email: string) => ({ email }));
        }

        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        if (attendees && attendees.length > 0) {
          url.searchParams.set('sendUpdates', sendNotifications ? 'all' : 'none');
        }

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventBody),
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as any;
          console.error('Calendar API error:', errorData);
          throw new Error(errorData.error?.message || 'Failed to create event');
        }

        const event = (await response.json()) as any;
        const attendeeCount = attendees?.length || 0;
        const attendeeMsg = attendeeCount > 0 ? ` with ${attendeeCount} attendee(s) invited` : '';
        return {
          success: true,
          eventId: event.id,
          htmlLink: event.htmlLink,
          message: `Created event: ${title}${attendeeMsg}`,
        };
      }

      case 'delete_calendar_event': {
        const { eventId } = toolInput;

        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!response.ok && response.status !== 204) {
          throw new Error('Failed to delete event');
        }

        return { success: true, message: 'Event deleted' };
      }

      default:
        return { error: `Unknown Calendar tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`[Calendar] Error executing ${toolName}:`, error);
    return { error: error.message || String(error) };
  }
}
