import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/activity-logs/')({
  component: () => <div className="p-6 text-muted-foreground">activity-logs page</div>,
})
