import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/campaigns/')({
  component: () => <div className='p-8'>Marketing Campaigns (Coming Soon)</div>,
})
