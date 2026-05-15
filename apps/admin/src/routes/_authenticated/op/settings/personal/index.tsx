import { createFileRoute } from '@tanstack/react-router'
import { PersonalSettings } from '@/features/settings/personal-settings'
export const Route = createFileRoute('/_authenticated/op/settings/personal/')({ component: PersonalSettings })
