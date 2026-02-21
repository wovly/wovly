/**
 * Calendar Service
 * Handles Google Calendar integration
 */

/**
 * Calendar event interface
 */
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
}

/**
 * Service response interface
 */
export interface CalendarResponse {
  ok: boolean;
  events?: CalendarEvent[];
  error?: string;
}

/**
 * CalendarService - Manages Google Calendar integration
 */
export class CalendarService {
  /**
   * Fetch calendar events for a specific date
   * @param getGoogleAccessToken - Function to get Google access token
   * @param username - Current username
   * @param date - Date string in YYYY-MM-DD format
   * @returns Calendar events for the specified date
   */
  static async getEvents(
    getGoogleAccessToken: (username: string | undefined) => Promise<string | null>,
    username: string | undefined,
    date: string
  ): Promise<CalendarResponse> {
    try {
      const accessToken = await getGoogleAccessToken(username);
      if (!accessToken) {
        return { ok: false, error: 'Google not authorized' };
      }

      // Parse date in local timezone (not UTC)
      // "2026-01-31" should be midnight Jan 31 LOCAL time
      const [year, month, day] = date.split('-').map(Number);
      const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

      const events = await this.fetchCalendarEvents(accessToken, startDate, endDate);
      return { ok: true, events };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Fetch calendar events from Google Calendar API
   * @param accessToken - Google access token
   * @param startDate - Start date/time
   * @param endDate - End date/time
   * @returns Array of calendar events
   */
  private static async fetchCalendarEvents(
    accessToken: string,
    startDate: Date,
    endDate: Date
  ): Promise<CalendarEvent[]> {
    const calendarUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    calendarUrl.searchParams.set('timeMin', startDate.toISOString());
    calendarUrl.searchParams.set('timeMax', endDate.toISOString());
    calendarUrl.searchParams.set('singleEvents', 'true');
    calendarUrl.searchParams.set('orderBy', 'startTime');

    console.log(`[Calendar] Fetching events from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const response = await fetch(calendarUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Calendar] API Error (${response.status}):`, errorText);

      // Check for specific errors
      if (response.status === 403) {
        throw new Error(
          'Calendar access denied. The Google Calendar API may not be enabled in your Google Cloud project, or you may need to reconnect Google to grant calendar permissions. Go to Integrations > Google and click \'Disconnect\' then reconnect.'
        );
      } else if (response.status === 401) {
        throw new Error('Calendar authentication expired. Please reconnect Google in Integrations.');
      }

      throw new Error(`Calendar API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const data: any = await response.json();
    console.log(`[Calendar] Found ${data.items?.length || 0} events`);

    return (data.items || []).map((event: any) => ({
      id: event.id,
      summary: event.summary || 'Untitled Event',
      description: event.description,
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      location: event.location,
      attendees: event.attendees?.map((a: any) => a.email) || []
    }));
  }
}
