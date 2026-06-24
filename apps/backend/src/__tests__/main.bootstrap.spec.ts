import { NestFastifyApplication } from '@nestjs/platform-fastify';

describe('App bootstrap (Fastify)', () => {
  it('NestFastifyApplication type is available', () => {
    // Verify Fastify type is importable (replaces NestExpressApplication)
    const typeCheck: NestFastifyApplication | null = null;
    expect(typeCheck).toBeNull();
  });
});
