import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/chats/')({
  component: () => <div className="p-6 text-muted-foreground">chats page</div>,
})
