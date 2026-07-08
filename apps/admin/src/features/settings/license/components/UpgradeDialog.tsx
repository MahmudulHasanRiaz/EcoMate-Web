import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Sparkles } from 'lucide-react'

interface UpgradeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlan?: { id: string; name: string; planType: string; price: number } | null
  expiry?: string | null
  featureCount: number
  dashboardUrl?: string | null
}

export function UpgradeDialog({ open, onOpenChange, currentPlan, expiry, featureCount, dashboardUrl }: UpgradeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Sparkles className='h-5 w-5 text-primary' />
            Upgrade Your Plan
          </DialogTitle>
          <DialogDescription>
            Unlock more features and higher limits by upgrading your subscription.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {currentPlan && (
            <div className='rounded-lg border bg-muted/30 p-4 space-y-2'>
              <p className='text-sm font-medium text-muted-foreground'>Current Plan</p>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='font-semibold text-lg'>{currentPlan.name}</p>
                  <p className='text-sm text-muted-foreground'>
                    {currentPlan.planType === 'monthly' ? 'Monthly' : 'Yearly'} &middot; ${currentPlan.price}/{currentPlan.planType === 'monthly' ? 'mo' : 'yr'}
                  </p>
                </div>
                <Badge variant='outline' className='text-xs'>
                  {featureCount} feature{featureCount !== 1 ? 's' : ''}
                </Badge>
              </div>
              {expiry && (
                <p className='text-xs text-muted-foreground pt-1'>
                  Expires: {new Date(expiry).toLocaleDateString()}
                </p>
              )}
            </div>
          )}

          <div className='rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3'>
            <div className='flex items-start gap-3'>
              <div className='rounded-full bg-primary/10 p-2 mt-0.5'>
                <ExternalLink className='h-4 w-4 text-primary' />
              </div>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Manage via KeyMate Dashboard</p>
                <p className='text-sm text-muted-foreground'>
                  Plan changes, payment updates, and subscription management are handled through your KeyMate account. Visit the KeyMate dashboard to compare plans and upgrade.
                </p>
              </div>
            </div>
            {dashboardUrl && (
              <Button
                variant='default'
                className='w-full gap-2'
                onClick={() => window.open(dashboardUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className='h-4 w-4' />
                Open KeyMate Dashboard
              </Button>
            )}
          </div>

          <div className='text-xs text-muted-foreground text-center'>
            Need help? Contact{' '}
            <a href='mailto:support@ecomate.com' className='underline hover:text-foreground'>
              support@ecomate.com
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
