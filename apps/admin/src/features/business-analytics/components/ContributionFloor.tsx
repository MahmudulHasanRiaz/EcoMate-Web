import { PRODUCT_CONTRIBUTION_FLOOR_STATEMENT } from '../types'

/**
 * §2.6 contribution floor, stated verbatim on every product view: Product P&L
 * stops at Contribution — company operating expenses are never apportioned.
 */
export function ContributionFloor() {
  return (
    <p data-testid="contribution-floor" className="text-xs text-muted-foreground border-l-2 border-border pl-3">
      {PRODUCT_CONTRIBUTION_FLOOR_STATEMENT}
    </p>
  )
}
