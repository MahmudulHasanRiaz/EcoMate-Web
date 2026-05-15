import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/activity-logs/')({
  component: () => <div className='p-8'>Activity Logs (Coming Soon)</div>,
})
