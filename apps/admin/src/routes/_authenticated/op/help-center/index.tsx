import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/help-center/')({
  component: () => <div className='p-8'>Operational Help Center (Coming Soon)</div>,
})
