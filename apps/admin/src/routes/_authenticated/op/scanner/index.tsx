import { createFileRoute } from '@tanstack/react-router'
import ScannerPage from '@/features/scanner'

export const Route = createFileRoute('/_authenticated/op/scanner/')({
  component: ScannerPage,
})
