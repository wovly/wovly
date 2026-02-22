/**
 * Unit tests for CalendarService
 */

import { describe, it, expect, vi } from 'vitest';

const { CalendarService } = require('../../../dist/services/calendar');

describe('CalendarService', () => {
  describe('getEvents', () => {
    it('should return error when not authorized', async () => {
      const mockGetToken = async () => null;

      const result = await CalendarService.getEvents(mockGetToken, 'test-user', '2026-02-18');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Google not authorized');
    });

    it('should fetch calendar events successfully', async () => {
      const mockGetToken = async () => 'fake-token';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'event1',
              summary: 'Test Meeting',
              start: { dateTime: '2026-02-18T10:00:00Z' },
              end: { dateTime: '2026-02-18T11:00:00Z' },
              location: 'Conference Room'
            }
          ]
        })
      } as any);

      const result = await CalendarService.getEvents(mockGetToken, 'test-user', '2026-02-18');

      expect(result.ok).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events![0].summary).toBe('Test Meeting');
      expect(result.events![0].location).toBe('Conference Room');
    });

    it('should handle calendar API errors', async () => {
      const mockGetToken = async () => 'fake-token';

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden'
      } as any);

      const result = await CalendarService.getEvents(mockGetToken, 'test-user', '2026-02-18');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Calendar access denied');
    });
  });
});
