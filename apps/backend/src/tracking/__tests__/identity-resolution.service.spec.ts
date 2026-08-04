import { IdentityResolutionService } from '../identity-resolution.service';
import { TrackingSettingsService } from '../tracking-settings.service';

describe('IdentityResolutionService (Wave-2.1 — customer external_id, Candidate B)', () => {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  const prisma = {
    customerProfile: { findUnique, findFirst, update },
  } as any;
  const settings = { isEnabledOrDefault: jest.fn() } as unknown as TrackingSettingsService;
  const service = new IdentityResolutionService(prisma, settings);

  beforeEach(() => {
    jest.clearAllMocks();
    (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(false);
  });

  describe('ensureForCustomer', () => {
    it('returns the existing external_id when already assigned', async () => {
      findUnique.mockResolvedValue({ externalId: 'ext-1' });
      await expect(service.ensureForCustomer('cust-1')).resolves.toBe('ext-1');
      expect(update).not.toHaveBeenCalled();
    });

    it('lazily assigns a uuid when none exists', async () => {
      findUnique.mockResolvedValue({ externalId: null });
      update.mockResolvedValue({ externalId: 'new-uuid' });
      await expect(service.ensureForCustomer('cust-1')).resolves.toBe('new-uuid');
      const data = update.mock.calls[0][0].data;
      expect(typeof data.externalId).toBe('string');
      expect(data.externalId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('returns null for an unknown customer', async () => {
      findUnique.mockResolvedValue(null);
      await expect(service.ensureForCustomer('ghost')).resolves.toBeNull();
    });

    it('absorbs a concurrent P2002 by re-reading the winner', async () => {
      findUnique
        .mockResolvedValueOnce({ externalId: null }) // initial
        .mockResolvedValueOnce({ externalId: 'winner' }); // re-read after P2002
      update.mockRejectedValue({ code: 'P2002' });
      await expect(service.ensureForCustomer('cust-1')).resolves.toBe('winner');
    });
  });

  describe('resolveForOrder (identity-binding at dispatch)', () => {
    it('returns the journey uuid when the flag is off (no customer lookup)', async () => {
      await expect(service.resolveForOrder('cust-1', 'journey')).resolves.toBe('journey');
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('returns the customer external_id when the flag is on and a customer is bound', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findUnique.mockResolvedValue({ externalId: 'cust-ext' });
      await expect(service.resolveForOrder('cust-1', 'journey')).resolves.toBe('cust-ext');
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        select: { externalId: true },
      });
    });

    it('falls back to the journey uuid when the flag is on but there is no customerId', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      await expect(service.resolveForOrder(undefined, 'journey')).resolves.toBe('journey');
    });

    it('never resolves to a customer external_id while the flag is off (guest unchanged)', async () => {
      await expect(service.resolveForOrder('cust-1', 'journey')).resolves.toBe('journey');
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveForShopper (Pixel external_id)', () => {
    it('returns null when the flag is off', async () => {
      await expect(service.resolveForShopper('ba-1')).resolves.toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('returns null when the shopper has no linked CustomerProfile', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findFirst.mockResolvedValue(null);
      await expect(service.resolveForShopper('ba-1')).resolves.toBeNull();
    });

    it('returns the customer external_id for a linked shopper', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findFirst.mockResolvedValue({ id: 'cust-9' });
      findUnique.mockResolvedValue({ externalId: 'cust-ext' });
      await expect(service.resolveForShopper('ba-1')).resolves.toBe('cust-ext');
      expect(findFirst).toHaveBeenCalledWith({
        where: { betterAuthUserId: 'ba-1' },
        select: { id: true },
      });
    });
  });

  describe('resolveAdvancedMatching (Wave-2.3 — hashed em/ph for the Pixel)', () => {
    it('returns {} when advanced matching is off (no lookup, no hashes)', async () => {
      await expect(service.resolveAdvancedMatching('ba-1')).resolves.toEqual({});
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('returns {} when the shopper has no linked CustomerProfile', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findFirst.mockResolvedValue(null);
      await expect(service.resolveAdvancedMatching('ba-1')).resolves.toEqual({});
    });

    it('returns SHA-256 hashed em/ph for a linked profile (email + phone)', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findFirst.mockResolvedValue({ email: ' Buyer@Example.com ', phone: '01712345678' });
      const result = await service.resolveAdvancedMatching('ba-1');
      expect(result.em).toBeDefined();
      expect(result.ph).toBeDefined();
      expect(result.em).toBe((result.em as string).toLowerCase());
      // Phone hashed to E.164 (BD local → 880…) and SHA-256, matching the
      // server/browser normalizer rules — never a bare local number.
      expect(result.ph).not.toBe('01712345678');
      expect(findFirst).toHaveBeenCalledWith({
        where: { betterAuthUserId: 'ba-1' },
        select: { email: true, phone: true },
      });
    });

    it('omits em when the profile has no email but keeps ph', async () => {
      (settings.isEnabledOrDefault as jest.Mock).mockResolvedValue(true);
      findFirst.mockResolvedValue({ email: null, phone: '01712345678' });
      const result = await service.resolveAdvancedMatching('ba-1');
      expect(result.em).toBeUndefined();
      expect(result.ph).toBeDefined();
    });
  });
});