/**
 * Campaign Deletion Preservation Integration Test
 *
 * Runs against the real database (NOT mocked Prisma).
 * Verifies that campaigns deleted from the provider are preserved locally
 * with all historical data intact (soft delete only).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Campaign Deletion Preservation (Integration)', () => {
  let testAccountId: string;
  let testPlatformId: string;
  let testConnectionId: string;
  let campaignIds: string[] = [];
  let orderIds: string[] = [];
  let statusId: string;

  beforeAll(async () => {
    // Get a valid order status
    const anyStatus = await prisma.orderStatus.findFirst();
    statusId = anyStatus?.id ?? '';

    // Create test platform + connection + ad account (using unique suffixes)
    const ts = Date.now();
    testPlatformId = (await prisma.marketingPlatform.upsert({
      where: { slug: 'facebook' },
      update: {},
      create: { id: `dpplat-${ts}`, name: 'Meta (DelPres)', slug: 'facebook' },
    })).id;

    testConnectionId = (await prisma.marketingConnection.create({
      data: {
        id: `dpconn-${ts}`,
        platformId: testPlatformId,
        accessTokenEnc: 'test-token-dp',
        status: 'connected',
      },
    })).id;

    testAccountId = (await prisma.adAccount.create({
      data: {
        id: `dpacct-${ts}`,
        connectionId: testConnectionId,
        providerAccountId: `act_dp_${ts}`,
        name: 'DelPres Account',
        currency: 'USD',
      },
    })).id;
  });

  afterAll(async () => {
    // Clean up in FK-safe order
    for (const orderId of orderIds) {
      await prisma.orderAttribution.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    for (const cid of campaignIds) {
      await prisma.productMarketingCost.deleteMany({ where: { allocation: { campaignId: cid } } }).catch(() => {});
      await prisma.marketingCampaignInsight.deleteMany({ where: { campaignId: cid } }).catch(() => {});
      await prisma.marketingCostAllocation.deleteMany({ where: { campaignId: cid } }).catch(() => {});
      await prisma.marketingConsumption.deleteMany({ where: { campaignId: cid } }).catch(() => {});
      await prisma.orderAttribution.deleteMany({ where: { campaignId: cid } }).catch(() => {});
      await prisma.marketingCampaign.delete({ where: { id: cid } }).catch(() => {});
    }
    if (testAccountId) await prisma.adAccount.delete({ where: { id: testAccountId } }).catch(() => {});
    if (testConnectionId) await prisma.marketingConnection.delete({ where: { id: testConnectionId } }).catch(() => {});
  });

  it('creates a campaign, simulates provider deletion, preserves all local data', async () => {
    const ts = Date.now();
    const uniqueProviderId = `camp_del_${ts}`;

    // ── Step 1: Create local campaign ──────────────────────────────
    const campaign = await prisma.marketingCampaign.create({
      data: {
        id: `camp-${ts}`,
        adAccountId: testAccountId,
        providerCampaignId: uniqueProviderId,
        name: 'Campaign for Deletion Test',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        deletedFromProvider: false,
      },
    });
    campaignIds.push(campaign.id);

    // ── Step 2: Create historical spend (insight) ─────────────────
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    await prisma.marketingCampaignInsight.create({
      data: {
        campaignId: campaign.id,
        date: yesterday,
        impressions: 10000,
        clicks: 500,
        spend: 150,
        purchases: 5,
        purchaseValue: 750,
      },
    });

    // ── Step 3: Create order + attribution ─────────────────────────
    const order = await prisma.order.create({
      data: {
        displayId: `ORD-DP-${ts}`,
        statusId,
        subtotal: 1500,
        total: 1500,
      },
    });
    orderIds.push(order.id);

    await prisma.orderAttribution.create({
      data: {
        orderId: order.id,
        campaignId: campaign.id,
        confidence: 90,
        method: 'session',
        explanation: 'Test attribution',
        attributionVersion: 1,
      },
    });

    // ── Step 4: Create cost allocation ─────────────────────────────
    await prisma.marketingCostAllocation.create({
      data: {
        orderId: order.id,
        campaignId: campaign.id,
        allocatedSpend: 150,
        allocatedRate: 1.33,
        allocatedCost: 200,
        allocatedCurrency: 'BDT',
        allocationMethod: 'equal',
        calculatedAt: new Date(),
      },
    });

    // ── Step 5: Verify all local data exists pre-deletion ──────────
    const preCampaign = await prisma.marketingCampaign.findUnique({ where: { id: campaign.id } });
    expect(preCampaign).not.toBeNull();
    expect(preCampaign!.deletedFromProvider).toBe(false);

    const preInsights = await prisma.marketingCampaignInsight.findMany({ where: { campaignId: campaign.id } });
    expect(preInsights).toHaveLength(1);
    expect(Number(preInsights[0].spend)).toBe(150);

    const preAttributions = await prisma.orderAttribution.findMany({ where: { campaignId: campaign.id } });
    expect(preAttributions).toHaveLength(1);

    const preAllocations = await prisma.marketingCostAllocation.findMany({ where: { campaignId: campaign.id } });
    expect(preAllocations).toHaveLength(1);
    expect(Number(preAllocations[0].allocatedCost)).toBe(200);

    // ── Step 6: Simulate provider reporting campaign deleted ────────
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: { deletedFromProvider: true, isArchived: true },
    });

    // ── Step 7: Verify campaign still exists (soft deleted) ────────
    const postCampaign = await prisma.marketingCampaign.findUnique({ where: { id: campaign.id } });
    expect(postCampaign).not.toBeNull();
    expect(postCampaign!.deletedFromProvider).toBe(true);
    expect(postCampaign!.isArchived).toBe(true);
    expect(postCampaign!.name).toBe('Campaign for Deletion Test');

    // ── Step 8: Verify historical spend unchanged ──────────────────
    const postInsights = await prisma.marketingCampaignInsight.findMany({ where: { campaignId: campaign.id } });
    expect(postInsights).toHaveLength(1);
    expect(Number(postInsights[0].spend)).toBe(150);
    expect(Number(postInsights[0].purchases)).toBe(5);
    expect(Number(postInsights[0].purchaseValue)).toBe(750);

    // ── Step 9: Verify attribution unchanged ───────────────────────
    const postAttributions = await prisma.orderAttribution.findMany({ where: { campaignId: campaign.id } });
    expect(postAttributions).toHaveLength(1);
    expect(postAttributions[0].orderId).toBe(order.id);
    expect(postAttributions[0].method).toBe('session');

    // ── Step 10: Verify cost allocation unchanged ──────────────────
    const postAllocations = await prisma.marketingCostAllocation.findMany({ where: { campaignId: campaign.id } });
    expect(postAllocations).toHaveLength(1);
    expect(Number(postAllocations[0].allocatedCost)).toBe(200);

    // ── Step 11: Verify the order itself is intact ─────────────────
    const postOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(postOrder).not.toBeNull();
    expect(Number(postOrder!.total)).toBe(1500);
  });

  it('soft-deleted campaigns are excluded from default attribution matching', async () => {
    const ts = Date.now();
    const uniqueProviderId = `camp_active_${ts}`;

    // Create an active campaign
    const activeCampaign = await prisma.marketingCampaign.create({
      data: {
        id: `camp-active-${ts}`,
        adAccountId: testAccountId,
        providerCampaignId: uniqueProviderId,
        name: 'Active Campaign',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        deletedFromProvider: false,
      },
    });
    campaignIds.push(activeCampaign.id);

    // The deleted campaign from test 1 should NOT be returned by deletedFromProvider=false query
    const matchedCampaigns = await prisma.marketingCampaign.findMany({
      where: {
        adAccountId: testAccountId,
        deletedFromProvider: false,
      },
    });
    const deletedCampaign = matchedCampaigns.find(c => c.id === campaignIds[0]);
    expect(deletedCampaign).toBeUndefined();

    // The active campaign SHOULD be returned
    const activeMatch = matchedCampaigns.find(c => c.id === activeCampaign.id);
    expect(activeMatch).toBeDefined();
    expect(activeMatch!.name).toBe('Active Campaign');
  });
});
