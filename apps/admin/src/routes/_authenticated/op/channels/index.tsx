import { createFileRoute } from '@tanstack/react-router'
import { ChannelsOverview } from '@/features/channels'
export const Route = createFileRoute('/_authenticated/op/channels/')({ component: ChannelsOverview })
