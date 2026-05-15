import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/transactions/')({
  component: () => <div className='p-8'>Financial Transactions (Coming Soon)</div>,
})
