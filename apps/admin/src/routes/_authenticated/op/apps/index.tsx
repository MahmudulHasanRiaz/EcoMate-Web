import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/apps/')({
  component: () => <div className="p-6 text-muted-foreground">apps page</div>,
})
