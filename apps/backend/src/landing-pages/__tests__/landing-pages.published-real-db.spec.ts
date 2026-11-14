import { NotFoundException } from '@nestjs/common';
import { LandingPagesService } from '../landing-pages.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * REAL-DB PROOF for `findPublishedBySlug` filter semantics (audit §2).
 *
 * The service uses `findUnique({ where: { slug, isActive: true,
 * isDraft: false } })` — valid under Prisma 7.10.0 because the generated
 * `LandingPageWhereUniqueInput` accepts scalar filters alongside the
 * unique slug, but no test covered it. This spec proves it empirically
 * against a real Postgres 16 scratch database:
 *
 *   LANDING_PAGES_PROOF_DATABASE_URL='postgresql://<user>:<pass>@localhost:5432/<db>' \
 *     npx jest src/landing-pages/__tests__/landing-pages.published-real-db.spec.ts
 *
 * The scratch DB must have the real migrations applied first, e.g.:
 *
 *   createdb landing_proof
 *   DATABASE_URL='postgresql://postgres:proof@localhost:5432/landing_proof' \
 *     npx prisma migrate deploy
 *
 * Without the env var the suite SKIPS (so the default `npx jest` run
 * stays green on machines with no scratch DB).
 */

const PROOF_URL = process.env.LANDING_PAGES_PROOF_DATABASE_URL;
const describeRealDb = PROOF_URL ? describe : describe.skip;

describeRealDb('findPublishedBySlug — real Postgres 16', () => {
  let prisma: PrismaService;
  let svc: LandingPagesService;
  const run = `proof-${Date.now()}`;
  const slugs = {
    published: `${run}-published`,
    draft: `${run}-draft`,
    inactive: `${run}-inactive`,
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = PROOF_URL!;
    prisma = new PrismaService();
    svc = new LandingPagesService(prisma);
    await prisma.landingPage.create({
      data: {
        title: 'Published',
        slug: slugs.published,
        pageType: 'custom',
        isActive: true,
        isDraft: false,
        publishedAt: new Date(),
      },
    });
    await prisma.landingPage.create({
      data: {
        title: 'Draft',
        slug: slugs.draft,
        pageType: 'custom',
        isActive: false,
        isDraft: true,
      },
    });
    await prisma.landingPage.create({
      data: {
        title: 'Unpublished',
        slug: slugs.inactive,
        pageType: 'custom',
        isActive: false,
        isDraft: false,
        publishedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.landingPage.deleteMany({
      where: { slug: { in: Object.values(slugs) } },
    });
    await prisma.$disconnect();
    // PrismaService also owns a raw pg pool (nativePool) that $disconnect
    // does not close — end it so the jest worker can exit.
    await (prisma as any).nativePool?.end();
  });

  it('finds a published page (isActive=true, isDraft=false)', async () => {
    const page = await svc.findPublishedBySlug(slugs.published);
    expect(page.slug).toBe(slugs.published);
    expect(page.isActive).toBe(true);
    expect(page.isDraft).toBe(false);
  });

  it('does NOT find a draft page', async () => {
    await expect(svc.findPublishedBySlug(slugs.draft)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('does NOT find an inactive (unpublished) page', async () => {
    await expect(svc.findPublishedBySlug(slugs.inactive)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('the misses are the filter, not missing rows — all three rows exist in the table', async () => {
    const rows = await prisma.landingPage.findMany({
      where: { slug: { in: Object.values(slugs) } },
      select: { slug: true, isActive: true, isDraft: true },
    });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.slug === slugs.draft)).toEqual(
      expect.objectContaining({ isActive: false, isDraft: true }),
    );
    expect(rows.find((r) => r.slug === slugs.inactive)).toEqual(
      expect.objectContaining({ isActive: false, isDraft: false }),
    );
  });
});
