import { createFileRoute } from '@tanstack/react-router'
import { ChannelsStores } from '@/features/channels'
export const Route = createFileRoute('/_authenticated/op/channels/stores/')({ component: ChannelsStores })
