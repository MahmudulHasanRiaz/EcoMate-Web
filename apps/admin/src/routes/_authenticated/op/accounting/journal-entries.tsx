import { createFileRoute } from '@tanstack/react-router'
import { JournalEntries } from '@/features/accounting/journal-entries'
export const Route = createFileRoute('/_authenticated/op/accounting/journal-entries')({ component: JournalEntries })
