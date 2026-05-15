import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/analytics/')({
  component: () => <div className="p-6 text-muted-foreground">analytics page</div>,
})
