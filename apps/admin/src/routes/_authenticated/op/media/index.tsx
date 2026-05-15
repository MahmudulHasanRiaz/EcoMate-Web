import { createFileRoute } from '@tanstack/react-router'
import { Media } from '@/features/media'
export const Route = createFileRoute('/_authenticated/op/media/')({ component: Media })
