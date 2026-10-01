import {
  acceptanceFor,
  acceptanceColumnLabel,
  type AcceptanceState,
} from '../provider-acceptance';

const ev = (o: Partial<Parameters<typeof acceptanceFor>[1]>) => ({
  status: 'SENT',
  attemptCount: 1,
  httpStatus: 200,
  responseBody: null,
  errorMsg: null,
  ...o,
});

describe('provider acceptance', () => {
  describe('no-send states', () => {
    it('is unknown when no attempt was ever made', () => {
      expect(acceptanceFor('meta', ev({ attemptCount: 0, status: 'SKIPPED' }))).toBe('unknown');
    });

    it('is unknown for a deduped row', () => {
      expect(acceptanceFor('meta', ev({ status: 'DEDUPED', attemptCount: 0 }))).toBe('unknown');
    });
  });

  describe('terminal failures', () => {
    it('is rejected for a FAILED row regardless of body', () => {
      expect(acceptanceFor('meta', ev({ status: 'FAILED', httpStatus: 500 }))).toBe('rejected');
    });

    it('is rejected for a DEAD row', () => {
      expect(acceptanceFor('meta', ev({ status: 'DEAD' }))).toBe('rejected');
    });
  });

  describe('Meta', () => {
    it('is accepted on a clean 200 with no per-event errors', () => {
      const body = JSON.stringify({ events: [{ event_id: 'e1', event_time: 1 }] });
      expect(acceptanceFor('meta', ev({ responseBody: body }))).toBe('accepted');
    });

    it('is REJECTED when Meta reports a per-event error inside a 200', () => {
      // The real-world case: HTTP 200 but the event itself was refused.
      const body = JSON.stringify({
        events: [
          {
            event_id: 'e1',
            errors: [{ code: 2804050, message: 'no matching user_data' }],
          },
        ],
      });
      expect(acceptanceFor('meta', ev({ responseBody: body }))).toBe('rejected');
    });

    it('is http_accepted when the 200 body cannot be parsed', () => {
      expect(acceptanceFor('meta', ev({ responseBody: '<html>truncated' }))).toBe('http_accepted');
    });

    it('is http_accepted when the events array is absent', () => {
      expect(acceptanceFor('meta', ev({ responseBody: '{"ok":true}' }))).toBe('http_accepted');
    });
  });

  describe('TikTok', () => {
    it('is accepted on business code 0', () => {
      expect(
        acceptanceFor('tiktok', ev({ responseBody: JSON.stringify({ code: 0, message: 'OK' }) })),
      ).toBe('accepted');
    });

    it('is rejected on a non-zero business code', () => {
      expect(
        acceptanceFor('tiktok', ev({ responseBody: JSON.stringify({ code: 40001 }) })),
      ).toBe('rejected');
    });

    it('is http_accepted when the body carries no business code', () => {
      expect(acceptanceFor('tiktok', ev({ responseBody: '{}' }))).toBe('http_accepted');
    });
  });

  describe('providers with transport-level evidence only', () => {
    it('ga4 is http_accepted, never accepted', () => {
      expect(acceptanceFor('ga4', ev({ responseBody: '{}' }))).toBe('http_accepted');
    });

    it('google-ads is http_accepted, never accepted', () => {
      expect(acceptanceFor('google-ads', ev({ responseBody: '{}' }))).toBe('http_accepted');
    });
  });

  describe('retry independence', () => {
    it('the same row reports one verdict regardless of attempt count', () => {
      // 3 attempts ending in a clean accept is ONE accepted dispatch row, not three.
      const body = JSON.stringify({ events: [{ event_id: 'e1' }] });
      expect(acceptanceFor('meta', ev({ responseBody: body, attemptCount: 3 }))).toBe('accepted');
    });
  });

  describe('acceptanceColumnLabel', () => {
    it('claims "Provider accepted" when every row has a real verdict', () => {
      const states: AcceptanceState[] = ['accepted', 'rejected', 'unknown'];
      expect(acceptanceColumnLabel(states)).toBe('Provider accepted');
    });

    it('downgrades to "HTTP accepted" when any row is only transport-level', () => {
      expect(acceptanceColumnLabel(['accepted', 'http_accepted'])).toBe('HTTP accepted');
    });

    it('never says "Delivered" for any input', () => {
      const all: AcceptanceState[] = ['accepted', 'rejected', 'unknown', 'http_accepted'];
      expect(acceptanceColumnLabel(all)).not.toContain('Delivered');
      expect(acceptanceColumnLabel([])).not.toContain('Delivered');
    });
  });
});
