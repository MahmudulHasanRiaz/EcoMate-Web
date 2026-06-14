import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { usersApi, type UserResponse } from '@/features/users/api'
import { Mail, Phone, Calendar, Shield, User } from 'lucide-react'

function getInitials(firstName?: string, lastName?: string, email?: string): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase()
  if (firstName) return firstName[0].toUpperCase()
  if (email) return email[0].toUpperCase()
  return '?'
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface UserBadgeProps {
  email?: string
  userId?: string
  user?: UserResponse
  showEmail?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function UserBadge({ email, userId, user: propUser, showEmail = true, size = 'sm', className = '' }: UserBadgeProps) {
  const [open, setOpen] = useState(false)

  const { data: fetchedUser, isLoading } = useQuery({
    queryKey: ['user-badge', userId || email],
    queryFn: () => {
      if (userId) return usersApi.get(userId).then(r => r.data)
      if (email) return usersApi.findByEmail(email).then(r => r.data)
      return Promise.reject(new Error('No identifier provided'))
    },
    enabled: !propUser && !!(userId || email),
    staleTime: 120_000,
    retry: false,
  })

  const u = propUser || fetchedUser
  const initials = u ? getInitials(u.firstName, u.lastName, u.email) : email ? getInitials(undefined, undefined, email) : '?'
  const displayName = u ? `${u.firstName} ${u.lastName}` : email || 'Unknown'
  const sizeClass = size === 'sm' ? 'h-6 w-6 text-[10px]' : size === 'md' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  const roleColor: Record<string, string> = {
    superadmin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    moderator: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    sales_executive: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    cashier: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    customer: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-md transition-colors hover:bg-muted/50 px-1 -mx-1 ${className}`}
      >
        <Avatar className={sizeClass}>
          <AvatarFallback className="text-[10px] font-medium">{initials}</AvatarFallback>
        </Avatar>
        <span className={`font-medium truncate ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{displayName}</span>
        {showEmail && u?.email && size !== 'sm' && (
          <span className="text-xs text-muted-foreground hidden sm:inline">{u.email}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
              </Avatar>
              <span>{u ? `${u.firstName} ${u.lastName}` : email || 'User'}</span>
            </DialogTitle>
          </DialogHeader>
          {isLoading && (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          )}
          {u && (
            <div className="space-y-3 py-1">
              <Card>
                <CardContent className="p-3 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{u.email}</span>
                  </div>
                  {u.phoneNumber && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>{u.phoneNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${roleColor[u.role] || ''}`}>
                      {u.role.replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${u.status === 'active' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' : 'text-muted-foreground'}`}>
                      {u.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Joined {formatDate(u.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          {!u && !isLoading && (
            <p className="text-sm text-muted-foreground text-center py-4">
              <User className="h-6 w-6 mx-auto mb-2 opacity-40" />
              User not found
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
