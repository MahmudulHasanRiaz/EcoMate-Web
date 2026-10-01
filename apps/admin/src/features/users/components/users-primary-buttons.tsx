import { UserPlus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function UsersPrimaryButtons() {
  const navigate = useNavigate()
  return (
    <div className='flex gap-2'>
      {/* "Invite User" was removed: POST /users/invite is a backend stub that
          sends no mail and persists nothing, so the button only ever showed a
          false success. Account creation happens on the dedicated page. */}
      <Button className='space-x-1' onClick={() => navigate({ to: '/mon/users/create' })}>
        <span>Create User</span> <UserPlus size={18} />
      </Button>
    </div>
  )
}