import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { DeletionService } from '../tracking-deletion.service';
import { DeletionController } from '../deletion.controller';

describe('DeletionController (POST /tracking/admin/delete)', () => {
  const deleteByExternalId = jest.fn();
  const deleteByCustomerId = jest.fn();
  const service = {
    deleteByExternalId,
    deleteByCustomerId,
  } as unknown as DeletionService;
  const controller = new DeletionController(service);

  beforeEach(() => {
    jest.clearAllMocks();
    deleteByExternalId.mockResolvedValue({ contextsDeleted: 1, snapshotsAnonymized: 0 });
    deleteByCustomerId.mockResolvedValue({ contextsDeleted: 0, snapshotsAnonymized: 3 });
  });

  it('is gated with RequiresFeature(admin_tracking) at the class level', () => {
    const feature = Reflect.getMetadata(REQUIRES_FEATURE_KEY, DeletionController);
    expect(feature).toBe('admin_tracking');
  });

  it('POST delete carries Roles(admin) metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, DeletionController.prototype.delete);
    expect(roles).toEqual(['admin']);
  });

  it('delegates to deleteByExternalId when externalId is provided', async () => {
    const result = await controller.delete({ externalId: 'ext-abc' });

    expect(deleteByExternalId).toHaveBeenCalledWith('ext-abc');
    expect(deleteByCustomerId).not.toHaveBeenCalled();
    expect(result).toEqual({ contextsDeleted: 1, snapshotsAnonymized: 0 });
  });

  it('delegates to deleteByCustomerId when only customerId is provided', async () => {
    const result = await controller.delete({ customerId: 'cust-7' });

    expect(deleteByCustomerId).toHaveBeenCalledWith('cust-7');
    expect(deleteByExternalId).not.toHaveBeenCalled();
    expect(result).toEqual({ contextsDeleted: 0, snapshotsAnonymized: 3 });
  });

  it('throws BadRequestException when neither externalId nor customerId is provided', async () => {
    await expect(controller.delete({})).rejects.toThrow(BadRequestException);
    expect(deleteByExternalId).not.toHaveBeenCalled();
    expect(deleteByCustomerId).not.toHaveBeenCalled();
  });

  it('throws BadRequestException (400, not 500) when the body is null or absent', async () => {
    await expect(controller.delete(null as any)).rejects.toThrow(BadRequestException);
    await expect(controller.delete(undefined as any)).rejects.toThrow(BadRequestException);
    expect(deleteByExternalId).not.toHaveBeenCalled();
    expect(deleteByCustomerId).not.toHaveBeenCalled();
  });
});
