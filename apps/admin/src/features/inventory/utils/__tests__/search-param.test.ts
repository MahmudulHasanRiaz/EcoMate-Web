import { describe, expect, it } from 'vitest'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/router-core'
import { sanitizeSearchParam, sanitizeSearchState } from '../search-param'

// Locks the 2026-11-12 "null" in the Stock search box: the router's default
// codec JSON-round-trips `?q=null` to a real null and `?q=%22null%22` back to
// the STRING "null", and the old blind `as string | undefined` cast in
// validateSearch let both reach the search box verbatim.
describe('sanitizeSearchParam (Stock page route search)', () => {
  it.each([
    ['null', undefined],
    ['Null', undefined],
    ['NULL', undefined],
    ['  null  ', undefined],
    ['undefined', undefined],
    ['Undefined', undefined],
    ['  undefined ', undefined],
    ['', undefined],
    ['   ', undefined],
  ])('maps literal junk %p to absent', (input, expected) => {
    expect(sanitizeSearchParam(input)).toBe(expected)
  })

  it.each([[null], [undefined], [123], [0], [true], [false], [['hoodie']], [{}]])(
    'maps non-string %p to absent',
    (input) => {
      expect(sanitizeSearchParam(input)).toBeUndefined()
    },
  )

  it.each([
    ['hoodie', 'hoodie'],
    ['ABC-123', 'ABC-123'],
    ['nullify', 'nullify'],
    ['nullable hoodie', 'nullable hoodie'],
    ['  hoodie  ', '  hoodie  '],
  ])('passes a real query through unchanged: %p', (input, expected) => {
    expect(sanitizeSearchParam(input)).toBe(expected)
  })
})

describe('sanitizeSearchState (Stock search-box initializer)', () => {
  it.each([
    ['null', ''],
    [null, ''],
    [undefined, ''],
    [123, ''],
    ['hoodie', 'hoodie'],
  ])('maps %p to %p', (input, expected) => {
    expect(sanitizeSearchState(input)).toBe(expected)
  })
})

describe('validateSearch shape (same mapping the route applies to every key)', () => {
  // Mirrors routes/_authenticated/op/inventory/index.tsx validateSearch
  // without importing the route file (which pulls in the whole component).
  const validateSearch = (search: Record<string, unknown>) => ({
    filter: sanitizeSearchParam(search.filter),
    warehouse: sanitizeSearchParam(search.warehouse),
    view: sanitizeSearchParam(search.view),
    q: sanitizeSearchParam(search.q),
  })

  it('drops null / literal-"null" / non-string values on every key', () => {
    expect(
      validateSearch({ q: 'null', filter: null, warehouse: 123, view: 'undefined' }),
    ).toEqual({ filter: undefined, warehouse: undefined, view: undefined, q: undefined })
  })

  it('passes real values through unchanged', () => {
    expect(
      validateSearch({ q: 'hoodie', filter: 'low_stock', warehouse: 'wh-1', view: 'physical' }),
    ).toEqual({ filter: 'low_stock', warehouse: 'wh-1', view: 'physical', q: 'hoodie' })
  })
})

describe('router round-trip (real TanStack default codec)', () => {
  it('a ?q=null URL never reaches the search box', () => {
    // defaultParseSearch JSON-parses ?q=null to a REAL null …
    expect(defaultParseSearch('?q=null')).toEqual({ q: null })
    // … which the old `?? ""` initializer happened to catch, but the
    // sanitize must catch too, and the write-back must never re-emit it.
    const parsed = defaultParseSearch('?q=null')
    expect(sanitizeSearchState((parsed as { q?: unknown }).q)).toBe('')
    expect(defaultStringifySearch({ q: sanitizeSearchParam((parsed as { q?: unknown }).q) })).toBe('')
  })

  it('a ?q=%22null%22 URL (quoted string "null") never reaches the search box', () => {
    // This is the form that actually rendered: the codec quotes a "null"
    // STRING on write so it parses back as the string "null", which `??`
    // cannot catch — the initializer used to put it verbatim in the box.
    expect(defaultParseSearch('?q=%22null%22')).toEqual({ q: 'null' })
    expect(defaultStringifySearch({ q: 'null' })).toBe('?q=%22null%22')
    const parsed = defaultParseSearch('?q=%22null%22')
    expect(sanitizeSearchState((parsed as { q?: unknown }).q)).toBe('')
  })

  it('a real query survives the round-trip unchanged', () => {
    const parsed = defaultParseSearch(defaultStringifySearch({ q: 'hoodie' }))
    expect(sanitizeSearchState((parsed as { q?: unknown }).q)).toBe('hoodie')
  })
})
