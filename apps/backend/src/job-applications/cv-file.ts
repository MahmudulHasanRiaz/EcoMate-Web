import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { basename, extname } from 'path';

/**
 * CV upload rules (owner-locked, storefront dynamic-pages round 2026-11-13).
 *
 * Accept ONLY PDF / DOC / DOCX, verified by BOTH the extension allowlist
 * AND magic-byte sniffing — the client-supplied MIME is never trusted.
 * Size cap 5 MB. Stored under a randomised filename in the private
 * (non-public) storage namespace — never the user-supplied filename on
 * disk, never a guessable public URL.
 */

// Storage key prefix for the private namespace (StorageService
// storeBackupStream writes `private-local/*` outside /uploads, which is
// the only statically served tree — see storage.service.ts).
export const CV_STORAGE_PREFIX = 'private-local/cvs/';

export const CV_MAX_BYTES = 5 * 1024 * 1024;

export const CV_ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'] as const;

export type CvKind = 'pdf' | 'doc' | 'docx';

const CV_KIND_BY_EXTENSION: Record<string, CvKind> = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
};

const CV_MIME_BY_KIND: Record<CvKind, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Sniff the file kind from its magic bytes. Returns null when the bytes
 * match none of the three accepted formats.
 *   PDF  — `%PDF`            (25 50 44 46)
 *   DOC  — OLE2 compound     (D0 CF 11 E0)
 *   DOCX — ZIP local header  (50 4B 03 04)
 */
export function detectCvKind(buffer: Buffer): CvKind | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0])) return 'doc';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'docx';
  return null;
}

/**
 * Validate an uploaded CV buffer against the owner-locked rules.
 * Returns the verified kind + the safe MIME type to store/serve it with.
 * The extension must agree with the sniffed bytes — a `.pdf` name over
 * ZIP bytes (or any other mismatch) is rejected.
 */
export function validateCvBuffer(
  buffer: Buffer,
  originalname: string,
): { kind: CvKind; ext: string; mimeType: string } {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('CV file is empty');
  }
  if (buffer.length > CV_MAX_BYTES) {
    throw new BadRequestException('CV must be 5 MB or smaller');
  }
  const ext = extname(originalname || '').toLowerCase();
  const expectedKind = CV_KIND_BY_EXTENSION[ext];
  if (!expectedKind) {
    throw new BadRequestException(
      'CV must be a PDF, DOC or DOCX file',
    );
  }
  const kind = detectCvKind(buffer);
  if (!kind) {
    throw new BadRequestException(
      'CV file contents do not match a PDF, DOC or DOCX document',
    );
  }
  if (kind !== expectedKind) {
    throw new BadRequestException(
      'CV file extension does not match its contents',
    );
  }
  return { kind, ext, mimeType: CV_MIME_BY_KIND[kind] };
}

/** Randomised private storage key — the user-supplied filename never lands on disk. */
export function cvStorageKey(ext: string): string {
  return `${CV_STORAGE_PREFIX}${randomUUID()}${ext}`;
}

/** Safe MIME type for serving a stored CV, derived from its storage key. */
export function cvMimeTypeForKey(key: string): string {
  const ext = extname(key).toLowerCase();
  const kind = CV_KIND_BY_EXTENSION[ext];
  return kind ? CV_MIME_BY_KIND[kind] : 'application/octet-stream';
}

/** Original filename, sanitised for storage/display (no paths, no control chars). */
export function sanitizeCvOriginalName(name: string): string {
  const base = basename(name || 'cv').replace(/[^\w.\-() ]+/g, '_').trim();
  return base || 'cv';
}

/** Download filename: original name when usable, else a neutral fallback. */
export function cvDownloadFilename(
  originalName: string | null | undefined,
  key: string,
): string {
  const ext = extname(key).toLowerCase();
  const base = sanitizeCvOriginalName(originalName || '');
  if (base && base !== 'cv' && extname(base).toLowerCase() === ext) return base;
  return `cv${ext || '.pdf'}`;
}
