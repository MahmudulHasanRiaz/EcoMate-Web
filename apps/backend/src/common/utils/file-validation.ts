import { BadRequestException } from '@nestjs/common';

type MagicRule = { offset: number; bytes: number[] | string };

const MAGIC_RULES: Record<string, MagicRule[]> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [
    { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  'image/gif': [{ offset: 0, bytes: 'GIF8' }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  'image/avif': [
    { offset: 4, bytes: 'ftyp' },
    { offset: 8, bytes: 'avif' },
  ],
  'image/bmp': [{ offset: 0, bytes: [0x42, 0x4d] }],
  'image/tiff': [
    { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] },
    { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  ],
  'video/mp4': [{ offset: 4, bytes: 'ftyp' }],
  'video/webm': [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  'video/x-msvideo': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
  'video/quicktime': [{ offset: 4, bytes: 'ftyp' }],
  'video/x-matroska': [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
};

function matchesMagic(buffer: Buffer, rule: MagicRule): boolean {
  const raw =
    rule.bytes instanceof Array
      ? Buffer.from(rule.bytes)
      : Buffer.from(rule.bytes, 'ascii');
  if (buffer.length < rule.offset + raw.length) return false;
  for (let i = 0; i < raw.length; i++) {
    if (buffer[rule.offset + i] !== raw[i]) return false;
  }
  return true;
}

export function validateMagicBytes(buffer: Buffer, mimetype: string): void {
  if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/')) return;

  const rules = MAGIC_RULES[mimetype.toLowerCase()];
  if (!rules) return;

  for (const rule of rules) {
    if (!matchesMagic(buffer, rule)) {
      throw new BadRequestException(`Invalid file signature for ${mimetype}`);
    }
  }
}
