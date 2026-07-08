import { createFileRoute } from '@tanstack/react-router'
import { LicenseDeniedError } from '@/features/errors/license-denied'

export const Route = createFileRoute('/(errors)/license-denied')({
  validateSearch: (search: Record<string, string | undefined>) => ({
    feature: search.feature as string | undefined,
  }),
  component: LicenseDeniedError,
})
