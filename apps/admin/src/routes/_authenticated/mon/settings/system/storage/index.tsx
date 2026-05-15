import { createFileRoute } from '@tanstack/react-router'
import { StorageSettings } from '@/features/settings/storage-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/system/storage/')({ component: StorageSettings })
