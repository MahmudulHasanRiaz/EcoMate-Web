import { describe, expect, it } from 'vitest'
import {
  adjustDialogKindForViewMode,
  MANAGED_ADJUST_TITLE,
  physicalAdjustTitle,
} from '../adjust-dialog-routing'

describe('adjustDialogKindForViewMode (Stock page routing by tab)', () => {
  it('Managed tab routes to the managed dialog', () => {
    expect(adjustDialogKindForViewMode('MANAGED')).toBe('managed')
  })

  it('Physical tab routes to the physical dialog', () => {
    expect(adjustDialogKindForViewMode('PHYSICAL')).toBe('physical')
  })
})

describe('dialog titles state which stock layer they record', () => {
  it('managed title names the managed quantity', () => {
    expect(MANAGED_ADJUST_TITLE).toBe('Adjust Managed Stock')
  })

  it('physical title names the physical record, with and without a product name', () => {
    expect(physicalAdjustTitle('Widget')).toBe('Adjust Physical Stock: Widget')
    expect(physicalAdjustTitle()).toBe('Adjust Physical Stock')
    expect(physicalAdjustTitle(null)).toBe('Adjust Physical Stock')
  })
})
