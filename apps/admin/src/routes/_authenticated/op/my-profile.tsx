import { createFileRoute } from '@tanstack/react-router'
import { MyProfilePage } from '@/features/my-profile'

export const Route = createFileRoute('/_authenticated/op/my-profile')({
  component: MyProfilePage,
})
