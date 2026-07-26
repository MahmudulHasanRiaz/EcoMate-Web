import { Readable, Writable } from 'stream';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Upload } from '@aws-sdk/lib-storage';
import { StorageService } from './storage.service';

const mockUploadDone = jest.fn();
const mockUploadAbort = jest.fn();

jest.mock('uuid', () => ({ v4: () => 'temp-id' }));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: mockUploadDone,
    abort: mockUploadAbort,
  })),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    createWriteStream: jest.fn(),
  };
});

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    writeFile: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
  };
});

jest.mock('stream/promises', () => ({
  pipeline: jest.fn(),
}));

describe('StorageService streaming writes', () => {
  const mockedExistsSync = jest.mocked(existsSync);
  const mockedCreateWriteStream = jest.mocked(createWriteStream);
  const mockedWriteFile = jest.mocked(writeFile);
  const mockedRename = jest.mocked(rename);
  const mockedUnlink = jest.mocked(unlink);
  const mockedMkdir = jest.mocked(mkdir);
  const mockedPipeline = jest.mocked(pipeline);
  const mockedUpload = jest.mocked(Upload);

  const localService = () =>
    new StorageService({
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any);

  const r2Service = () =>
    new StorageService({
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'storage_provider', value: 'r2' },
          { key: 'storage_r2_endpoint', value: 'https://r2.example.test' },
          { key: 'storage_r2_access_key', value: 'access' },
          { key: 'storage_r2_secret_key', value: 'secret' },
          { key: 'storage_r2_bucket', value: 'bucket' },
          { key: 'storage_r2_public_url', value: 'https://cdn.example.test' },
        ]),
      },
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BACKUP_STORAGE_DIR;
    delete process.env.BACKUP_R2_ENDPOINT;
    delete process.env.BACKUP_R2_ACCESS_KEY;
    delete process.env.BACKUP_R2_SECRET_KEY;
    delete process.env.BACKUP_R2_BUCKET;
    mockedExistsSync.mockReturnValue(true);
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedRename.mockResolvedValue(undefined);
    mockedUnlink.mockResolvedValue(undefined);
    mockedPipeline.mockResolvedValue(undefined);
    mockedCreateWriteStream.mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }) as any,
    );
    mockUploadDone.mockResolvedValue({});
    mockUploadAbort.mockResolvedValue(undefined);
  });

  it('stores new local backups outside the public uploads tree', async () => {
    const service = localService();
    const key = service.createBackupKey('job', 'archive.tar.gz');
    const source = Readable.from(Buffer.from('private-backup'));

    expect(key).toBe('private-local/job/archive.tar.gz');
    await service.storeBackupStream(key, source, 'application/gzip');

    expect(mockedCreateWriteStream).toHaveBeenCalledWith(
      `${process.cwd()}/backup-storage/private-local/job/.archive.tar.gz.temp-id.tmp`,
      { flags: 'wx' },
    );
    expect(mockedRename).toHaveBeenCalledWith(
      `${process.cwd()}/backup-storage/private-local/job/.archive.tar.gz.temp-id.tmp`,
      `${process.cwd()}/backup-storage/private-local/job/archive.tar.gz`,
    );
  });

  it('uses a dedicated non-public R2 bucket for private backups', async () => {
    process.env.BACKUP_R2_ENDPOINT = 'https://private-r2.example.test';
    process.env.BACKUP_R2_ACCESS_KEY = 'backup-access';
    process.env.BACKUP_R2_SECRET_KEY = 'backup-secret';
    process.env.BACKUP_R2_BUCKET = 'private-backups';
    const service = localService();
    const key = service.createBackupKey('job', 'archive.tar.gz');

    expect(key).toBe('private-r2/job/archive.tar.gz');
    await service.storeBackupStream(
      key,
      Readable.from(Buffer.from('private-r2-backup')),
      'application/gzip',
    );

    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'private-backups',
          Key: key,
        }),
      }),
    );
  });

  it('publishes local buffers only after the temp write completes', async () => {
    const service = localService();
    const body = Buffer.from('backup-data');

    await expect(
      service.store('backups/job/archive.tar.gz', body, 'application/gzip'),
    ).resolves.toBe('/uploads/backups/job/archive.tar.gz');

    const finalPath = `${process.cwd()}/uploads/backups/job/archive.tar.gz`;
    const tmpPath = `${process.cwd()}/uploads/backups/job/.archive.tar.gz.temp-id.tmp`;
    expect(mockedWriteFile).toHaveBeenCalledWith(tmpPath, body, { flag: 'wx' });
    expect(mockedRename).toHaveBeenCalledWith(tmpPath, finalPath);
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('removes a partial local buffer temp file when writing fails', async () => {
    const service = localService();
    mockedWriteFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      service.store(
        'backups/job/archive.tar.gz',
        Buffer.from('data'),
        'application/gzip',
      ),
    ).rejects.toThrow('disk full');

    const tmpPath = `${process.cwd()}/uploads/backups/job/.archive.tar.gz.temp-id.tmp`;
    expect(mockedUnlink).toHaveBeenCalledWith(tmpPath);
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('atomically publishes local streams and cleans a failed stream temp file', async () => {
    const service = localService();
    const source = Readable.from(Buffer.from('streamed-backup'));

    await service.storeStream(
      'backups/job/archive.tar.gz',
      source,
      'application/gzip',
    );

    const finalPath = `${process.cwd()}/uploads/backups/job/archive.tar.gz`;
    const tmpPath = `${process.cwd()}/uploads/backups/job/.archive.tar.gz.temp-id.tmp`;
    expect(mockedCreateWriteStream).toHaveBeenCalledWith(tmpPath, {
      flags: 'wx',
    });
    expect(mockedPipeline).toHaveBeenCalledWith(source, expect.any(Writable));
    expect(mockedRename).toHaveBeenCalledWith(tmpPath, finalPath);

    mockedPipeline.mockRejectedValueOnce(new Error('stream failed'));
    await expect(
      service.storeStream(
        'backups/job/second.tar.gz',
        Readable.from(Buffer.from('broken')),
        'application/gzip',
      ),
    ).rejects.toThrow('stream failed');
    expect(mockedUnlink).toHaveBeenCalledWith(
      `${process.cwd()}/uploads/backups/job/.second.tar.gz.temp-id.tmp`,
    );
  });

  it('uses managed multipart upload for R2 streams and aborts on failure', async () => {
    const service = r2Service();
    const source = Readable.from(Buffer.from('r2-stream'));

    await expect(
      service.storeStream(
        'backups/job/archive.tar.gz',
        source,
        'application/gzip',
      ),
    ).resolves.toBe('https://cdn.example.test/backups/job/archive.tar.gz');

    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.anything(),
        params: {
          Bucket: 'bucket',
          Key: 'backups/job/archive.tar.gz',
          Body: source,
          ContentType: 'application/gzip',
        },
        partSize: 16 * 1024 * 1024,
        queueSize: 4,
        leavePartsOnError: false,
      }),
    );
    expect(mockUploadAbort).not.toHaveBeenCalled();

    mockUploadDone.mockRejectedValueOnce(new Error('R2 failed'));
    await expect(
      service.storeStream(
        'backups/job/failed.tar.gz',
        Readable.from(Buffer.from('broken')),
        'application/gzip',
      ),
    ).rejects.toThrow('R2 failed');
    expect(mockUploadAbort).toHaveBeenCalledTimes(1);
  });
});
