import { createFileRoute } from '@tanstack/react-router'
import { ChannelStoreDetail } from '@/features/channels'
export const Route = createFileRoute('/_authenticated/op/channels/stores/$id')({ component: ChannelStoreDetail })
