import { createFileRoute } from '@tanstack/react-router'
import { BlockSettingsPage } from '@/features/blocking/block-settings'

export const Route = createFileRoute('/_authenticated/mon/blocking-settings')({
  component: BlockSettingsPage,
})
