import { createFileRoute } from '@tanstack/react-router'
import { SyncCenter } from '@/features/channels/sync-center'

export const Route = createFileRoute('/_authenticated/op/channels/sync-center')({
  component: SyncCenter,
})
