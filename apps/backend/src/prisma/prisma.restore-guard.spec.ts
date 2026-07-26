import { PrismaService } from './prisma.service';

describe('PrismaService restore write guard', () => {
  function makeService(query: jest.Mock) {
    const release = jest.fn();
    const service = Object.create(PrismaService.prototype) as PrismaService;
    Object.assign(service as any, {
      nativePool: {
        connect: jest.fn().mockResolvedValue({ query, release }),
      },
      logger: { warn: jest.fn() },
      lastRestoreGuardWarningAt: 0,
    });
    return { service, release };
  }

  it('blocks on the restore worker session even without reading the control row', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ restore_session: true, control_table: null }],
    });
    const { service, release } = makeService(query);

    await expect(service.isRestoreWriteBlocked()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('blocks when a durable control operation is active', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            restore_session: false,
            control_table: 'ecomate_control.backup_restore_operation',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ active: true }] });
    const { service } = makeService(query);

    await expect(service.isRestoreWriteBlocked()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('allows writes when neither restore signal exists', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ restore_session: false, control_table: null }],
    });
    const { service } = makeService(query);

    await expect(service.isRestoreWriteBlocked()).resolves.toBe(false);
  });

  it('fails closed by default when the guard cannot be inspected', async () => {
    const query = jest.fn().mockRejectedValue(new Error('permission denied'));
    const { service, release } = makeService(query);

    await expect(service.isRestoreWriteBlocked()).resolves.toBe(true);
    await expect(
      service.isRestoreWriteBlocked({ failClosed: false }),
    ).resolves.toBe(false);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
