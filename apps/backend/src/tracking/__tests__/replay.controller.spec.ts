import { NotFoundException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ReplayController } from '../replay.controller';
import { ReplayService } from '../replay.service';

describe('ReplayController (admin replay + DEAD list)', () => {
  let replay: { replay: jest.Mock; listDead: jest.Mock; replayRecoverable: jest.Mock };
  let controller: ReplayController;

  beforeEach(() => {
    replay = {
      replay: jest.fn().mockResolvedValue(undefined),
      listDead: jest.fn().mockResolvedValue([]),
      replayRecoverable: jest.fn().mockResolvedValue({
        scanned: 0,
        excludedNoIdentity: 0,
        replayed: 0,
        skippedNotDead: 0,
      }),
    };
    controller = new ReplayController(replay as unknown as ReplayService);
  });

  it('is gated with RequiresFeature(admin_tracking) at the class level', () => {
    const feature = Reflect.getMetadata(REQUIRES_FEATURE_KEY, ReplayController);
    expect(feature).toBe('admin_tracking');
  });

  it('GET dead carries Roles(admin) metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ReplayController.prototype.listDead);
    expect(roles).toEqual(['admin']);
  });

  it('POST replay/:snapshotId carries Roles(admin) metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ReplayController.prototype.replay);
    expect(roles).toEqual(['admin']);
  });

  it('POST replay/bulk carries Roles(admin) metadata and delegates with a parsed limit', async () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ReplayController.prototype.replayBulk);
    expect(roles).toEqual(['admin']);
    replay.replayRecoverable.mockResolvedValue({ scanned: 3, excludedNoIdentity: 1, replayed: 2, skippedNotDead: 0 });

    await expect(controller.replayBulk('150')).resolves.toEqual({ scanned: 3, excludedNoIdentity: 1, replayed: 2, skippedNotDead: 0 });
    expect(replay.replayRecoverable).toHaveBeenCalledWith(150);
  });

  it('POST replay/bulk falls back to the default limit for a bad query value', async () => {
    const bad = ['abc', undefined] as const;
    for (const q of bad) {
      await controller.replayBulk(q);
      expect(replay.replayRecoverable).toHaveBeenLastCalledWith(200);
    }
  });

  it('GET /tracking/admin/dead returns the DEAD outbox rows from ReplayService', async () => {
    const rows = [
      {
        id: 'o-1',
        snapshotId: 's-1',
        eventId: 'purchase_1',
        eventType: 'Purchase',
        lastError: 'max attempts',
        createdAt: new Date(),
        attemptCount: 5,
      },
    ];
    replay.listDead.mockResolvedValue(rows);

    await expect(controller.listDead()).resolves.toEqual(rows);
    expect(replay.listDead).toHaveBeenCalledTimes(1);
  });

  it('POST /tracking/admin/replay/:snapshotId triggers replay(snapshotId) and returns { ok: true }', async () => {
    await expect(controller.replay('snap-1')).resolves.toEqual({ ok: true });
    expect(replay.replay).toHaveBeenCalledWith('snap-1');
  });

  it('propagates NotFoundException for an unknown snapshot', async () => {
    replay.replay.mockRejectedValue(new NotFoundException('no outbox for snapshot snap-x'));

    await expect(controller.replay('snap-x')).rejects.toThrow(NotFoundException);
  });
});
