import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/help-center/')({
  component: () => <div className="p-6 text-muted-foreground">help-center page</div>,
})
