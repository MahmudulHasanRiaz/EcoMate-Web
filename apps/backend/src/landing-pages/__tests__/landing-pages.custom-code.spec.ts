import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CUSTOM_CSS_MAX_BYTES,
  CUSTOM_HTML_MAX_BYTES,
  assertValidCustomCode,
  validateCustomCode,
} from '../custom-code-validation';
import {
  CreateLandingPageDto,
  UpdateLandingPageDto,
} from '../dto/landing-page.dto';
import { LandingPagesService } from '../landing-pages.service';

/**
 * Audit §8 items 10–11: DTO wiring + save-time custom-code validation.
 *
 * The malicious payload below is the audit's stored-XSS case: an inline
 * event handler, a `javascript:` URL, an <iframe> and a <script> tag in
 * one save. Every construct must be named in the single 400 the admin
 * (and the AI fixing the code) sees.
 */

const MALICIOUS_HTML = [
  '<h2>Winter Sale</h2>',
  '<img src="x" onerror="alert(document.cookie)">',
  '<a href="javascript:alert(1)">click me</a>',
  '<iframe src="https://evil.example/"></iframe>',
  '<script>alert(1)</script>',
].join('\n');

const SAFE_HTML = [
  '<h2>Winter Sale</h2>',
  '<p>Up to 50% off this weekend.</p>',
  '<img src="https://cdn.example.com/hero.jpg" alt="Winter collection">',
  '<a href="https://example.com/shop">Shop now</a>',
  '<ul><li>Free delivery</li><li>Cash on delivery</li></ul>',
  '<div id="ecomate-checkout-mount"></div>',
].join('\n');

const SAFE_CSS =
  '#landing-root h2 { color: #0e5e5a; font-size: 28px; }\n' +
  '#landing-root p { line-height: 1.6; }\n' +
  '#landing-root ul { list-style: disc; padding-left: 20px; }';

describe('validateCustomCode', () => {
  it('rejects a malicious payload naming every forbidden construct', () => {
    const violations = validateCustomCode({ customHtml: MALICIOUS_HTML });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('onerror'),
        expect.stringContaining('javascript:'),
        expect.stringContaining('<iframe>'),
        expect.stringContaining('<script>'),
      ]),
    );
    expect(violations.length).toBe(4);
  });

  it('throws ONE 400 listing every violation (AI loop can fix all at once)', () => {
    let message = '';
    try {
      assertValidCustomCode({ customHtml: MALICIOUS_HTML });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      message = (e as Error).message;
    }
    for (const construct of ['onerror', 'javascript:', '<iframe>', '<script>']) {
      expect(message).toContain(construct);
    }
  });

  it('accepts a safe payload: headings, paragraphs, https images, links, lists, scoped CSS', () => {
    expect(validateCustomCode({ customHtml: SAFE_HTML, customCss: SAFE_CSS })).toEqual([]);
  });

  it('rejects every other forbidden HTML construct by name', () => {
    const cases: Array<[string, string]> = [
      ['<object data="x"></object>', '<object>'],
      ['<embed src="x">', '<embed>'],
      ['<form action="/x"></form>', '<form>'],
      ['<link rel="stylesheet" href="x">', '<link>'],
      ['<meta charset="utf-8">', '<meta>'],
      ['<base href="/">', '<base>'],
      ['<style>p{}</style>', '<style>'],
      ['<input name="phone">', '<input>'],
      ['<select><option>x</option></select>', '<select>'],
      ['<textarea></textarea>', '<textarea>'],
      ['<button type="submit">Order</button>', '<button>'],
      ['<label for="phone">Phone</label>', '<label>'],
      ['<a href="vbscript:msgbox(1)">x</a>', 'vbscript:'],
      ['<svg onload="alert(1)">', 'onload'],
      ['<details open ontoggle="alert(1)">', 'ontoggle'],
      ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'data:text/html'],
      ['<iframe srcdoc="<p>hi</p>"></iframe>', 'srcdoc'],
    ];
    for (const [html, construct] of cases) {
      const violations = validateCustomCode({ customHtml: html });
      expect(violations.join(' ')).toContain(construct);
    }
  });

  it('rejects every forbidden CSS construct by name', () => {
    const cases: Array<[string, string]> = [
      ['@import url("https://evil.example/a.css");', '@import'],
      ['@font-face { font-family: X; }', '@font-face'],
      ['p { width: expression(alert(1)); }', 'expression('],
      ['a { background: javascript:alert(1); }', 'javascript:'],
      ['a { background: vbscript:msgbox(1); }', 'vbscript:'],
      ['p { behavior: url(x.htc); }', 'behavior:'],
      ['p { -moz-binding: url(x.xml#x); }', '-moz-binding'],
      ['p { background: url(data:text/html,<script>); }', 'data:text/html'],
    ];
    for (const [css, construct] of cases) {
      const violations = validateCustomCode({ customCss: css });
      expect(violations.join(' ')).toContain(construct);
    }
  });

  it('does not flag the same words in visible text (only markup executes)', () => {
    const html =
      '<p>Never use javascript: URLs or onerror handlers in your code.</p>';
    expect(validateCustomCode({ customHtml: html })).toEqual([]);
  });

  it('400s oversize customHtml (> 100 KB) and oversize customCss (> 50 KB)', () => {
    const bigHtml = 'a'.repeat(CUSTOM_HTML_MAX_BYTES + 1);
    expect(validateCustomCode({ customHtml: bigHtml })).toEqual([
      expect.stringContaining('100 KB'),
    ]);
    expect(validateCustomCode({ customHtml: 'a'.repeat(CUSTOM_HTML_MAX_BYTES) })).toEqual([]);

    const bigCss = 'a'.repeat(CUSTOM_CSS_MAX_BYTES + 1);
    expect(validateCustomCode({ customCss: bigCss })).toEqual([
      expect.stringContaining('50 KB'),
    ]);
    expect(validateCustomCode({ customCss: 'a'.repeat(CUSTOM_CSS_MAX_BYTES) })).toEqual([]);
  });

  it('treats absent / null custom code as valid', () => {
    expect(validateCustomCode({})).toEqual([]);
    expect(validateCustomCode({ customHtml: null, customCss: null })).toEqual([]);
  });
});

describe('LandingPagesService — custom-code validation on save', () => {
  function makeService() {
    const prisma = {
      landingPage: {
        create: jest.fn().mockResolvedValue({ id: 'lp-1', slug: 'sale' }),
        update: jest.fn().mockResolvedValue({ id: 'lp-1', slug: 'sale' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'lp-1', slug: 'sale' }),
      },
    };
    return { svc: new LandingPagesService(prisma as any), prisma };
  }

  it('create: rejects a malicious payload with the construct named, no DB write', async () => {
    const { svc, prisma } = makeService();
    await expect(
      svc.create({
        title: 'Sale',
        slug: 'sale',
        pageType: 'custom',
        customHtml: MALICIOUS_HTML,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.create({
        title: 'Sale',
        slug: 'sale',
        pageType: 'custom',
        customHtml: MALICIOUS_HTML,
      }),
    ).rejects.toThrow('<script>');
    expect(prisma.landingPage.create).not.toHaveBeenCalled();
  });

  it('create: rejects oversize customHtml with a 400, no DB write', async () => {
    const { svc, prisma } = makeService();
    await expect(
      svc.create({
        title: 'Sale',
        slug: 'sale',
        pageType: 'custom',
        customHtml: 'a'.repeat(CUSTOM_HTML_MAX_BYTES + 1),
      }),
    ).rejects.toThrow('100 KB');
    expect(prisma.landingPage.create).not.toHaveBeenCalled();
  });

  it('create: accepts a safe payload and stores it', async () => {
    const { svc, prisma } = makeService();
    await svc.create({
      title: 'Sale',
      slug: 'sale',
      pageType: 'custom',
      customHtml: SAFE_HTML,
      customCss: SAFE_CSS,
    });
    expect(prisma.landingPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customHtml: SAFE_HTML,
          customCss: SAFE_CSS,
        }),
      }),
    );
  });

  it('update: rejects a malicious payload with the construct named, no DB write', async () => {
    const { svc, prisma } = makeService();
    await expect(
      svc.update('lp-1', { customCss: '@import url("https://evil.example/a.css");' }),
    ).rejects.toThrow('@import');
    expect(prisma.landingPage.update).not.toHaveBeenCalled();
  });

  it('update: accepts a safe payload', async () => {
    const { svc, prisma } = makeService();
    await svc.update('lp-1', { customHtml: SAFE_HTML, customCss: SAFE_CSS });
    expect(prisma.landingPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customHtml: SAFE_HTML }),
      }),
    );
  });
});

describe('LandingPage DTOs — pageType validation', () => {
  it('CreateLandingPageDto rejects pageType outside template|custom', async () => {
    const dto = plainToInstance(CreateLandingPageDto, {
      title: 'Sale',
      slug: 'sale',
      pageType: 'bogus',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('pageType');
  });

  it('CreateLandingPageDto accepts template and custom', async () => {
    for (const pageType of ['template', 'custom']) {
      const dto = plainToInstance(CreateLandingPageDto, {
        title: 'Sale',
        slug: 'sale',
        pageType,
      });
      expect(await validate(dto)).toEqual([]);
    }
  });

  it('UpdateLandingPageDto rejects pageType outside template|custom', async () => {
    const dto = plainToInstance(UpdateLandingPageDto, { pageType: 'landing' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('pageType');
  });

  it('the wired ValidationPipe ({ whitelist: true }) rejects a bad pageType and strips unknown props', async () => {
    const pipe = new ValidationPipe({ whitelist: true });
    await expect(
      pipe.transform(
        { title: 'Sale', slug: 'sale', pageType: 'bogus' },
        { type: 'body', metatype: CreateLandingPageDto },
      ),
    ).rejects.toThrow(BadRequestException);

    const result: any = await pipe.transform(
      { title: 'Sale', slug: 'sale', pageType: 'custom', injected: 'x' },
      { type: 'body', metatype: CreateLandingPageDto },
    );
    expect(result.pageType).toBe('custom');
    expect(result).not.toHaveProperty('injected');
  });
});
