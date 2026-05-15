import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/analytics/')({
  component: () => <div className='p-8'>Analytics Dashboard (Coming Soon)</div>,
})
