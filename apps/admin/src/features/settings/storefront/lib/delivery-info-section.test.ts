import { describe, it, expect } from 'vitest';
import {
  getSectionById,
  getSectionsInCategory,
} from './categories';
import { FIELD_SCHEMAS } from './field-schemas';

describe('commerce-delivery-info section registration', () => {
  it('registers toggle + title + rows fields under commerce', () => {
    const meta = getSectionById('commerce-delivery-info');
    expect(meta.fields).toEqual([
      'delivery_info_enabled',
      'delivery_info_title',
      'delivery_info_rows',
    ]);
    const ids = getSectionsInCategory('commerce').map((s) => s.id);
    expect(ids).toContain('commerce-delivery-info');
  });

  it('defines editable schemas for all three keys', () => {
    expect(FIELD_SCHEMAS.delivery_info_enabled.type).toBe('switch');
    expect(FIELD_SCHEMAS.delivery_info_title.type).toBe('text');
    expect(FIELD_SCHEMAS.delivery_info_rows.type).toBe('array-delivery-rows');
  });
});
