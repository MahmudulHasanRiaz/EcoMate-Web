import {
  CV_MAX_BYTES,
  cvDownloadFilename,
  cvMimeTypeForKey,
  cvStorageKey,
  detectCvKind,
  validateCvBuffer,
} from '../cv-file';

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const DOC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('cv-file (owner-locked CV rules)', () => {
  describe('detectCvKind — magic-byte sniffing', () => {
    it('sniffs %PDF', () => expect(detectCvKind(PDF)).toBe('pdf'));
    it('sniffs OLE2 DOC header', () => expect(detectCvKind(DOC)).toBe('doc'));
    it('sniffs ZIP DOCX header', () => expect(detectCvKind(DOCX)).toBe('docx'));
    it('returns null for a PNG', () => expect(detectCvKind(PNG)).toBeNull());
    it('returns null for an empty buffer', () =>
      expect(detectCvKind(Buffer.alloc(0))).toBeNull());
    it('returns null for a truncated header', () =>
      expect(detectCvKind(Buffer.from([0x25, 0x50]))).toBeNull());
  });

  describe('validateCvBuffer — extension + magic must agree', () => {
    it('accepts a PDF with a .pdf name', () => {
      expect(validateCvBuffer(PDF, 'resume.pdf')).toEqual({
        kind: 'pdf',
        ext: '.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('accepts a DOCX with a .docx name', () => {
      expect(validateCvBuffer(DOCX, 'resume.docx').kind).toBe('docx');
    });

    it('accepts a DOC with a .doc name', () => {
      expect(validateCvBuffer(DOC, 'resume.doc').kind).toBe('doc');
    });

    it('accepts uppercase extensions', () => {
      expect(validateCvBuffer(PDF, 'Resume.PDF').kind).toBe('pdf');
    });

    it('rejects a disallowed extension even with valid PDF bytes', () => {
      expect(() => validateCvBuffer(PDF, 'resume.png')).toThrow(
        'CV must be a PDF, DOC or DOCX file',
      );
    });

    it('rejects a .html name outright (never trust the name alone)', () => {
      expect(() => validateCvBuffer(PDF, 'resume.html')).toThrow(
        'CV must be a PDF, DOC or DOCX file',
      );
    });

    it('rejects PNG bytes wearing a .pdf name (magic wins over the name)', () => {
      expect(() => validateCvBuffer(PNG, 'resume.pdf')).toThrow(
        'do not match a PDF, DOC or DOCX',
      );
    });

    it('rejects a DOCX zip wearing a .pdf name (extension/magic mismatch)', () => {
      expect(() => validateCvBuffer(DOCX, 'resume.pdf')).toThrow(
        'extension does not match',
      );
    });

    it('rejects an empty file', () => {
      expect(() => validateCvBuffer(Buffer.alloc(0), 'resume.pdf')).toThrow(
        'CV file is empty',
      );
    });

    it('rejects a file over the 5 MB cap', () => {
      const big = Buffer.alloc(CV_MAX_BYTES + 1);
      big[0] = 0x25;
      big[1] = 0x50;
      big[2] = 0x44;
      big[3] = 0x46;
      expect(() => validateCvBuffer(big, 'resume.pdf')).toThrow(
        '5 MB or smaller',
      );
    });
  });

  describe('storage keys — randomised, never the user filename', () => {
    it('generates a private-local key with the verified extension', () => {
      const key = cvStorageKey('.pdf');
      expect(key.startsWith('private-local/cvs/')).toBe(true);
      expect(key.endsWith('.pdf')).toBe(true);
      expect(key).not.toContain('resume');
    });

    it('generates unique keys', () => {
      expect(cvStorageKey('.pdf')).not.toBe(cvStorageKey('.pdf'));
    });
  });

  describe('download helpers', () => {
    it('maps a stored key to its safe content type', () => {
      expect(cvMimeTypeForKey('private-local/cvs/x.pdf')).toBe(
        'application/pdf',
      );
      expect(
        cvMimeTypeForKey(
          'private-local/cvs/x.docx',
        ),
      ).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(cvMimeTypeForKey('private-local/cvs/x.exe')).toBe(
        'application/octet-stream',
      );
    });

    it('keeps a matching original name for download', () => {
      expect(
        cvDownloadFilename('My Resume.pdf', 'private-local/cvs/x.pdf'),
      ).toBe('My Resume.pdf');
    });

    it('falls back to a neutral name when the original name is unusable', () => {
      expect(cvDownloadFilename(null, 'private-local/cvs/x.pdf')).toBe('cv.pdf');
      expect(
        cvDownloadFilename('../../etc/passwd', 'private-local/cvs/x.pdf'),
      ).toBe('cv.pdf');
    });
  });
});
