import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  CountUp,
  StatusBadge,
  TrendChip,
  chartFillForName,
  kpiAccentForTitle,
  kpiIconForTitle,
  orderStatusTone,
} from '@/components/ui/dashboard'

describe('orderStatusTone', () => {
  it('maps pending → warning', () => {
    expect(orderStatusTone('Pending')).toBe('warning')
    expect(orderStatusTone('Awaiting Payment')).toBe('warning')
  })
  it('maps delivered/paid → success', () => {
    expect(orderStatusTone('Delivered')).toBe('success')
    expect(orderStatusTone('paid')).toBe('success')
  })
  it('maps cancelled/due/returned → danger', () => {
    expect(orderStatusTone('Cancelled')).toBe('danger')
    expect(orderStatusTone('Due')).toBe('danger')
    expect(orderStatusTone('returned')).toBe('danger')
  })
  it('maps processing → info', () => {
    expect(orderStatusTone('Processing')).toBe('info')
  })
  it('falls back to neutral', () => {
    expect(orderStatusTone('Archived')).toBe('neutral')
  })
})

describe('kpiAccentForTitle', () => {
  it('routes income topics to success', () => {
    expect(kpiAccentForTitle('Net Sales')).toBe('success')
    expect(kpiAccentForTitle('Cash Collected')).toBe('success')
    expect(kpiAccentForTitle('Gross Profit')).toBe('success')
  })
  it('routes cost topics to danger', () => {
    expect(kpiAccentForTitle('Total expense')).toBe('danger')
    expect(kpiAccentForTitle('Return Loss')).toBe('danger')
  })
  it('routes pending topics to warning', () => {
    expect(kpiAccentForTitle('Pending Payments')).toBe('warning')
  })
  it('routes stock topics to violet and customer topics to cyan', () => {
    expect(kpiAccentForTitle('Low Stock')).toBe('violet')
    expect(kpiAccentForTitle('New Customers')).toBe('cyan')
  })
})

describe('kpiIconForTitle', () => {
  it('returns a renderable icon per topic', () => {
    expect(kpiIconForTitle('Cash Collected').displayName ?? kpiIconForTitle('Cash Collected').name).toBeTruthy()
    expect(kpiIconForTitle('Mystery Metric').displayName ?? kpiIconForTitle('Mystery Metric').name).toBeTruthy()
  })
})

describe('chartFillForName', () => {
  it('uses semantic fills for known names', () => {
    expect(chartFillForName('Delivered', 3)).toBe('var(--success)')
    expect(chartFillForName('Cancelled', 0)).toBe('var(--danger)')
    expect(chartFillForName('Pending', 0)).toBe('var(--warning)')
    expect(chartFillForName('Processing', 0)).toBe('var(--info)')
  })
  it('cycles the shared palette for unknown names', () => {
    expect(chartFillForName('Facebook', 0)).toBe('var(--success)')
    expect(chartFillForName('TikTok', 1)).toBe('var(--info)')
  })
})

describe('StatusBadge', () => {
  it('renders color + icon + text together', () => {
    render(<StatusBadge tone="success">Delivered</StatusBadge>)
    expect(screen.getByText('Delivered')).toBeTruthy()
    const pill = screen.getByText('Delivered').closest('span')
    expect(pill?.className).toContain('bg-success-soft')
    expect(pill?.querySelector('svg')).toBeTruthy()
  })
})

describe('TrendChip', () => {
  it('renders up green and down red', () => {
    const { rerender } = render(<TrendChip direction="up">+5%</TrendChip>)
    expect(screen.getByText('+5%').closest('span')?.className).toContain('bg-success-soft')
    rerender(<TrendChip direction="down">-3%</TrendChip>)
    expect(screen.getByText('-3%').closest('span')?.className).toContain('bg-danger-soft')
  })
})

describe('CountUp', () => {
  it('renders the settled formatted value under test', () => {
    render(<CountUp value={1234} format={(v) => `৳${Math.round(v).toLocaleString()}`} />)
    expect(screen.getByText('৳1,234')).toBeTruthy()
  })
})
