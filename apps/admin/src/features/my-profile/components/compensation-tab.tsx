import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Wallet, Receipt, Award, CircleDollarSign, Loader2, ArrowUpRight } from 'lucide-react'
import {
  useMySalaryQuery,
  useMyPayslipsQuery,
  useMyCommissionsQuery,
  useMyEarningsQuery,
} from '../hooks'
import { MyPayslipDialog } from './my-payslip-detail'
import { PAYSLIP_STATUS_BADGE } from '@/features/payroll/components/payslip-status-badge'
import type { MyProfileResponse } from '../api'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function CompensationTab({ profile }: { profile?: MyProfileResponse }) {
  const { data: salaryStructure, isLoading: salaryLoading } = useMySalaryQuery()
  const [payslipPage, setPayslipPage] = useState(1)
  const { data: payslipsData, isLoading: payslipsLoading } = useMyPayslipsQuery(payslipPage, 20)
  const { data: commissionsData, isLoading: commissionsLoading } = useMyCommissionsQuery(1, 20)
  const { data: earningsData, isLoading: earningsLoading } = useMyEarningsQuery(1, 20)

  const [selectedPayslipId, setSelectedPayslipId] = useState<string | null>(null)

  const structure = salaryStructure || profile?.salaryStructures?.[0]
  const payslips = payslipsData?.data || []
  const commissions = commissionsData?.data || []
  const earnings = earningsData?.data || []

  return (
    <div className="space-y-6">
      {/* Current Salary Structure Card */}
      <Card className="border-border/60 bg-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Current Salary Structure
              </CardTitle>
              <CardDescription>
                Detailed breakdown of your gross earnings, statutory allowances, and deductions.
              </CardDescription>
            </div>
            {structure?.effectiveFrom && (
              <Badge variant="outline" className="text-xs">
                Effective: {formatDate(structure.effectiveFrom)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {salaryLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !structure ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Salary structure is not configured yet.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Earnings Column */}
                <div className="space-y-2.5 p-4 rounded-xl border border-border/50 bg-muted/20">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Earnings Breakdown
                  </p>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <span className="text-muted-foreground">Basic Salary</span>
                    <span className="text-right font-medium">{Number(structure.basicSalary || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">House Allowance</span>
                    <span className="text-right font-medium">{Number(structure.houseAllowance || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">Medical Allowance</span>
                    <span className="text-right font-medium">{Number(structure.medicalAllowance || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">Transport Allowance</span>
                    <span className="text-right font-medium">{Number(structure.transportAllowance || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">Other Allowance</span>
                    <span className="text-right font-medium">{Number(structure.otherAllowance || 0).toLocaleString()} ৳</span>
                    <div className="col-span-2 border-t pt-2 mt-1 flex justify-between font-semibold">
                      <span>Total Earnings</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {Number(structure.totalEarnings || 0).toLocaleString()} ৳
                      </span>
                    </div>
                  </div>
                </div>

                {/* Deductions Column */}
                <div className="space-y-2.5 p-4 rounded-xl border border-border/50 bg-muted/20">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Deductions Breakdown
                  </p>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <span className="text-muted-foreground">Tax Deduction</span>
                    <span className="text-right font-medium">{Number(structure.taxDeduction || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">Insurance Deduction</span>
                    <span className="text-right font-medium">{Number(structure.insuranceDeduction || 0).toLocaleString()} ৳</span>
                    <span className="text-muted-foreground">Other Deduction</span>
                    <span className="text-right font-medium">{Number(structure.otherDeduction || 0).toLocaleString()} ৳</span>
                    <div className="col-span-2 border-t pt-2 mt-auto flex justify-between font-semibold">
                      <span>Total Deductions</span>
                      <span className="text-destructive">
                        {Number(structure.totalDeductions || 0).toLocaleString()} ৳
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Salary Highlight */}
              <div className="flex items-center justify-between p-4 rounded-xl border bg-primary-soft text-primary-ink">
                <div>
                  <p className="text-xs font-medium opacity-80">Official Net Monthly Salary</p>
                  <p className="text-2xl font-bold tracking-tight">
                    {Number(structure.netSalary || profile?.salary || 0).toLocaleString()} ৳
                  </p>
                </div>
                <div className="text-right text-xs opacity-75">
                  Direct transfer to primary bank account
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payslips History Table */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Payslips &amp; Salary Statements
          </CardTitle>
          <CardDescription>
            Official payroll statements with detailed earning, deduction, and payment records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payslipsLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : payslips.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No payslips have been generated yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Date Range</TableHead>
                    <TableHead className="text-right">Total Earnings</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right font-bold">Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20 text-right">Statement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((ps) => {
                    const badge = (PAYSLIP_STATUS_BADGE as any)[ps.status] || {
                      label: ps.status,
                      className: 'bg-muted text-muted-foreground',
                    }
                    return (
                      <TableRow key={ps.id}>
                        <TableCell className="font-semibold text-xs">{ps.periodKey || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(ps.periodStart)} – {formatDate(ps.periodEnd)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {Number(ps.totalEarnings || 0).toLocaleString()} ৳
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-destructive">
                          {Number(ps.totalDeductions || 0).toLocaleString()} ৳
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs tabular-nums text-foreground">
                          {Number(ps.netPay || 0).toLocaleString()} ৳
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => setSelectedPayslipId(ps.id)}
                          >
                            View <ArrowUpRight className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commissions & Bonuses Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Commissions */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4 text-emerald-600" />
              Commission Earnings
            </CardTitle>
            <CardDescription>Commissions earned from processed sales orders.</CardDescription>
          </CardHeader>
          <CardContent>
            {commissionsLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : commissions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No commission records yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {commissions.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 text-xs"
                  >
                    <div>
                      <span className="font-semibold">{c.order?.displayId || 'Commission'}</span>
                      <p className="text-[11px] text-muted-foreground">{formatDate(c.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        +{Number(c.amount || 0).toLocaleString()} ৳
                      </span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {c.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bonuses & Incentives */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-purple-600" />
              Incentives &amp; Bonuses
            </CardTitle>
            <CardDescription>Special performance bonuses, rewards, and allowances.</CardDescription>
          </CardHeader>
          <CardContent>
            {earningsLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : earnings.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No special bonuses or earnings recorded yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {earnings.slice(0, 6).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 text-xs"
                  >
                    <div>
                      <span className="font-semibold capitalize">{e.type}: {e.reason}</span>
                      <p className="text-[11px] text-muted-foreground">{formatDate(e.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-purple-600 dark:text-purple-400 tabular-nums">
                        +{Number(e.amount || 0).toLocaleString()} ৳
                      </span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {e.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payslip View Dialog.
          Uses the self-service dialog, not the payroll admin one: that fetched
          GET /payroll/payslips/:id, which is restricted to
          superadmin/admin/manager, so a plain employee got a 403 the moment
          they opened their own payslip. It also offered Review/Approve buttons,
          which an employee must never see on their own payslip. */}
      <MyPayslipDialog
        open={Boolean(selectedPayslipId)}
        onOpenChange={(open) => {
          if (!open) setSelectedPayslipId(null)
        }}
        payslipId={selectedPayslipId}
      />
    </div>
  )
}
