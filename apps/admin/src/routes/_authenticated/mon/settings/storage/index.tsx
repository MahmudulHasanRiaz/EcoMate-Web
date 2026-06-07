import { createFileRoute } from '@tanstack/react-router'
import { StorageSettings } from '@/features/settings/storage'
export const Route = createFileRoute('/_authenticated/mon/settings/storage/')({ component: StorageSettings })
