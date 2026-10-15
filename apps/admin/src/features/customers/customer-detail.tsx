import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Loader2, ArrowLeft, Phone, Mail, ShoppingBag, Calendar, Shield, Ban,
  Globe, Plus, MapPin, Star, User, PackageCheck, PackageX, TrendingUp,
  History, Truck, CheckCircle2,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  useCustomerDetail, useBlockPhone, useUnblockPhone,
  useBlockIp, useUnblockIp, useBlockPhoneNumber, useUnblockPhoneNumber,
} from './hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '@/components/layout/header'
import { CopyButton } from '@/components/copy-button'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { CourierCustomerHistoryCard } from '@/features/orders/courier-customer-history-card'
import { CreditBalanceCard } from './components/credit-balance-card'
import { cn } from '@/lib/utils'

function initials(firstName?: string | null, lastName?: string | null) {
  return `${(firstName || '?')[0] || '?'}${(lastName || '')[0] || ''}`.toUpperCase()
}

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card className='shadow-2xs'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-1.5 px-4 pt-3.5'>
        <CardTitle className='text-xs font-medium text-muted-foreground'>{label}</CardTitle>
        <Icon className='h-4 w-4 text-muted-foreground shrink-0' />
      </CardHeader>
      <CardContent className='px-4 pb-3.5'>
        <div className='text-xl sm:text-2xl font-bold tracking-tight'>{value}</div>
        {sub && <p className='text-[11px] text-muted-foreground mt-0.5'>{sub}</p>}
      </CardContent>
    </Card>
  )
}

function SectionTitle({ icon: Icon, title, hint, action }: { icon: any; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <div className='flex items-center gap-2'>
        <Icon className='h-4 w-4 text-primary shrink-0' />
        <h3 className='text-sm sm:text-base font-semibold tracking-tight'>{title}</h3>
        {hint && <span className='text-[11px] text-muted-foreground hidden sm:inline'>{hint}</span>}
      </div>
      {action}
    </div>
  )
}

export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const navigate = useNavigate()
  const { data, isLoading } = useCustomerDetail(customerId)
  const blockMut = useBlockPhone()
  const unblockMut = useUnblockPhone()
  const blockIpMut = useBlockIp()
  const unblockIpMut = useUnblockIp()
  const blockPhoneMut = useBlockPhoneNumber()
  const unblockPhoneMut = useUnblockPhoneNumber()
  const [newIp, setNewIp] = useState('')
  const [ipReason, setIpReason] = useState('')
  const [historyPhone, setHistoryPhone] = useState<string | null>(null)

  const isBlocked = data?.customer?.status === 'suspended'

  if (isLoading) {
    return (
      <>
        <Header fixed>
          <div className='me-auto' />
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className='flex flex-1 flex-col gap-4'>
          <div className='h-28 rounded-xl border bg-card animate-pulse' />
          <div className='grid grid-cols-2 lg:grid-cols-5 gap-3'>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className='h-20 rounded-xl border bg-card animate-pulse' />
            ))}
          </div>
          <div className='h-64 rounded-xl border bg-card animate-pulse' />
        </Main>
      </>
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

  const { customer, summary, stats, phones, ips, addresses, recentOrders } = data
  const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer'
  const activeHistoryPhone = historyPhone || phones?.[0]?.phone || customer.phoneNumber

  const handleBlockToggle = () => {
    if (isBlocked) unblockMut.mutate(customer.id)
    else blockMut.mutate(customer.id)
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
        <div className='me-auto flex items-center gap-2 sm:gap-3 min-w-0'>
          <Button variant='ghost' size='icon' className='shrink-0' onClick={() => navigate({ to: '/op/customers' })}>
            <ArrowLeft className='h-5 w-5' />
          </Button>
          <div className='size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0'>
            {initials(customer.firstName, customer.lastName)}
          </div>
          <h1 className='text-base sm:text-lg font-semibold truncate'>{fullName}</h1>
          <Badge variant={isBlocked ? 'destructive' : 'secondary'} className='shrink-0'>
            {isBlocked ? 'Blocked' : 'Active'}
          </Badge>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-5'>
        {/* Profile + account action */}
        <Card className='shadow-2xs overflow-hidden'>
          <CardContent className='p-4 sm:p-5'>
            <div className='flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4'>
              <div className='size-14 rounded-2xl bg-primary/10 text-primary hidden sm:flex items-center justify-center text-xl font-bold shrink-0'>
                {initials(customer.firstName, customer.lastName)}
              </div>
              <div className='min-w-0 flex-1 space-y-1.5'>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
                  <span className='inline-flex items-center gap-1.5 font-mono font-semibold'>
                    <Phone className='h-3.5 w-3.5 text-muted-foreground' />
                    {customer.phoneNumber}
                    <CopyButton text={customer.phoneNumber} label='Phone' />
                  </span>
                  {customer.email && (
                    <span className='inline-flex items-center gap-1.5 text-muted-foreground min-w-0'>
                      <Mail className='h-3.5 w-3.5 shrink-0' />
                      <span className='truncate'>{customer.email}</span>
                    </span>
                  )}
                </div>
                <p className='text-[11px] sm:text-xs text-muted-foreground'>
                  @{customer.username} · Joined {format(new Date(customer.createdAt), 'MMM d, yyyy')}
                  {phones && phones.length > 1 && (
                    <span className='ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-px font-medium'>
                      <Star className='h-3 w-3' /> {phones.length} linked numbers
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant={isBlocked ? 'default' : 'destructive'}
                size='sm'
                className='w-full sm:w-auto shrink-0 cursor-pointer'
                onClick={handleBlockToggle}
                disabled={blockMut.isPending || unblockMut.isPending}
              >
                {isBlocked ? (
                  <><Shield className='h-4 w-4 mr-1' /> Unblock Account</>
                ) : (
                  <><Ban className='h-4 w-4 mr-1' /> Block Account</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3'>
          <Kpi icon={ShoppingBag} label='Total Orders' value={String(summary?.totalOrders ?? 0)} />
          <Kpi icon={TrendingUp} label='Total Spent' value={`৳${Number(summary?.totalSpent ?? 0).toLocaleString()}`} sub={stats ? `Avg ৳${Number(stats.avgOrderValue ?? 0).toLocaleString()}/order` : undefined} />
          <Kpi
            icon={PackageCheck}
            label='Delivered'
            value={String(stats?.delivered ?? 0)}
            sub={stats ? `${stats.successRate}% success rate` : undefined}
          />
          <Kpi icon={PackageX} label='Cancelled' value={String(stats?.cancelled ?? 0)} />
          <Kpi
            icon={Calendar}
            label='Last Order'
            value={summary?.lastOrderDate ? format(new Date(summary.lastOrderDate), 'MMM d, yyyy') : 'N/A'}
          />
        </div>

        {/* Store credit — live balance + mini-ledger (overpayment grants, order applies) */}
        <CreditBalanceCard customerId={customer.id} />

        <div className='grid gap-4 sm:gap-5 lg:grid-cols-2'>
          {/* Linked phone numbers */}
          <Card className='shadow-2xs'>
            <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
              <SectionTitle icon={Phone} title={`Phone Numbers (${phones?.length ?? 0})`} hint='any linked number finds this customer' />
            </CardHeader>
            <CardContent className='px-4 sm:px-5 pb-4 space-y-2'>
              {(phones?.length ?? 0) === 0 && (
                <p className='text-sm text-muted-foreground text-center py-4'>No phone numbers on record.</p>
              )}
              {phones?.map((p) => (
                <div key={p.phone} className='flex items-center gap-2.5 rounded-xl border bg-muted/20 px-3 py-2'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5 flex-wrap'>
                      <span className='font-mono text-sm font-semibold'>{p.phone}</span>
                      <CopyButton text={p.phone} label='Phone' />
                    </div>
                    <div className='flex items-center gap-1 mt-1 flex-wrap'>
                      <Badge variant='outline' className={cn('text-[10px] h-4.5 font-normal', p.isPrimary ? 'border-primary/30 text-primary' : 'border-border/70 text-muted-foreground')}>
                        {p.isPrimary ? 'Primary' : 'Secondary'}
                      </Badge>
                      {p.blocked && (
                        <Badge variant='destructive' className='text-[10px] h-4.5 font-normal'>Blocked</Badge>
                      )}
                    </div>
                  </div>
                  {p.blocked && p.blockId ? (
                    <Button
                      variant='outline' size='sm'
                      className='h-7 text-xs shrink-0 cursor-pointer'
                      disabled={unblockPhoneMut.isPending}
                      onClick={() => unblockPhoneMut.mutate(p.blockId!)}
                    >
                      <Shield className='h-3 w-3 mr-1' /> Unblock
                    </Button>
                  ) : (
                    <Button
                      variant='ghost' size='sm'
                      className='h-7 text-xs shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer'
                      disabled={blockPhoneMut.isPending}
                      onClick={() => blockPhoneMut.mutate({ phone: p.phone, reason: `Customer: ${fullName}` })}
                      title='Block this number from ordering'
                    >
                      <Ban className='h-3 w-3 mr-1' /> Block
                    </Button>
                  )}
                </div>
              ))}
              <p className='text-[11px] text-muted-foreground pt-1'>
                Add a secondary number from any order (create/edit) — it links here automatically.
              </p>
            </CardContent>
          </Card>

          {/* Address book */}
          <Card className='shadow-2xs'>
            <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
              <SectionTitle icon={MapPin} title='Address Book' hint={`${addresses?.shipping?.length ?? 0} shipping · ${addresses?.billing?.length ?? 0} billing`} />
            </CardHeader>
            <CardContent className='px-4 sm:px-5 pb-4 space-y-4'>
              <div>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5'>
                  Shipping Addresses ({addresses?.shipping?.length ?? 0})
                </p>
                {(addresses?.shipping?.length ?? 0) === 0 ? (
                  <p className='text-sm text-muted-foreground rounded-xl border border-dashed px-3 py-3 text-center'>No saved shipping address.</p>
                ) : (
                  <div className='space-y-2'>
                    {addresses!.shipping.map((a, i) => (
                      <div key={a.id} className='flex gap-2.5 rounded-xl border bg-muted/20 px-3 py-2.5'>
                        <span className='size-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5'>
                          {i + 1}
                        </span>
                        <div className='min-w-0 text-xs sm:text-sm'>
                          <p className='font-semibold'>{a.fullName} <span className='font-mono font-normal text-muted-foreground'>· {a.phone}</span></p>
                          <p className='text-muted-foreground leading-relaxed'>
                            {a.addressLine}{a.area ? `, ${a.area}` : ''}{a.thana ? `, ${a.thana}` : ''}{a.district ? `, ${a.district}` : ''}{a.postalCode ? ` ${a.postalCode}` : ''}
                          </p>
                          {a.isDefault && <Badge variant='outline' className='text-[10px] h-4 mt-1 border-primary/30 text-primary'>Default</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5'>
                  {(addresses?.billing?.length ?? 0) === 1 ? 'Billing Address' : `Billing Addresses (${addresses?.billing?.length ?? 0})`}
                </p>
                {(addresses?.billing?.length ?? 0) === 0 ? (
                  <p className='text-sm text-muted-foreground rounded-xl border border-dashed px-3 py-3 text-center'>Same as shipping.</p>
                ) : (
                  <div className='space-y-2'>
                    {addresses!.billing.map((a) => (
                      <div key={a.id} className='flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5'>
                        <MapPin className='h-4 w-4 text-amber-600 shrink-0 mt-0.5' />
                        <div className='min-w-0 text-xs sm:text-sm'>
                          <p className='font-semibold'>{a.fullName} <span className='font-mono font-normal text-muted-foreground'>· {a.phone}</span></p>
                          <p className='text-muted-foreground leading-relaxed'>
                            {a.addressLine}{a.area ? `, ${a.area}` : ''}{a.thana ? `, ${a.thana}` : ''}{a.district ? `, ${a.district}` : ''}{a.postalCode ? ` ${a.postalCode}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customer IPs — only THIS customer's, with inline block state */}
        <Card className='shadow-2xs'>
          <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
            <SectionTitle icon={Globe} title={`IP Addresses (${ips?.length ?? 0})`} hint='seen on this customer&apos;s orders' />
          </CardHeader>
          <CardContent className='px-4 sm:px-5 pb-4 space-y-3'>
            <div className='flex flex-col sm:flex-row sm:items-end gap-2'>
              <div className='flex-1'>
                <Label htmlFor='new-ip' className='text-xs'>IP Address</Label>
                <Input id='new-ip' placeholder='192.168.1.1' value={newIp} onChange={(e) => setNewIp(e.target.value)} className='h-9 text-sm font-mono' />
              </div>
              <div className='flex-[2]'>
                <Label htmlFor='ip-reason' className='text-xs'>Reason (optional)</Label>
                <Input id='ip-reason' placeholder='Suspicious activity' value={ipReason} onChange={(e) => setIpReason(e.target.value)} className='h-9 text-sm' />
              </div>
              <Button size='sm' className='h-9 shrink-0 cursor-pointer' onClick={handleBlockIp} disabled={!newIp.trim() || blockIpMut.isPending}>
                <Plus className='h-4 w-4 mr-1' /> Block IP
              </Button>
            </div>

            {(ips?.length ?? 0) === 0 ? (
              <p className='text-sm text-muted-foreground text-center py-4'>No IPs recorded for this customer yet.</p>
            ) : (
              <div className='overflow-x-auto rounded-xl border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead className='text-right'>Orders</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='text-right'>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ips!.map((entry) => (
                      <TableRow key={entry.ip}>
                        <TableCell className='font-mono text-xs whitespace-nowrap'>
                          {entry.ip} <CopyButton text={entry.ip} label='IP' />
                        </TableCell>
                        <TableCell className='text-right font-semibold'>×{entry.orderCount}</TableCell>
                        <TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
                          {formatDistanceToNow(new Date(entry.lastSeen), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          {entry.blocked ? (
                            <Badge variant='destructive' className='text-[10px] whitespace-nowrap'>Blocked</Badge>
                          ) : (
                            <Badge variant='outline' className='text-[10px] text-emerald-600 border-emerald-500/30 whitespace-nowrap'>
                              <CheckCircle2 className='h-3 w-3 mr-1' /> Clean
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          {entry.blocked && entry.blockId ? (
                            <Button variant='outline' size='sm' className='h-7 text-xs cursor-pointer' disabled={unblockIpMut.isPending} onClick={() => unblockIpMut.mutate(entry.blockId!)}>
                              Unblock
                            </Button>
                          ) : (
                            <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer' disabled={blockIpMut.isPending} onClick={() => blockIpMut.mutate({ ip: entry.ip, reason: `Customer: ${fullName}` })}>
                              Block
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order history + performance */}
        <Card className='shadow-2xs'>
          <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
            <SectionTitle
              icon={History}
              title={`Order History (${summary?.totalOrders ?? 0})`}
              hint={stats ? `${stats.delivered} delivered · ${stats.successRate}% success` : undefined}
              action={
                <Link to='/op/orders' className='text-xs font-medium text-primary hover:underline cursor-pointer'>
                  View all in Orders →
                </Link>
              }
            />
          </CardHeader>
          <CardContent className='px-4 sm:px-5 pb-4'>
            {(recentOrders?.length ?? 0) === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                <User className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm'>No orders yet.</p>
              </div>
            ) : (
              <div className='overflow-x-auto rounded-xl border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='text-right'>Items</TableHead>
                      <TableHead className='text-right'>Total</TableHead>
                      <TableHead className='text-right'>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders!.map((order) => (
                      <TableRow key={order.id} className='cursor-pointer hover:bg-muted/40' onClick={() => navigate({ to: `/op/orders/${order.id}` })}>
                        <TableCell>
                          <span className='font-mono text-xs font-semibold text-primary whitespace-nowrap'>
                            {order.displayId || order.id.slice(0, 8)}
                          </span>
                          {(order as any).secondaryPhone && (
                            <span className='ml-1.5 rounded border border-border/60 px-1 py-px font-mono text-[10px] text-muted-foreground whitespace-nowrap'>
                              2nd {(order as any).secondaryPhone}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline' className='capitalize text-[11px] whitespace-nowrap' style={{ borderColor: order.status.color, color: order.status.color }}>
                            {order.status.name}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right font-semibold'>×{order._count?.items ?? '—'}</TableCell>
                        <TableCell className='text-right font-semibold whitespace-nowrap'>৳{Number(order.total).toLocaleString()}</TableCell>
                        <TableCell className='text-right text-xs text-muted-foreground whitespace-nowrap'>{format(new Date(order.createdAt), 'MMM d, yyyy')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Courier history for the DB-saved numbers */}
        <Card className='shadow-2xs'>
          <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
            <SectionTitle icon={Truck} title='Courier History' hint='success/fraud record per saved number' />
          </CardHeader>
          <CardContent className='px-4 sm:px-5 pb-4 space-y-3'>
            {(phones?.length ?? 0) > 1 && (
              <div className='flex gap-1.5 flex-wrap'>
                {phones!.map((p) => (
                  <button
                    key={p.phone}
                    type='button'
                    onClick={() => setHistoryPhone(p.phone)}
                    className={cn(
                      'rounded-full border px-3 py-1 font-mono text-xs transition-colors cursor-pointer',
                      activeHistoryPhone === p.phone
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:border-foreground/30',
                    )}
                  >
                    {p.phone}
                  </button>
                ))}
              </div>
            )}
            {activeHistoryPhone ? (
              <CourierCustomerHistoryCard phone={activeHistoryPhone} />
            ) : (
              <p className='text-sm text-muted-foreground text-center py-4'>No phone number to look up.</p>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
