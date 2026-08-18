import { describe, it, expect } from 'vitest'
import { uniquePhones } from './block-phone-dialog'

describe('uniquePhones', () => {
  it('dedupes and trims phone numbers', () => {
    expect(uniquePhones([' 01712345678 ', '01712345678', '+8801712345678'])).toEqual([
      '01712345678',
      '+8801712345678',
    ])
  })

  it('drops empty values', () => {
    expect(uniquePhones(['', '   '])).toEqual([])
  })

  it('returns empty array for no input', () => {
    expect(uniquePhones([])).toEqual([])
  })
})