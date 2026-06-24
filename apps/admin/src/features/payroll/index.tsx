import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus, CheckCircle, FileText } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { DataTablePagination } from '@/components/data-table-pagination'
import { payrollApi, type PayslipResponse } from './api'

const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  approved: 'default',
  paid: 'outline',
  cancelled: 'destructive',
}

export function Payroll() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-payslips', page],
    queryFn: () => payrollApi.listPayslips({ page, perPage }).then(r => r.data),
  })

  const payslips: PayslipResponse[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  const approveMut = useMutation({
    mutationFn: payrollApi.approvePayslip,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-payslips'] }); toast.success('Payslip approved') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Payroll</h2>
            <p className='text-muted-foreground'>Manage employee payslips and salary structures.</p>
          </div>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Payslips</CardTitle>
              <CardDescription>All generated payslips across employees.</CardDescription>
            </CardHeader>
            <CardContent>
              {payslips.length === 0 ? (
                <div className='text-center py-12 text-muted-foreground'>No payslips generated yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Earnings</TableHead>
                      <TableHead>Deductions</TableHead>
                      <TableHead>Net Pay</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='w-24'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payslips.map(ps => (
                      <TableRow key={ps.id}>
                        <TableCell className='font-medium'>{ps.employee?.firstName} {ps.employee?.lastName}</TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {new Date(ps.periodStart).toLocaleDateString()} - {new Date(ps.periodEnd).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{Number(ps.totalEarnings).toLocaleString()} ৳</TableCell>
                        <TableCell className='text-destructive'>{Number(ps.totalDeductions).toLocaleString()} ৳</TableCell>
                        <TableCell className='font-semibold'>{Number(ps.netPay).toLocaleString()} ৳</TableCell>
                        <TableCell><Badge variant={statusVariant[ps.status] || 'secondary'}>{ps.status}</Badge></TableCell>
                        <TableCell>
                          <div className='flex gap-1'>
                            {ps.status === 'draft' && (
                              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => approveMut.mutate(ps.id)} title='Approve'>
                                <CheckCircle className='h-3.5 w-3.5 text-green-600' />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {meta && <DataTablePagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPageChange={setPage} />}
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}
