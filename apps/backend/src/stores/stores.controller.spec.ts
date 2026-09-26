import { resolveWebhookCallbackBase } from './stores.controller';

describe('resolveWebhookCallbackBase', () => {
  it('accepts an https URL and strips trailing slashes', () => {
    expect(
      resolveWebhookCallbackBase({
        PUBLIC_API_BASE_URL: 'https://api.example.test///',
      }),
    ).toBe('https://api.example.test');
  });

  it('rejects missing/http/relative bases with 400', () => {
    for (const env of [{}, { PUBLIC_API_BASE_URL: '' }, { PUBLIC_API_BASE_URL: 'http://x.test' }, { PUBLIC_API_BASE_URL: '/api' }]) {
      const err = (() => {
        try {
          resolveWebhookCallbackBase(env);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err?.constructor?.name).toBe('BadRequestException');
    }
  });
});
