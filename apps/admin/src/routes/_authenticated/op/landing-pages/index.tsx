import { createFileRoute } from '@tanstack/react-router'
import { LandingPages } from '@/features/landing-pages'

export const Route = createFileRoute('/_authenticated/op/landing-pages')({
  component: LandingPages,
})
