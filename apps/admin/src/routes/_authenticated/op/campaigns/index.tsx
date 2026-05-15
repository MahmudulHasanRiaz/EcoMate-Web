import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/campaigns/')({
  component: () => <div className="p-6 text-muted-foreground">campaigns page</div>,
})
