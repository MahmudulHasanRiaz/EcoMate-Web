import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { create } from 'tar';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_FILENAME,
  BACKUP_SQL_FILENAME,
  finalizeInterruptedContentRestore,
  listInterruptedContentRestoreIds,
  normalizeBackupIncludePaths,
  prepareBackupContentRestore,
  promoteBackupContent,
  rollbackInterruptedContentRestore,
  resolveBackupContent,
  validateTarBackup,
  type BackupManifest,
} from './backup-archive';

const validationLimits = {
  maxEntries: 100,
  maxExpandedBytes: 10n * 1024n * 1024n,
  maxDecompressionRatio: 10_000,
};

const manifest: BackupManifest = {
  format: BACKUP_FORMAT,
  version: BACKUP_FORMAT_VERSION,
  createdAt: '2026-07-26T00:00:00.000Z',
  scope: 'db_files',
  storageProvider: 'local',
  contentLayout: 'uploads',
  localFilesIncluded: true,
  includePaths: [''],
  excludedPaths: ['backups'],
};

describe('backup archive helpers', () => {
  const tempRoots: string[] = [];

  const makeTempRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecomate-backup-archive-'));
    tempRoots.push(root);
    return root;
  };

  const writeFixture = async (
    root: string,
    relativePath: string,
    contents: string | Buffer,
  ) => {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
    return target;
  };

  const createArchive = async (
    sourceRoot: string,
    entries: string[],
    prefix?: string,
  ) => {
    const archivePath = join(sourceRoot, 'fixture.tar.gz');
    await create(
      {
        cwd: sourceRoot,
        file: archivePath,
        gzip: true,
        portable: true,
        ...(prefix === undefined ? {} : { prefix }),
      },
      entries,
    );
    return archivePath;
  };

  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  describe('normalizeBackupIncludePaths', () => {
    it('treats uploads, dot, and an empty path as the whole uploads root', () => {
      expect(
        normalizeBackupIncludePaths([
          ' products ',
          './uploads/',
          'products/images',
          '.',
          '',
        ]),
      ).toEqual(['']);
    });

    it('does not silently turn an empty full-backup selection into db-only', () => {
      expect(normalizeBackupIncludePaths([])).toEqual(['']);
      expect(normalizeBackupIncludePaths(['uploads/backups'])).toEqual(['']);
    });

    it('normalizes, de-duplicates, and removes paths covered by a parent', () => {
      expect(
        normalizeBackupIncludePaths([
          './products/',
          'uploads/products/images',
          'uploads/banners',
          'products',
          'banners/home',
        ]),
      ).toEqual(['products', 'banners']);
    });

    it.each([
      ['not an array'],
      [[42]],
      [['../secrets']],
      [['uploads/../secrets']],
      [['/absolute/path']],
      [['products//originals']],
    ])('rejects malformed or escaping input %#', (input) => {
      expect(() => normalizeBackupIncludePaths(input)).toThrow();
    });

    it('excludes recursive backup paths selected directly or below uploads', () => {
      expect(
        normalizeBackupIncludePaths([
          'backups',
          'backups/daily',
          'uploads/backups/archive.tar.gz',
          'uploads/products',
        ]),
      ).toEqual(['products']);
    });
  });

  describe('resolveBackupContent', () => {
    it('measures original upload content while excluding recursive backups', async () => {
      const uploadRoot = await makeTempRoot();
      const original = Buffer.from('original-image-bytes');
      await writeFixture(uploadRoot, 'products/original.jpg', original);
      await writeFixture(
        uploadRoot,
        'backups/previous/full-backup.tar.gz',
        Buffer.alloc(8_192, 1),
      );
      await writeFixture(
        uploadRoot,
        'products/.original.jpg.in-progress.tmp',
        Buffer.alloc(4_096, 2),
      );

      await expect(resolveBackupContent(uploadRoot, [''])).resolves.toEqual({
        archivePaths: ['uploads'],
        filesSize: BigInt(original.length),
      });
    });

    it('rejects a path that escapes the upload root even if called directly', async () => {
      const uploadRoot = await makeTempRoot();

      await expect(
        resolveBackupContent(uploadRoot, ['../outside']),
      ).rejects.toThrow('Backup include path escapes uploads');
    });

    it('fails a full backup when a configured media path is missing', async () => {
      const uploadRoot = await makeTempRoot();

      await expect(
        resolveBackupContent(uploadRoot, ['missing-gallery']),
      ).rejects.toThrow(
        'Backup include path does not exist: uploads/missing-gallery',
      );
    });
  });

  describe('validateTarBackup', () => {
    it('validates a current archive containing dump, manifest, and uploads', async () => {
      const sourceRoot = await makeTempRoot();
      const dump = 'SELECT 1;\n';
      const serializedManifest = JSON.stringify(manifest);
      const original = Buffer.from('full-resolution-original-image');
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, dump);
      await writeFixture(
        sourceRoot,
        BACKUP_MANIFEST_FILENAME,
        serializedManifest,
      );
      await writeFixture(sourceRoot, 'uploads/products/original.jpg', original);
      const archivePath = await createArchive(sourceRoot, [
        BACKUP_SQL_FILENAME,
        BACKUP_MANIFEST_FILENAME,
        'uploads',
      ]);

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).resolves.toEqual({
        entryCount: 5,
        expandedBytes: BigInt(
          Buffer.byteLength(dump) +
            Buffer.byteLength(serializedManifest) +
            original.length,
        ),
        contentBytes: BigInt(original.length),
        hasManifest: true,
        layout: 'uploads',
      });
    });

    it('rejects an archive entry that traverses above the extraction root', async () => {
      const sourceRoot = await makeTempRoot();
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      const archivePath = await createArchive(
        sourceRoot,
        [BACKUP_SQL_FILENAME],
        '../',
      );

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).rejects.toThrow('Unsafe archive path');
    });

    it('rejects symbolic links', async () => {
      const sourceRoot = await makeTempRoot();
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      await writeFixture(sourceRoot, 'outside.jpg', 'outside');
      await mkdir(join(sourceRoot, 'uploads'), { recursive: true });
      await symlink('../outside.jpg', join(sourceRoot, 'uploads/link.jpg'));
      const archivePath = await createArchive(sourceRoot, [
        BACKUP_SQL_FILENAME,
        'uploads',
      ]);

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).rejects.toThrow('Unsupported archive entry type "SymbolicLink"');
    });

    it('rejects archives that mix current and legacy content layouts', async () => {
      const sourceRoot = await makeTempRoot();
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      await writeFixture(sourceRoot, 'uploads/products/current.jpg', 'current');
      await writeFixture(sourceRoot, 'products/legacy.jpg', 'legacy');
      const archivePath = await createArchive(sourceRoot, [
        BACKUP_SQL_FILENAME,
        'uploads',
        'products',
      ]);

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).rejects.toThrow('Archive mixes current and legacy content layouts');
    });

    it('rejects archives that recursively contain backup artifacts', async () => {
      const sourceRoot = await makeTempRoot();
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      await writeFixture(
        sourceRoot,
        'uploads/backups/previous.tar.gz',
        'recursive',
      );
      const archivePath = await createArchive(sourceRoot, [
        BACKUP_SQL_FILENAME,
        'uploads',
      ]);

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).rejects.toThrow('Backup archives cannot contain uploads/backups');
    });

    it('rejects forged internal restore journal entries', async () => {
      const sourceRoot = await makeTempRoot();
      await writeFixture(sourceRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      await writeFixture(
        sourceRoot,
        'uploads/.restore-db-committed-other-operation',
        'forged',
      );
      const archivePath = await createArchive(sourceRoot, [
        BACKUP_SQL_FILENAME,
        'uploads',
      ]);

      await expect(
        validateTarBackup(archivePath, validationLimits),
      ).rejects.toThrow('internal restore journal paths');
    });
  });

  describe('promoteBackupContent', () => {
    it('restores a directory over a file and crash recovery puts the file back', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/products/gallery/original.jpg',
        'restored-gallery-image',
      );
      await writeFixture(uploadRoot, 'products/gallery', 'original-file');

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'file-to-directory-interruption',
        ['uploads/products'],
      );
      await prepared.apply();
      await expect(
        readFile(
          join(uploadRoot, 'products/gallery/original.jpg'),
          'utf8',
        ),
      ).resolves.toBe('restored-gallery-image');
      await expect(
        lstat(join(uploadRoot, 'products/gallery')),
      ).resolves.toMatchObject({});
      expect(
        (await lstat(join(uploadRoot, 'products/gallery'))).isDirectory(),
      ).toBe(true);

      // Simulate a worker/process loss: only the on-disk journal remains.
      await rollbackInterruptedContentRestore(
        uploadRoot,
        'file-to-directory-interruption',
      );
      await expect(
        readFile(join(uploadRoot, 'products/gallery'), 'utf8'),
      ).resolves.toBe('original-file');
      expect(
        (await lstat(join(uploadRoot, 'products/gallery'))).isFile(),
      ).toBe(true);
    });

    it('restores a file over a directory and crash recovery puts the whole directory back', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/products/hero',
        'restored-file',
      );
      await writeFixture(
        uploadRoot,
        'products/hero/original.jpg',
        'original-image',
      );
      await writeFixture(
        uploadRoot,
        'products/hero/nested/metadata.json',
        '{"original":true}',
      );

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'directory-to-file-interruption',
        ['uploads/products'],
      );
      await prepared.apply();
      await expect(
        readFile(join(uploadRoot, 'products/hero'), 'utf8'),
      ).resolves.toBe('restored-file');
      expect((await lstat(join(uploadRoot, 'products/hero'))).isFile()).toBe(
        true,
      );

      // Simulate a worker/process loss: recovery must rename the journaled
      // directory as one object, including all nested bytes.
      await rollbackInterruptedContentRestore(
        uploadRoot,
        'directory-to-file-interruption',
      );
      await expect(
        readFile(join(uploadRoot, 'products/hero/original.jpg'), 'utf8'),
      ).resolves.toBe('original-image');
      await expect(
        readFile(
          join(uploadRoot, 'products/hero/nested/metadata.json'),
          'utf8',
        ),
      ).resolves.toBe('{"original":true}');
      expect(
        (await lstat(join(uploadRoot, 'products/hero'))).isDirectory(),
      ).toBe(true);
    });

    it('finalizes a committed directory-over-file transition after an interruption', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/branding/logo/original.svg',
        '<svg>restored</svg>',
      );
      await writeFixture(uploadRoot, 'branding/logo', 'old-file');

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'file-to-directory-commit',
      );
      await prepared.apply();
      await finalizeInterruptedContentRestore(
        uploadRoot,
        'file-to-directory-commit',
      );

      await expect(
        readFile(
          join(uploadRoot, 'branding/logo/original.svg'),
          'utf8',
        ),
      ).resolves.toBe('<svg>restored</svg>');
      expect(
        (await lstat(join(uploadRoot, 'branding/logo'))).isDirectory(),
      ).toBe(true);
      await expect(
        listInterruptedContentRestoreIds(uploadRoot),
      ).resolves.not.toContain('file-to-directory-commit');
    });

    it('finalizes a committed file-over-directory transition after an interruption', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/branding/logo.svg',
        '<svg>restored</svg>',
      );
      await writeFixture(
        uploadRoot,
        'branding/logo.svg/cached/thumb.webp',
        'old-cache',
      );

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'directory-to-file-commit',
      );
      await prepared.apply();
      await finalizeInterruptedContentRestore(
        uploadRoot,
        'directory-to-file-commit',
      );

      await expect(
        readFile(join(uploadRoot, 'branding/logo.svg'), 'utf8'),
      ).resolves.toBe('<svg>restored</svg>');
      expect(
        (await lstat(join(uploadRoot, 'branding/logo.svg'))).isFile(),
      ).toBe(true);
      await expect(
        listInterruptedContentRestoreIds(uploadRoot),
      ).resolves.not.toContain('directory-to-file-commit');
    });

    it('can roll staged content back before the database restore commits', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/products/image.jpg',
        Buffer.from('restored-original'),
      );
      await writeFixture(
        uploadRoot,
        'products/image.jpg',
        Buffer.from('current-original'),
      );

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'rollback-test',
      );
      await prepared.apply();
      await expect(
        readFile(join(uploadRoot, 'products/image.jpg'), 'utf8'),
      ).resolves.toBe('restored-original');

      await prepared.rollback();
      await prepared.commit();
      await expect(
        readFile(join(uploadRoot, 'products/image.jpg'), 'utf8'),
      ).resolves.toBe('current-original');
    });

    it('removes post-snapshot files only inside manifest include roots and can roll them back', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(
        extractRoot,
        'uploads/products/kept.jpg',
        'snapshot-kept',
      );
      await writeFixture(uploadRoot, 'products/kept.jpg', 'current-kept');
      await writeFixture(uploadRoot, 'products/newer.jpg', 'post-snapshot');
      await writeFixture(uploadRoot, 'branding/newer-logo.svg', 'untouched');

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'exact-rollback-test',
        ['uploads/products'],
      );
      expect(prepared.removedFiles).toBe(1);
      await prepared.apply();
      await expect(
        access(join(uploadRoot, 'products/newer.jpg')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(join(uploadRoot, 'branding/newer-logo.svg'), 'utf8'),
      ).resolves.toBe('untouched');

      await prepared.rollback();
      await expect(
        readFile(join(uploadRoot, 'products/newer.jpg'), 'utf8'),
      ).resolves.toBe('post-snapshot');
    });

    it('uses authoritative finalize after a committed DB restore even without a filesystem marker', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(extractRoot, 'uploads/products/image.jpg', 'restored');
      await writeFixture(uploadRoot, 'products/image.jpg', 'current');
      await writeFixture(uploadRoot, 'products/newer.jpg', 'newer');

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'db-control-commit',
        ['uploads/products'],
      );
      await prepared.apply();
      await expect(
        listInterruptedContentRestoreIds(uploadRoot),
      ).resolves.toContain('db-control-commit');

      await finalizeInterruptedContentRestore(uploadRoot, 'db-control-commit');
      await expect(
        readFile(join(uploadRoot, 'products/image.jpg'), 'utf8'),
      ).resolves.toBe('restored');
      await expect(
        access(join(uploadRoot, 'products/newer.jpg')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('lets database control override a stale filesystem commit marker and roll back', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      await writeFixture(extractRoot, 'uploads/products/image.jpg', 'restored');
      await writeFixture(uploadRoot, 'products/image.jpg', 'current');

      const prepared = await prepareBackupContentRestore(
        extractRoot,
        uploadRoot,
        'uploads',
        'db-control-rollback',
      );
      await prepared.apply();
      await prepared.markDatabaseCommitted();
      await rollbackInterruptedContentRestore(
        uploadRoot,
        'db-control-rollback',
        { ignoreFilesystemCommitMarker: true },
      );

      await expect(
        readFile(join(uploadRoot, 'products/image.jpg'), 'utf8'),
      ).resolves.toBe('current');
    });

    it('promotes exact current-layout bytes from uploads into the upload root', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      const original = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x4f, 0x52, 0x49, 0x47, 0x49, 0x4e, 0x41, 0x4c,
      ]);
      const logo = Buffer.from('<svg>original-logo</svg>');
      await writeFixture(
        extractRoot,
        'uploads/products/original.jpg',
        original,
      );
      await writeFixture(extractRoot, 'uploads/branding/logo.svg', logo);
      await writeFixture(
        uploadRoot,
        'products/original.jpg',
        Buffer.from('stale-cache-derivative'),
      );

      await expect(
        promoteBackupContent(extractRoot, uploadRoot, 'uploads'),
      ).resolves.toEqual({
        files: 2,
        bytes: BigInt(original.length + logo.length),
      });
      await expect(
        readFile(join(uploadRoot, 'products/original.jpg')),
      ).resolves.toEqual(original);
      await expect(
        readFile(join(uploadRoot, 'branding/logo.svg')),
      ).resolves.toEqual(logo);
    });

    it('promotes legacy root content without copying dump or manifest files', async () => {
      const extractRoot = await makeTempRoot();
      const uploadRoot = await makeTempRoot();
      const product = Buffer.from('legacy-original-product-image');
      const banner = Buffer.from('legacy-original-banner');
      await writeFixture(extractRoot, BACKUP_SQL_FILENAME, 'SELECT 1;\n');
      await writeFixture(
        extractRoot,
        BACKUP_MANIFEST_FILENAME,
        JSON.stringify(manifest),
      );
      await writeFixture(extractRoot, 'products/product.jpg', product);
      await writeFixture(extractRoot, 'banners/home.jpg', banner);

      await expect(
        promoteBackupContent(extractRoot, uploadRoot, 'legacy'),
      ).resolves.toEqual({
        files: 2,
        bytes: BigInt(product.length + banner.length),
      });
      await expect(
        readFile(join(uploadRoot, 'products/product.jpg')),
      ).resolves.toEqual(product);
      await expect(
        readFile(join(uploadRoot, 'banners/home.jpg')),
      ).resolves.toEqual(banner);
      await expect(
        access(join(uploadRoot, BACKUP_SQL_FILENAME)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        access(join(uploadRoot, BACKUP_MANIFEST_FILENAME)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});
