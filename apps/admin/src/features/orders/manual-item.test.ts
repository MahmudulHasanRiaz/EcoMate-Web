import { describe, expect, it } from 'vitest'
import {
  buildManualCartItem,
  cartItemFromManualOrderItem,
  isCostNotSet,
  manualItemPayload,
  orderLineName,
  validateManualForm,
} from './manual-item'

describe('validateManualForm', () => {
  const base = { name: 'Gift wrap', quantity: '2', price: '150', cost: '' }

  it('accepts a complete form with the cost left blank', () => {
    expect(validateManualForm(base)).toBeNull()
  })

  it('accepts a form with a cost', () => {
    expect(validateManualForm({ ...base, cost: '90' })).toBeNull()
  })

  it('requires a name', () => {
    expect(validateManualForm({ ...base, name: '  ' })).toMatch(/name/i)
  })

  it('requires a positive whole quantity', () => {
    expect(validateManualForm({ ...base, quantity: '0' })).toMatch(/quantity/i)
    expect(validateManualForm({ ...base, quantity: '1.5' })).toMatch(/quantity/i)
  })

  it('requires a non-negative price', () => {
    expect(validateManualForm({ ...base, price: '' })).toMatch(/price/i)
    expect(validateManualForm({ ...base, price: '-5' })).toMatch(/price/i)
  })

  it('rejects a negative cost but allows it blank', () => {
    expect(validateManualForm({ ...base, cost: '-1' })).toMatch(/cost/i)
    expect(validateManualForm({ ...base, cost: '' })).toBeNull()
  })
})

describe('buildManualCartItem + payload round-trip', () => {
  it('with cost: cart line carries it and the payload sends it as cost', () => {
    const cart = buildManualCartItem({
      name: '  Extra packaging ',
      quantity: '3',
      price: '200',
      cost: '120',
    })
    expect(cart.isManual).toBe(true)
    expect(cart.manualName).toBe('Extra packaging')
    expect(cart.productId).toBeNull()
    expect(cart.product.name).toBe('Extra packaging')
    expect(cart.costType).toBe('actual')

    const payload = manualItemPayload(cart)
    expect(payload).toEqual({
      isManual: true,
      manualName: 'Extra packaging',
      quantity: 3,
      price: 200,
      cost: 120,
    })
  })

  it('without cost: payload omits cost and the line is flagged not_set', () => {
    const cart = buildManualCartItem({
      name: 'Home delivery surcharge',
      quantity: '1',
      price: '80',
      cost: '',
    })
    expect(cart.costType).toBe('not_set')
    expect(isCostNotSet(cart)).toBe(true)

    const payload = manualItemPayload(cart)
    expect(payload).toEqual({
      isManual: true,
      manualName: 'Home delivery surcharge',
      quantity: 1,
      price: 80,
    })
    expect('cost' in payload).toBe(false)
    expect('productId' in payload).toBe(false)
  })
})

describe('cartItemFromManualOrderItem (edit hydration)', () => {
  it('restores an actual-cost line with its cost for the payload', () => {
    const cart = cartItemFromManualOrderItem({
      id: 'item-1',
      isManual: true,
      manualName: 'Fragile handling',
      quantity: 2,
      price: '300',
      costSnapshot: '180',
      costType: 'actual',
      product: null,
    })
    expect(cart.product.name).toBe('Fragile handling')
    expect(manualItemPayload(cart)).toEqual({
      isManual: true,
      manualName: 'Fragile handling',
      quantity: 2,
      price: 300,
      cost: 180,
    })
    expect(isCostNotSet(cart)).toBe(false)
  })

  it('restores a not_set line without inventing a cost', () => {
    const cart = cartItemFromManualOrderItem({
      id: 'item-2',
      isManual: true,
      manualName: 'Misc',
      quantity: 1,
      price: '50',
      // Server froze costSnapshot = price for a not_set line; it must NOT
      // round-trip back as a staff-entered cost.
      costSnapshot: '50',
      costType: 'not_set',
      product: null,
    })
    expect(isCostNotSet(cart)).toBe(true)
    const payload = manualItemPayload(cart)
    expect('cost' in payload).toBe(false)
  })
})

describe('orderLineName', () => {
  it('prefers the product name, falls back to the manual name', () => {
    expect(orderLineName({ product: { name: 'Wallet' } })).toBe('Wallet')
    expect(orderLineName({ product: null, manualName: 'Gift wrap' })).toBe(
      'Gift wrap',
    )
    expect(orderLineName({ product: null })).toBe('Item')
  })
})
