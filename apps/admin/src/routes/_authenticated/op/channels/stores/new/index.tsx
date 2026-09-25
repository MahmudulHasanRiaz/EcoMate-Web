import { createFileRoute } from '@tanstack/react-router'
import { StoreConnectPage } from '@/features/channels'
export const Route = createFileRoute('/_authenticated/op/channels/stores/new/')({ component: StoreConnectPage })
