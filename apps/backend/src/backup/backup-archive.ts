import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { posix } from 'path';
import { extract, list, Parser } from 'tar';

export const BACKUP_MANIFEST_FILENAME = 'backup-manifest.json';
export const BACKUP_SQL_FILENAME = 'dump.sql';
export const BACKUP_FORMAT = 'ecomate-backup';
export const BACKUP_FORMAT_VERSION = 2;

const ALLOWED_ARCHIVE_TYPES = new Set(['File', 'OldFile', 'Directory']);
const MANIFEST_MAX_BYTES = 1024 * 1024;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  scope: 'db_files';
  storageProvider: 'local' | 'r2';
  contentLayout: 'uploads';
  localFilesIncluded: boolean;
  includePaths: string[];
  excludedPaths: string[];
}

export interface ArchiveValidation {
  entryCount: number;
  expandedBytes: bigint;
  contentBytes: bigint;
  hasManifest: boolean;
  layout: 'uploads' | 'legacy' | 'none';
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  );
}

function normalizeArchivePath(input: string): string {
  if (!input || input.includes('\0') || input.includes('\\')) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(input)}`);
  }

  let value = input;
  while (value.startsWith('./')) value = value.slice(2);
  value = value.replace(/\/+$/, '');

  if (!value || posix.isAbsolute(value)) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(input)}`);
  }

  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(input)}`);
  }

  return parts.join('/');
}

function isProtectedBackupPath(path: string): boolean {
  return path === 'uploads/backups' || path.startsWith('uploads/backups/');
}

function isAtomicUploadTemp(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.tmp');
}

function isRestoreJournalPath(path: string): boolean {
  return (
    path.startsWith('.restore-staging-') ||
    path.startsWith('.restore-rollback-') ||
    path.startsWith('.restore-created-') ||
    path.startsWith('.restore-db-committed-')
  );
}

/**
 * Settings historically used both "uploads" and paths relative to uploads.
 * Normalize both forms to paths relative to the uploads root, while preventing
 * traversal and preventing backup archives from recursively containing backups.
 */
export function normalizeBackupIncludePaths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('backup_include_paths must be a JSON array of paths');
  }

  const normalized: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') {
      throw new Error('backup_include_paths must contain only strings');
    }

    let value = raw.trim().replace(/\\/g, '/');
    while (value.startsWith('./')) value = value.slice(2);
    value = value.replace(/\/+$/, '');

    if (value === '' || value === '.' || value === 'uploads') {
      normalized.push('');
      continue;
    }
    if (value.startsWith('uploads/')) value = value.slice('uploads/'.length);

    if (
      !value ||
      value.includes('\0') ||
      posix.isAbsolute(value) ||
      value.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`Invalid backup include path: ${raw}`);
    }

    // Backup artifacts live under uploads/backups for local storage. Including
    // them makes every full backup recursively grow without bound.
    if (value === 'backups' || value.startsWith('backups/')) continue;
    normalized.push(value);
  }

  const unique = [...new Set(normalized)];
  // "DB + Files" with an empty include list must not silently degrade into a
  // database-only archive. Users who want that can explicitly choose db_only.
  if (unique.length === 0) return [''];
  if (unique.includes('')) return [''];

  // Remove children already covered by a selected parent.
  return unique.filter(
    (candidate) =>
      !unique.some(
        (parent) => parent !== candidate && candidate.startsWith(`${parent}/`),
      ),
  );
}

async function measurePath(
  absolutePath: string,
  relativeUploadPath: string,
): Promise<bigint> {
  if (
    relativeUploadPath === 'backups' ||
    relativeUploadPath.startsWith('backups/') ||
    isRestoreJournalPath(relativeUploadPath)
  ) {
    return 0n;
  }

  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) {
    throw new Error(
      `Symbolic links are not supported in backups: uploads/${relativeUploadPath}`,
    );
  }
  if (info.isFile()) return BigInt(info.size);
  if (!info.isDirectory()) {
    throw new Error(
      `Unsupported content entry in uploads: ${relativeUploadPath}`,
    );
  }

  let total = 0n;
  const dir = await opendir(absolutePath);
  for await (const entry of dir) {
    if (isAtomicUploadTemp(entry.name)) continue;
    const childRelative = relativeUploadPath
      ? `${relativeUploadPath}/${entry.name}`
      : entry.name;
    if (
      childRelative === 'backups' ||
      childRelative.startsWith('backups/') ||
      isRestoreJournalPath(childRelative)
    ) {
      continue;
    }
    total += await measurePath(join(absolutePath, entry.name), childRelative);
  }
  return total;
}

export async function resolveBackupContent(
  uploadRoot: string,
  includePaths: string[],
): Promise<{ archivePaths: string[]; filesSize: bigint }> {
  const archivePaths: string[] = [];
  let filesSize = 0n;

  for (const relativePath of includePaths) {
    const absolutePath = resolve(uploadRoot, relativePath || '.');
    if (!isWithin(uploadRoot, absolutePath)) {
      throw new Error(`Backup include path escapes uploads: ${relativePath}`);
    }

    try {
      await stat(absolutePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error(
          `Backup include path does not exist: ${
            relativePath ? `uploads/${relativePath}` : 'uploads'
          }`,
        );
      }
      throw error;
    }

    const archivePath = relativePath ? `uploads/${relativePath}` : 'uploads';
    archivePaths.push(archivePath);
    filesSize += await measurePath(absolutePath, relativePath);
  }

  return { archivePaths, filesSize };
}

export async function validateTarBackup(
  archivePath: string,
  options: {
    maxEntries: number;
    maxExpandedBytes: bigint;
    maxDecompressionRatio: number;
  },
): Promise<ArchiveValidation> {
  let entryCount = 0;
  let expandedBytes = 0n;
  let contentBytes = 0n;
  let hasDump = false;
  let hasManifest = false;
  let hasUploadsLayout = false;
  let hasLegacyContent = false;
  const seen = new Set<string>();

  let parser: Parser;
  parser = list({
    gzip: true,
    strict: true,
    maxDecompressionRatio: options.maxDecompressionRatio,
    onReadEntry: (entry) => {
      try {
        // PAX/GNU metadata records are interpreted by tar and are not extracted
        // as filesystem entries. The resulting real entry is validated below.
        if (entry.meta) return;

        if (
          entry.invalid ||
          entry.unsupported ||
          !ALLOWED_ARCHIVE_TYPES.has(entry.type)
        ) {
          throw new Error(
            `Unsupported archive entry type "${entry.type}" for ${entry.path}`,
          );
        }

        const path = normalizeArchivePath(entry.path);
        if (seen.has(path)) {
          throw new Error(`Duplicate archive entry: ${path}`);
        }
        seen.add(path);

        entryCount += 1;
        if (entryCount > options.maxEntries) {
          throw new Error(
            `Archive contains more than ${options.maxEntries} entries`,
          );
        }

        const entrySize = BigInt(entry.size || 0);
        if (entrySize < 0n) throw new Error(`Invalid archive size for ${path}`);
        expandedBytes += entrySize;
        if (expandedBytes > options.maxExpandedBytes) {
          throw new Error(
            `Archive expands beyond the ${options.maxExpandedBytes.toString()} byte safety limit`,
          );
        }

        if (path === BACKUP_SQL_FILENAME) {
          if (entry.type === 'Directory') {
            throw new Error(`${BACKUP_SQL_FILENAME} must be a file`);
          }
          hasDump = true;
          return;
        }

        if (path === BACKUP_MANIFEST_FILENAME) {
          if (entry.type === 'Directory' || entrySize > MANIFEST_MAX_BYTES) {
            throw new Error('Invalid backup manifest');
          }
          hasManifest = true;
          return;
        }

        if (isProtectedBackupPath(path)) {
          throw new Error('Backup archives cannot contain uploads/backups');
        }
        const uploadRelative = path.startsWith('uploads/')
          ? path.slice('uploads/'.length)
          : path;
        if (isRestoreJournalPath(uploadRelative)) {
          throw new Error(
            'Backup archives cannot contain internal restore journal paths',
          );
        }

        if (path === 'uploads' || path.startsWith('uploads/')) {
          hasUploadsLayout = true;
        } else {
          // Compatibility with version-1 archives, which placed configured
          // upload-relative paths directly at archive root.
          if (path === 'backups' || path.startsWith('backups/')) {
            throw new Error(
              'Backup archives cannot recursively contain backups',
            );
          }
          hasLegacyContent = true;
        }
        contentBytes += entrySize;
      } catch (error) {
        parser.abort(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const source = createReadStream(archivePath);
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        source.destroy();
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    };
    source.on('error', (error) => settle(error));
    parser.on('error', (error) =>
      settle(error instanceof Error ? error : new Error(String(error))),
    );
    parser.on('end', () => settle());
    source.pipe(parser);
  });

  if (!hasDump) {
    throw new Error(`Archive is missing ${BACKUP_SQL_FILENAME}`);
  }
  if (hasUploadsLayout && hasLegacyContent) {
    throw new Error('Archive mixes current and legacy content layouts');
  }

  return {
    entryCount,
    expandedBytes,
    contentBytes,
    hasManifest,
    layout: hasUploadsLayout ? 'uploads' : hasLegacyContent ? 'legacy' : 'none',
  };
}

export async function extractValidatedTarBackup(
  archivePath: string,
  destination: string,
  maxDecompressionRatio: number,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  await extract({
    file: archivePath,
    cwd: destination,
    gzip: true,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    unlink: true,
    maxDepth: 128,
    maxDecompressionRatio,
  });
}

export async function readBackupManifest(
  extractRoot: string,
): Promise<BackupManifest | null> {
  const manifestPath = join(extractRoot, BACKUP_MANIFEST_FILENAME);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupManifest>;
    if (
      parsed.format !== BACKUP_FORMAT ||
      parsed.version !== BACKUP_FORMAT_VERSION ||
      parsed.scope !== 'db_files' ||
      parsed.contentLayout !== 'uploads' ||
      !Array.isArray(parsed.includePaths) ||
      !Array.isArray(parsed.excludedPaths) ||
      typeof parsed.localFilesIncluded !== 'boolean' ||
      (parsed.storageProvider !== 'local' && parsed.storageProvider !== 'r2')
    ) {
      throw new Error('Unsupported or invalid backup manifest');
    }
    if (
      parsed.includePaths.some(
        (value) =>
          typeof value !== 'string' ||
          /^(?:\.\/)?(?:uploads\/)?backups(?:\/|$)/i.test(
            value.trim().replace(/\\/g, '/'),
          ),
      ) ||
      parsed.excludedPaths.some((value) => typeof value !== 'string')
    ) {
      throw new Error('Unsupported or invalid backup manifest paths');
    }
    parsed.includePaths = normalizeBackupIncludePaths(
      parsed.includePaths,
    ).map((path) => (path ? `uploads/${path}` : 'uploads'));
    return parsed as BackupManifest;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureSafeParent(uploadRoot: string, targetPath: string) {
  const rootReal = await realpath(uploadRoot);
  const parent = dirname(targetPath);
  await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  if (!isWithin(rootReal, parentReal)) {
    throw new Error(`Restore target escapes uploads: ${targetPath}`);
  }
}

async function atomicCopy(
  sourcePath: string,
  targetPath: string,
  uploadRoot: string,
): Promise<number> {
  await ensureSafeParent(uploadRoot, targetPath);
  const tempPath = `${targetPath}.restore-${randomUUID()}.tmp`;
  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  return (await stat(targetPath)).size;
}

async function promoteTree(
  sourceRoot: string,
  uploadRoot: string,
  legacyRoot: boolean,
): Promise<{ files: number; bytes: bigint }> {
  let files = 0;
  let bytes = 0n;

  const walk = async (current: string, relativePath: string): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to restore symbolic link: ${relativePath}`);
    }
    if (info.isFile()) {
      if (
        legacyRoot &&
        (relativePath === BACKUP_SQL_FILENAME ||
          relativePath === BACKUP_MANIFEST_FILENAME)
      ) {
        return;
      }
      if (
        relativePath === 'backups' ||
        relativePath.startsWith('backups/') ||
        isRestoreJournalPath(relativePath)
      ) {
        throw new Error('Refusing to restore nested backup artifacts');
      }
      const targetPath = resolve(uploadRoot, relativePath);
      if (!isWithin(uploadRoot, targetPath)) {
        throw new Error(`Restore target escapes uploads: ${relativePath}`);
      }
      bytes += BigInt(await atomicCopy(current, targetPath, uploadRoot));
      files += 1;
      return;
    }
    if (!info.isDirectory()) {
      throw new Error(`Unsupported restored content entry: ${relativePath}`);
    }

    const dir = await opendir(current);
    for await (const entry of dir) {
      const childRelative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      await walk(join(current, entry.name), childRelative);
    }
  };

  await walk(sourceRoot, '');
  return { files, bytes };
}

export async function promoteBackupContent(
  extractRoot: string,
  uploadRoot: string,
  layout: ArchiveValidation['layout'],
): Promise<{ files: number; bytes: bigint }> {
  const prepared = await prepareBackupContentRestore(
    extractRoot,
    uploadRoot,
    layout,
  );
  try {
    await prepared.apply();
    await prepared.commit();
    return { files: prepared.files, bytes: prepared.bytes };
  } catch (error) {
    await prepared.rollback().catch(() => {});
    throw error;
  }
}

export interface PreparedContentRestore {
  files: number;
  removedFiles: number;
  bytes: bigint;
  apply(): Promise<void>;
  markDatabaseCommitted(): Promise<void>;
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

interface PreparedEntry {
  relativePath: string;
  stagedPath: string | null;
  targetPath: string;
  rollbackPath: string;
}

interface RestoreMutationRecord {
  version: 1;
  kind: 'created' | 'original';
  relativePath: string;
}

interface RestoreMutationRecordWithMarker extends RestoreMutationRecord {
  markerPath: string;
}

function validateRestoreRelativePath(relativePath: unknown): string {
  if (typeof relativePath !== 'string') {
    throw new Error('Invalid restore mutation journal path');
  }
  const normalized = normalizeArchivePath(relativePath);
  if (
    normalized !== relativePath ||
    normalized === 'backups' ||
    normalized.startsWith('backups/') ||
    isRestoreJournalPath(normalized)
  ) {
    throw new Error(`Unsafe restore mutation journal path: ${relativePath}`);
  }
  return normalized;
}

function restorePathDepth(relativePath: string): number {
  return relativePath.split('/').length;
}

async function readRestoreMutationRecords(
  createdRoot: string,
): Promise<RestoreMutationRecordWithMarker[]> {
  const records: RestoreMutationRecordWithMarker[] = [];
  await walkRestoreFiles(createdRoot, '', async (markerPath) => {
    const raw = await readFile(markerPath, 'utf8');
    let record: RestoreMutationRecord;
    try {
      const parsed = JSON.parse(raw) as Partial<RestoreMutationRecord>;
      if (
        parsed.version !== 1 ||
        (parsed.kind !== 'created' && parsed.kind !== 'original')
      ) {
        throw new Error('Invalid restore mutation journal record');
      }
      record = {
        version: 1,
        kind: parsed.kind,
        relativePath: validateRestoreRelativePath(parsed.relativePath),
      };
    } catch (error) {
      // Version-2 archives originally stored created-file markers as the raw
      // relative path. Retain recovery compatibility with an interrupted
      // restore started by that implementation.
      if (raw.trimStart().startsWith('{')) throw error;
      record = {
        version: 1,
        kind: 'created',
        relativePath: validateRestoreRelativePath(raw),
      };
    }
    records.push({ ...record, markerPath });
  });
  return records;
}

async function walkRestoreFiles(
  root: string,
  relativePath: string,
  onFile: (path: string, relativePath: string) => Promise<void>,
): Promise<void> {
  let info;
  try {
    info = await lstat(root);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link in restore journal: ${root}`);
  }
  if (info.isFile()) {
    await onFile(root, relativePath);
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`Unsupported restore journal entry: ${root}`);
  }
  const directory = await opendir(root);
  for await (const entry of directory) {
    const childRelative = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    await walkRestoreFiles(join(root, entry.name), childRelative, onFile);
  }
}

function restoreOperationPaths(uploadRoot: string, operationId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    throw new Error('Unsafe restore operation id');
  }
  return {
    stagingRoot: join(uploadRoot, `.restore-staging-${operationId}`),
    rollbackRoot: join(uploadRoot, `.restore-rollback-${operationId}`),
    createdRoot: join(uploadRoot, `.restore-created-${operationId}`),
    committedMarker: join(uploadRoot, `.restore-db-committed-${operationId}`),
  };
}

/**
 * Reverts a swap interrupted by a hard worker/process crash. Existing targets
 * are recoverable from rollbackRoot; targets that did not exist before apply
 * have durable marker files in createdRoot.
 */
export async function rollbackInterruptedContentRestore(
  uploadRoot: string,
  operationId: string,
  options: { ignoreFilesystemCommitMarker?: boolean } = {},
): Promise<void> {
  await mkdir(uploadRoot, { recursive: true });
  const { stagingRoot, rollbackRoot, createdRoot, committedMarker } =
    restoreOperationPaths(uploadRoot, operationId);

  if (!options.ignoreFilesystemCommitMarker) {
    try {
      const marker = await lstat(committedMarker);
      if (!marker.isFile() || marker.isSymbolicLink()) {
        throw new Error('Invalid restore database-commit marker');
      }
      await rm(stagingRoot, { recursive: true, force: true });
      await rm(rollbackRoot, { recursive: true, force: true });
      await rm(createdRoot, { recursive: true, force: true });
      await unlink(committedMarker);
      return;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const mutationRecords = await readRestoreMutationRecords(createdRoot);
  const originalPaths = new Set(
    mutationRecords
      .filter((record) => record.kind === 'original')
      .map((record) => record.relativePath),
  );

  // Remove new replacement objects before putting originals back. Deepest
  // paths are removed first so a created child cannot make its parent removal
  // fail. A parent that replaced an original is removed by the original phase.
  for (const record of mutationRecords
    .filter((candidate) => candidate.kind === 'created')
    .sort(
      (a, b) =>
        restorePathDepth(b.relativePath) -
        restorePathDepth(a.relativePath),
    )) {
    const targetPath = resolve(uploadRoot, record.relativePath);
    if (!isWithin(uploadRoot, targetPath)) {
      throw new Error(
        `Created restore target escapes uploads: ${record.relativePath}`,
      );
    }
    await ensureSafeParent(uploadRoot, targetPath);
    await rm(targetPath, { recursive: true, force: true });
  }

  // A rollback object can be either a regular file or an entire directory.
  // The marker is written before the original is renamed, so a missing
  // rollback path means the process stopped before changing that target.
  for (const record of mutationRecords
    .filter((candidate) => candidate.kind === 'original')
    .sort(
      (a, b) =>
        restorePathDepth(b.relativePath) -
        restorePathDepth(a.relativePath),
    )) {
    const targetPath = resolve(uploadRoot, record.relativePath);
    const rollbackPath = resolve(rollbackRoot, record.relativePath);
    if (
      !isWithin(uploadRoot, targetPath) ||
      !isWithin(rollbackRoot, rollbackPath)
    ) {
      throw new Error(
        `Rollback target escapes restore roots: ${record.relativePath}`,
      );
    }
    let rollbackInfo;
    try {
      rollbackInfo = await lstat(rollbackPath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (
      rollbackInfo.isSymbolicLink() ||
      (!rollbackInfo.isFile() && !rollbackInfo.isDirectory())
    ) {
      throw new Error(
        `Rollback source has an unsupported type: ${record.relativePath}`,
      );
    }
    await ensureSafeParent(uploadRoot, targetPath);
    await rm(targetPath, { recursive: true, force: true });
    await rename(rollbackPath, targetPath);
  }

  // Compatibility recovery for older operations, whose rollback journal only
  // contained files and had no typed mutation records.
  await walkRestoreFiles(
    rollbackRoot,
    '',
    async (rollbackPath, relativePath) => {
      if (originalPaths.has(relativePath)) return;
      const targetPath = resolve(uploadRoot, relativePath);
      if (!isWithin(uploadRoot, targetPath)) {
        throw new Error(`Rollback target escapes uploads: ${relativePath}`);
      }
      await ensureSafeParent(uploadRoot, targetPath);
      await rm(targetPath, { recursive: true, force: true });
      await rename(rollbackPath, targetPath);
    },
  );

  await rm(stagingRoot, { recursive: true, force: true });
  await rm(rollbackRoot, { recursive: true, force: true });
  await rm(createdRoot, { recursive: true, force: true });
  await unlink(committedMarker).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

/**
 * Discards rollback bytes after the database-side control journal proves that
 * the SQL transaction committed. Unlike the legacy filesystem marker, callers
 * must make this decision from the durable database control plane.
 */
export async function finalizeInterruptedContentRestore(
  uploadRoot: string,
  operationId: string,
): Promise<void> {
  await mkdir(uploadRoot, { recursive: true });
  const { stagingRoot, rollbackRoot, createdRoot, committedMarker } =
    restoreOperationPaths(uploadRoot, operationId);
  await rm(stagingRoot, { recursive: true, force: true });
  await rm(rollbackRoot, { recursive: true, force: true });
  await rm(createdRoot, { recursive: true, force: true });
  await unlink(committedMarker).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

export async function listInterruptedContentRestoreIds(
  uploadRoot: string,
): Promise<string[]> {
  await mkdir(uploadRoot, { recursive: true });
  const ids = new Set<string>();
  const directory = await opendir(uploadRoot);
  for await (const entry of directory) {
    const match =
      /^\.(?:restore-staging|restore-rollback|restore-created|restore-db-committed)-(.+)$/.exec(
        entry.name,
      );
    if (match?.[1] && /^[A-Za-z0-9_-]{1,128}$/.test(match[1])) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

/**
 * Copies every restored media byte onto the uploads filesystem before the
 * database is touched. Applying then consists only of same-filesystem renames,
 * with original targets retained until the database restore succeeds.
 */
export async function prepareBackupContentRestore(
  extractRoot: string,
  uploadRoot: string,
  layout: ArchiveValidation['layout'],
  operationId: string = randomUUID(),
  exactIncludePaths?: string[],
): Promise<PreparedContentRestore> {
  if (layout === 'none') {
    return {
      files: 0,
      removedFiles: 0,
      bytes: 0n,
      async apply() {},
      async markDatabaseCommitted() {},
      async rollback() {},
      async commit() {},
    };
  }
  await mkdir(uploadRoot, { recursive: true });

  const sourceRoot =
    layout === 'uploads' ? join(extractRoot, 'uploads') : extractRoot;
  const legacyRoot = layout === 'legacy';
  const { stagingRoot, rollbackRoot, createdRoot, committedMarker } =
    restoreOperationPaths(uploadRoot, operationId);
  // Never delete a previous attempt's rollback bytes. Reconcile them first,
  // then create a fresh same-filesystem staging transaction.
  await rollbackInterruptedContentRestore(uploadRoot, operationId);
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(rollbackRoot, { recursive: true });
  await mkdir(createdRoot, { recursive: true });

  const entries: PreparedEntry[] = [];
  const restoredPaths = new Set<string>();
  const restoredDirectories = new Set<string>();
  const restoredFileAncestorPaths = new Set<string>();
  const restoredDirectoryAncestorPaths = new Set<string>();
  let bytes = 0n;
  let removedFiles = 0;

  const addAncestorPaths = (
    relativePath: string,
    destination: Set<string>,
    includeSelf: boolean,
  ) => {
    const parts = relativePath.split('/');
    const end = includeSelf ? parts.length : parts.length - 1;
    for (let index = 1; index <= end; index += 1) {
      destination.add(parts.slice(0, index).join('/'));
    }
  };

  const hasRestoredFileAncestor = (relativePath: string): boolean => {
    const parts = relativePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (restoredPaths.has(parts.slice(0, index).join('/'))) return true;
    }
    return false;
  };

  const prepareTree = async (
    current: string,
    relativePath: string,
  ): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to stage symbolic link: ${relativePath}`);
    }
    if (
      relativePath &&
      (relativePath === 'backups' ||
        relativePath.startsWith('backups/') ||
        isRestoreJournalPath(relativePath))
    ) {
      throw new Error(`Refusing to stage reserved path: ${relativePath}`);
    }
    if (info.isFile()) {
      if (
        legacyRoot &&
        (relativePath === BACKUP_SQL_FILENAME ||
          relativePath === BACKUP_MANIFEST_FILENAME)
      ) {
        return;
      }
      const targetPath = resolve(uploadRoot, relativePath);
      if (!isWithin(uploadRoot, targetPath)) {
        throw new Error(`Restore target escapes uploads: ${relativePath}`);
      }
      const stagedPath = resolve(stagingRoot, relativePath);
      const rollbackPath = resolve(rollbackRoot, relativePath);
      await ensureSafeParent(uploadRoot, stagedPath);
      await copyFile(current, stagedPath);
      const stagedInfo = await stat(stagedPath);
      bytes += BigInt(stagedInfo.size);
      entries.push({
        relativePath,
        stagedPath,
        targetPath,
        rollbackPath,
      });
      restoredPaths.add(relativePath);
      addAncestorPaths(relativePath, restoredFileAncestorPaths, false);
      return;
    }
    if (!info.isDirectory()) {
      throw new Error(`Unsupported restored content entry: ${relativePath}`);
    }
    if (relativePath) {
      restoredDirectories.add(relativePath);
      addAncestorPaths(
        relativePath,
        restoredDirectoryAncestorPaths,
        true,
      );
    }
    const dir = await opendir(current);
    for await (const entry of dir) {
      const childRelative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      await prepareTree(join(current, entry.name), childRelative);
    }
  };

  try {
    await prepareTree(sourceRoot, '');
    if (exactIncludePaths) {
      const normalizedExactPaths =
        normalizeBackupIncludePaths(exactIncludePaths);
      const collectTargetOnlyFiles = async (
        current: string,
        relativePath: string,
      ): Promise<void> => {
        let info;
        try {
          info = await lstat(current);
        } catch (error: any) {
          if (error?.code === 'ENOENT') return;
          throw error;
        }
        if (info.isSymbolicLink()) {
          throw new Error(
            `Symbolic links are not supported in exact restores: ${relativePath}`,
          );
        }
        if (info.isFile()) {
          const overlapsRestoredFile =
            restoredPaths.has(relativePath) ||
            restoredFileAncestorPaths.has(relativePath) ||
            hasRestoredFileAncestor(relativePath);
          const replacesRestoredDirectory =
            restoredDirectories.has(relativePath) ||
            restoredDirectoryAncestorPaths.has(relativePath);
          if (overlapsRestoredFile || replacesRestoredDirectory) return;
          const targetPath = resolve(uploadRoot, relativePath);
          if (!isWithin(uploadRoot, targetPath)) {
            throw new Error(
              `Exact restore target escapes uploads: ${relativePath}`,
            );
          }
          entries.push({
            relativePath,
            stagedPath: null,
            targetPath,
            rollbackPath: resolve(rollbackRoot, relativePath),
          });
          removedFiles += 1;
          return;
        }
        if (!info.isDirectory()) {
          throw new Error(`Unsupported exact-restore target: ${relativePath}`);
        }
        const directory = await opendir(current);
        for await (const entry of directory) {
          if (isAtomicUploadTemp(entry.name)) continue;
          const childRelative = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
          if (
            childRelative === 'backups' ||
            childRelative.startsWith('backups/') ||
            isRestoreJournalPath(childRelative)
          ) {
            continue;
          }
          await collectTargetOnlyFiles(
            join(current, entry.name),
            childRelative,
          );
        }
      };

      for (const relativePath of normalizedExactPaths) {
        await collectTargetOnlyFiles(
          resolve(uploadRoot, relativePath || '.'),
          relativePath,
        );
      }
    }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    await rm(rollbackRoot, { recursive: true, force: true }).catch(() => {});
    await rm(createdRoot, { recursive: true, force: true }).catch(() => {});
    await unlink(committedMarker).catch(() => {});
    throw error;
  }

  const journaledOriginalPaths = new Set<string>();
  const journaledCreatedPaths = new Set<string>();

  const writeMutationRecord = async (
    kind: RestoreMutationRecord['kind'],
    relativePath: string,
  ): Promise<void> => {
    validateRestoreRelativePath(relativePath);
    const markerPath = join(createdRoot, randomUUID());
    const record: RestoreMutationRecord = {
      version: 1,
      kind,
      relativePath,
    };
    await writeFile(markerPath, JSON.stringify(record), {
      encoding: 'utf8',
      flag: 'wx',
    });
  };

  const moveOriginalToRollback = async (
    relativePath: string,
    targetPath: string,
    rollbackPath: string,
  ): Promise<boolean> => {
    if (journaledOriginalPaths.has(relativePath)) return false;
    let existing;
    try {
      existing = await lstat(targetPath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    if (
      existing.isSymbolicLink() ||
      (!existing.isFile() && !existing.isDirectory())
    ) {
      throw new Error(
        `Restore target has an unsupported type: ${relativePath}`,
      );
    }
    await writeMutationRecord('original', relativePath);
    await mkdir(dirname(rollbackPath), { recursive: true });
    await rename(targetPath, rollbackPath);
    journaledOriginalPaths.add(relativePath);
    return true;
  };

  const journalCreatedPath = async (relativePath: string): Promise<void> => {
    if (
      journaledCreatedPaths.has(relativePath) ||
      journaledOriginalPaths.has(relativePath)
    ) {
      return;
    }
    await writeMutationRecord('created', relativePath);
    journaledCreatedPaths.add(relativePath);
  };

  const ensureDesiredDirectory = async (
    relativePath: string,
  ): Promise<void> => {
    const targetPath = resolve(uploadRoot, relativePath);
    const rollbackPath = resolve(rollbackRoot, relativePath);
    if (!isWithin(uploadRoot, targetPath)) {
      throw new Error(`Restore directory escapes uploads: ${relativePath}`);
    }
    await ensureSafeParent(uploadRoot, targetPath);
    try {
      const existing = await lstat(targetPath);
      if (existing.isSymbolicLink()) {
        throw new Error(
          `Restore directory target is a symbolic link: ${relativePath}`,
        );
      }
      if (existing.isDirectory()) return;
      if (!existing.isFile()) {
        throw new Error(
          `Restore directory target has an unsupported type: ${relativePath}`,
        );
      }
      await moveOriginalToRollback(relativePath, targetPath, rollbackPath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await journalCreatedPath(relativePath);
    }
    await mkdir(targetPath);
  };

  const rollback = async (): Promise<void> => {
    await rollbackInterruptedContentRestore(uploadRoot, operationId, {
      ignoreFilesystemCommitMarker: true,
    });
  };

  return {
    files: restoredPaths.size,
    removedFiles,
    bytes,
    async apply() {
      try {
        for (const relativePath of [...restoredDirectories].sort(
          (a, b) => restorePathDepth(a) - restorePathDepth(b),
        )) {
          await ensureDesiredDirectory(relativePath);
        }

        for (const entry of entries) {
          await ensureSafeParent(uploadRoot, entry.targetPath);
          const movedOriginal = await moveOriginalToRollback(
            entry.relativePath,
            entry.targetPath,
            entry.rollbackPath,
          );
          if (!movedOriginal && !entry.stagedPath) {
            // A target-only file disappeared after staging, or an ancestor
            // type transition already moved it. Either is the exact snapshot.
            continue;
          }
          if (!entry.stagedPath) continue;
          if (!movedOriginal) {
            await journalCreatedPath(entry.relativePath);
          }
          await rename(entry.stagedPath, entry.targetPath);
        }
      } catch (error) {
        await rollback();
        throw error;
      }
    },
    async markDatabaseCommitted() {
      await writeFile(committedMarker, new Date().toISOString(), {
        encoding: 'utf8',
        flag: 'w',
      });
    },
    rollback,
    async commit() {
      await rm(stagingRoot, { recursive: true, force: true });
      await rm(rollbackRoot, { recursive: true, force: true });
      await rm(createdRoot, { recursive: true, force: true });
      await unlink(committedMarker).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    },
  };
}
