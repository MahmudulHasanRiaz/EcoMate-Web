import { ForbiddenException } from '@nestjs/common';
import { LandingPagesController } from '../landing-pages.controller';

describe('LandingPagesController preview gate', () => {
  const SECRET = 'test-internal-secret';
  const OLD_ENV = process.env.INTERNAL_SHARED_SECRET;

  function makeController() {
    const svc = {
      findBySlug: jest.fn().mockResolvedValue({ slug: 'draft-sale', isDraft: true }),
      findPublishedBySlug: jest.fn(),
    };
    return { ctrl: new LandingPagesController(svc as any), svc };
  }

  /** A request as the storefront server makes it: secret header + private peer. */
  function internalReq() {
    return {
      headers: { 'x-internal-secret': SECRET },
      socket: { remoteAddress: '127.0.0.1' },
    };
  }

  /** A direct public request: no secret, public peer. */
  function publicReq() {
    return {
      headers: {},
      socket: { remoteAddress: '203.0.113.7' },
    };
  }

  beforeEach(() => {
    process.env.INTERNAL_SHARED_SECRET = SECRET;
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.INTERNAL_SHARED_SECRET;
    else process.env.INTERNAL_SHARED_SECRET = OLD_ENV;
  });

  it('allows the preview for an internal storefront-server request', async () => {
    const { ctrl, svc } = makeController();
    const page = await ctrl.findPreview('draft-sale', internalReq());
    expect(page).toEqual({ slug: 'draft-sale', isDraft: true });
    expect(svc.findBySlug).toHaveBeenCalledWith('draft-sale');
  });

  it('403s an unpublished/draft slug for a direct public request', async () => {
    const { ctrl, svc } = makeController();
    expect(() => ctrl.findPreview('draft-sale', publicReq())).toThrow(
      ForbiddenException,
    );
    // The service is never reached — the draft is not viewable at all.
    expect(svc.findBySlug).not.toHaveBeenCalled();
  });

  it('403s when the secret header is present but the peer is public (replay)', async () => {
    const { ctrl, svc } = makeController();
    const req = {
      headers: { 'x-internal-secret': SECRET },
      socket: { remoteAddress: '203.0.113.7' },
    };
    expect(() => ctrl.findPreview('draft-sale', req)).toThrow(
      ForbiddenException,
    );
    expect(svc.findBySlug).not.toHaveBeenCalled();
  });

  it('403s when the secret header is wrong even from a private peer', async () => {
    const { ctrl, svc } = makeController();
    const req = {
      headers: { 'x-internal-secret': 'wrong-secret' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(() => ctrl.findPreview('draft-sale', req)).toThrow(
      ForbiddenException,
    );
    expect(svc.findBySlug).not.toHaveBeenCalled();
  });

  it('403s when INTERNAL_SHARED_SECRET is unset (feature off)', async () => {
    delete process.env.INTERNAL_SHARED_SECRET;
    const { ctrl, svc } = makeController();
    expect(() => ctrl.findPreview('draft-sale', internalReq())).toThrow(
      ForbiddenException,
    );
    expect(svc.findBySlug).not.toHaveBeenCalled();
  });

  it('leaves the published endpoint untouched (still public, still served)', async () => {
    const { ctrl, svc } = makeController();
    svc.findPublishedBySlug.mockResolvedValue({ slug: 'live-sale', isDraft: false });
    const page = await ctrl.findPublished('live-sale');
    expect(page).toEqual({ slug: 'live-sale', isDraft: false });
    expect(svc.findPublishedBySlug).toHaveBeenCalledWith('live-sale');
  });
});
