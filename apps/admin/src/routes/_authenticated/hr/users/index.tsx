import { createFileRoute } from '@tanstack/react-router'
import { Users } from '@/features/users'

export const Route = createFileRoute('/_authenticated/hr/users/')({ component: Users })