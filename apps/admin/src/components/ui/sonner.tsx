import { Toaster as Sonner, ToasterProps, toast } from 'sonner'
import { useTheme } from '@/context/theme-provider'

/**
 * Error toasts must outlive success toasts so a failure is never missed:
 * errors get a longer lifetime + close button, success stays brief (the
 * Toaster-level default). Per-call options still win.
 */
export const ERROR_TOAST_DURATION = 8000

const originalToastError = toast.error
toast.error = ((message: Parameters<typeof toast.error>[0], data?: Parameters<typeof toast.error>[1]) =>
  originalToastError(message, { duration: ERROR_TOAST_DURATION, closeButton: true, ...data })) as typeof toast.error

export function Toaster({ ...props }: ToasterProps) {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group [&_div[data-content]]:w-full'
      // richColors gives every toast type its own palette (sonner's built-in
      // light + dark scales) plus the type icon — success/error/warning/info
      // are distinguishable at a glance. Do NOT force a uniform
      // background/color here: that flattens all types into the same look.
      richColors
      toastOptions={{
        className: 'rounded-lg border shadow-pop',
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
