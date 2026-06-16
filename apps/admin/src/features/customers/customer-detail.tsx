import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, ArrowLeft, Phone, Mail, ShoppingBag, DollarSign, Calendar, Shield, ShieldOff, Ban, Globe, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { useCustomerDetail, useBlockPhone, useUnblockPhone, useBlockedIps, useBlockIp, useUnblockIp } from './hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'

export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const navigate = useNavigate()
  const { data, isLoading } = useCustomerDetail(customerId)
  const blockMut = useBlockPhone()
  const unblockMut = useUnblockPhone()
  const { data: blockedIps } = useBlockedIps()
  const blockIpMut = useBlockIp()
  const unblockIpMut = useUnblockIp()
  const [newIp, setNewIp] = useState('')
  const [ipReason, setIpReason] = useState('')

  const isBlocked = data?.customer?.status === 'suspended'

  if (isLoading) {
    return (
      <div className='flex justify-center py-12'>
        <Loader2 className='animate-spin h-8 w-8' />
      </div>
    )
  }

  if (!data?.customer) {
    return (
      <>
        <Header fixed>
          <div className='me-auto' />
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main>
          <div className='p-6 text-muted-foreground text-center'>
            <p className='text-lg mb-4'>Customer not found</p>
            <Button variant='outline' onClick={() => navigate({ to: '/op/customers' })}>
              <ArrowLeft className='h-4 w-4 mr-1' /> Back to Customers
            </Button>
          </div>
        </Main>
      </>
    )
  }

  const { customer, summary, recentOrders } = data

  const handleBlockToggle = () => {
    if (isBlocked) {
      unblockMut.mutate(customer.id)
    } else {
      blockMut.mutate(customer.id)
    }
  }

  const handleBlockIp = () => {
    if (!newIp.trim()) return
    blockIpMut.mutate({ ip: newIp.trim(), reason: ipReason || undefined })
    setNewIp('')
    setIpReason('')
  }

  return (
    <>
      <Header fixed>
        <div className='me-auto flex items-center gap-4'>
          <Button variant='ghost' size='icon' onClick={() => navigate({ to: '/op/customers' })}>
            <ArrowLeft className='h-5 w-5' />
          </Button>
          <h1 className='text-lg font-semibold'>{customer.firstName} {customer.lastName}</h1>
          <Badge variant={isBlocked ? 'destructive' : 'secondary'}>
            {isBlocked ? 'Blocked' : 'Active'}
          </Badge>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='grid gap-4 md:grid-cols-3'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Total Orders</CardTitle>
              <ShoppingBag className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{summary?.totalOrders ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Total Spent</CardTitle>
              <DollarSign className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>৳{Number(summary?.totalSpent ?? 0).toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Last Order</CardTitle>
              <Calendar className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {summary?.lastOrderDate ? format(new Date(summary.lastOrderDate), 'MMM d, yyyy') : 'N/A'}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>Customer Information</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex items-center gap-2'>
                <span className='font-medium text-sm text-muted-foreground w-24 shrink-0'>Name:</span>
                <span>{customer.firstName} {customer.lastName}</span>
              </div>
              <div className='flex items-center gap-2'>
                <Phone className='h-4 w-4 text-muted-foreground shrink-0' />
                <span>{customer.phoneNumber}</span>
              </div>
              <div className='flex items-center gap-2'>
                <Mail className='h-4 w-4 text-muted-foreground shrink-0' />
                <span className='text-sm'>{customer.email}</span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='font-medium text-sm text-muted-foreground w-24 shrink-0'>Username:</span>
                <span className='text-sm'>{customer.username}</span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='font-medium text-sm text-muted-foreground w-24 shrink-0'>Role:</span>
                <Badge variant='outline'>{customer.role}</Badge>
              </div>
              <div className='flex items-center gap-2'>
                <Calendar className='h-4 w-4 text-muted-foreground shrink-0' />
                <span className='text-sm'>Registered: {format(new Date(customer.createdAt), 'MMM d, yyyy')}</span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='font-medium text-sm text-muted-foreground w-24 shrink-0'>Status:</span>
                <Badge variant={isBlocked ? 'destructive' : 'secondary'}>
                  {isBlocked ? 'Suspended' : 'Active'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>Actions</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div>
                <Label className='text-sm font-medium'>Phone Number</Label>
                <p className='text-sm text-muted-foreground mb-2'>{customer.phoneNumber}</p>
                <Button
                  variant={isBlocked ? 'default' : 'destructive'}
                  size='sm'
                  onClick={handleBlockToggle}
                  disabled={blockMut.isPending || unblockMut.isPending}
                >
                  {isBlocked ? (
                    <><Shield className='h-4 w-4 mr-1' /> Unblock Phone</>
                  ) : (
                    <><Ban className='h-4 w-4 mr-1' /> Block Phone</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {recentOrders && recentOrders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>Recent Orders ({recentOrders.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((order) => (
                      <TableRow key={order.id} className='cursor-pointer' onClick={() => navigate({ to: `/op/orders/${order.id}` })}>
                        <TableCell className='font-mono text-xs'>{order.displayId || order.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <Badge variant='outline' className='capitalize' style={{ borderColor: order.status.color, color: order.status.color }}>
                            {order.status.name}
                          </Badge>
                        </TableCell>
                        <TableCell>৳{Number(order.total).toFixed(2)}</TableCell>
                        <TableCell className='text-nowrap'>{format(new Date(order.createdAt), 'MMM d, yyyy')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-sm font-medium'>Blocked IPs</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-end gap-2'>
              <div className='flex-1'>
                <Label htmlFor='new-ip'>IP Address</Label>
                <Input id='new-ip' placeholder='192.168.1.1' value={newIp} onChange={(e) => setNewIp(e.target.value)} />
              </div>
              <div className='flex-1'>
                <Label htmlFor='ip-reason'>Reason (optional)</Label>
                <Input id='ip-reason' placeholder='Suspicious activity' value={ipReason} onChange={(e) => setIpReason(e.target.value)} />
              </div>
              <Button size='sm' onClick={handleBlockIp} disabled={!newIp.trim() || blockIpMut.isPending}>
                <Plus className='h-4 w-4 mr-1' /> Block IP
              </Button>
            </div>

            {blockedIps && blockedIps.length > 0 ? (
              <div className='overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Blocked At</TableHead>
                      <TableHead className='w-16' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blockedIps.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className='font-mono text-xs'>{entry.ip}</TableCell>
                        <TableCell className='text-sm text-muted-foreground'>{entry.reason || '-'}</TableCell>
                        <TableCell className='text-nowrap text-sm'>{format(new Date(entry.blockedAt), 'MMM d, yyyy HH:mm')}</TableCell>
                        <TableCell>
                          <Button variant='ghost' size='icon' className='h-8 w-8 text-destructive' onClick={() => unblockIpMut.mutate(entry.id)} disabled={unblockIpMut.isPending}>
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground text-center py-4'>No IPs blocked</p>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
