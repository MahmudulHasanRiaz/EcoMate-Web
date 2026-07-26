import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ImagesController } from './images.controller';
import { ExternalImageFetchError, ImagesService } from './images.service';

describe('ImagesController response caching', () => {
  function createReply() {
    const headers = new Map<string, string>();
    let statusCode: number | undefined;
    let body: unknown;
    const reply = {
      header: jest.fn((name: string, value: string) => {
        headers.set(name, value);
        return reply;
      }),
      status: jest.fn((code: number) => {
        statusCode = code;
        return reply;
      }),
      send: jest.fn((value?: unknown) => {
        body = value;
        return reply;
      }),
    };

    return {
      reply: reply as unknown as FastifyReply,
      headers,
      getStatus: () => statusCode,
      getBody: () => body,
    };
  }

  function createController(resize: jest.Mock): ImagesController {
    return new ImagesController({ resize } as unknown as ImagesService);
  }

  it('uses a short revalidating cache policy and returns an ETag', async () => {
    const buffer = Buffer.from('real-image-bytes');
    const controller = createController(
      jest.fn().mockResolvedValue({
        buffer,
        ext: '.webp',
        mime: 'image/webp',
      }),
    );
    const response = createReply();

    await controller.resize(
      response.reply,
      '/uploads/products/photo.png',
      '320',
      undefined,
      undefined,
      undefined,
      'media-v2',
      undefined,
    );

    expect(response.getStatus()).toBe(200);
    expect(response.getBody()).toBe(buffer);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, must-revalidate',
    );
    expect(response.headers.get('Cache-Control')).not.toContain('immutable');
    expect(response.headers.get('ETag')).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });

  it('honors If-None-Match without sending the image body', async () => {
    const buffer = Buffer.from('conditional-image');
    const resize = jest.fn().mockResolvedValue({
      buffer,
      ext: '.webp',
      mime: 'image/webp',
    });
    const controller = createController(resize);
    const firstResponse = createReply();
    await controller.resize(firstResponse.reply, '/uploads/products/photo.png');
    const etag = firstResponse.headers.get('ETag');
    const response = createReply();

    await controller.resize(
      response.reply,
      '/uploads/products/photo.png',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      etag,
    );

    expect(response.getStatus()).toBe(304);
    expect(response.getBody()).toBeUndefined();
    expect(response.headers.get('ETag')).toBe(etag);
    expect(response.headers.has('Content-Length')).toBe(false);
  });

  it('returns 502 with no-store when the remote source cannot be fetched', async () => {
    const controller = createController(
      jest
        .fn()
        .mockRejectedValue(
          new ExternalImageFetchError(new Error('origin unavailable')),
        ),
    );
    const response = createReply();

    await expect(
      controller.resize(response.reply, 'https://cdn.example.com/product.png'),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects unbounded cache-version values', async () => {
    const controller = createController(jest.fn());
    const response = createReply();

    await expect(
      controller.resize(
        response.reply,
        '/uploads/products/photo.png',
        undefined,
        undefined,
        undefined,
        undefined,
        'x'.repeat(201),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
