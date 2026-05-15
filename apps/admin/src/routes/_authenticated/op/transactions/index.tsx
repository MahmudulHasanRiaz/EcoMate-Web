import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/transactions/')({
  component: () => <div className="p-6 text-muted-foreground">transactions page</div>,
})
