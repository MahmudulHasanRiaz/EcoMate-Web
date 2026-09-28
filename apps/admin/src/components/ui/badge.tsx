import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default:
          'gloss-sheen border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'gloss-sheen border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'gloss-sheen border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        success:
          'gloss-sheen border-success/25 bg-success-soft text-success',
        danger:
          'gloss-sheen border-danger/25 bg-danger-soft text-danger',
        warning:
          'gloss-sheen border-warning/25 bg-warning-soft text-warning',
        info:
          'gloss-sheen border-info/25 bg-info-soft text-info',
        violet:
          'gloss-sheen border-accent-violet/25 bg-accent-violet-soft text-accent-violet',
        cyan:
          'gloss-sheen border-accent-cyan/25 bg-accent-cyan-soft text-accent-cyan',
        pink:
          'gloss-sheen border-accent-pink/25 bg-accent-pink-soft text-accent-pink',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot='badge'
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
