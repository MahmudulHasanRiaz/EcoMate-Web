import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { User, Briefcase, MapPin, PhoneCall, Building2, Users2, ShieldCheck } from 'lucide-react'
import type { MyProfileResponse } from '../api'

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function InfoItem({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="text-sm font-semibold text-foreground">{value || '—'}</div>
    </div>
  )
}

export function PersonalTab({ profile }: { profile: MyProfileResponse }) {
  const primaryBank = profile.bankAccounts?.find((b) => b.isPrimary) || profile.bankAccounts?.[0]

  return (
    <div className="space-y-6">
      {/* Official Employment Information */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            Official Employment Details
          </CardTitle>
          <CardDescription>
            Organizational placement, reporting hierarchy, and work schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem
              label="Employee ID"
              value={<span className="font-mono">{profile.employeeId}</span>}
            />
            <InfoItem label="Department" value={profile.department?.name} />
            <InfoItem label="Designation" value={profile.designation?.name} />
            <InfoItem
              label="Employment Type"
              value={<span className="capitalize">{profile.employmentType.replace('_', ' ')}</span>}
            />
            <InfoItem label="Joining Date" value={formatDate(profile.joiningDate)} />
            <InfoItem label="Confirmation Date" value={formatDate(profile.confirmationDate)} />
            <InfoItem
              label="Reporting Manager"
              value={profile.reportingTo?.betterAuthUser?.name || '—'}
            />
            <InfoItem
              label="Attendance Method"
              value={<Badge variant="outline" className="text-xs">{profile.attendanceMethod}</Badge>}
            />
          </div>

          {/* Weekly Offs */}
          {profile.weeklyOffs && profile.weeklyOffs.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border/50">
              <span className="text-xs font-medium text-muted-foreground">Scheduled Weekly Offs</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.weeklyOffs.map((w) => (
                  <Badge key={w.id} variant="secondary" className="text-xs">
                    {DAYS_OF_WEEK[w.dayOfWeek]}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Direct Reports / Team Members */}
          {profile.reports && profile.reports.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border/50">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                <Users2 className="h-3.5 w-3.5 text-primary" /> Direct Reports ({profile.reports.length})
              </span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {profile.reports.map((r) => (
                  <div key={r.id} className="p-2.5 rounded-lg border border-border/50 bg-muted/20 text-xs">
                    <span className="font-semibold">{r.betterAuthUser?.name || r.employeeId}</span>
                    <p className="text-[11px] text-muted-foreground">
                      {r.designation?.name || 'Staff'} · {r.employeeId}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Personal Identity Details */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Personal &amp; Contact Information
          </CardTitle>
          <CardDescription>
            Personal identification data recorded with Human Resources.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Full Name" value={profile.betterAuthUser?.name} />
            <InfoItem label="Email Address" value={profile.betterAuthUser?.email} />
            <InfoItem label="Mobile Phone" value={profile.userProfile?.phoneNumber} />
            <InfoItem label="Username" value={profile.userProfile?.username} />
            <InfoItem label="Date of Birth" value={formatDate(profile.dateOfBirth)} />
            <InfoItem label="Gender" value={profile.gender ? <span className="capitalize">{profile.gender.toLowerCase()}</span> : '—'} />
            <InfoItem label="Nationality" value={profile.nationality} />
            <InfoItem label="NID Number" value={profile.nidNumber ? <span className="font-mono">{profile.nidNumber}</span> : '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Address & Emergency Contacts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Address Information
            </CardTitle>
            <CardDescription>Residential and permanent locations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoItem label="Present Address" value={profile.presentAddress} />
            <div className="border-t pt-3">
              <InfoItem label="Permanent Address" value={profile.permanentAddress} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-primary" />
              Emergency Contact
            </CardTitle>
            <CardDescription>Designated contact person for emergencies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoItem label="Contact Name" value={profile.emergencyContactName} />
            <div className="grid grid-cols-2 gap-4 border-t pt-3">
              <InfoItem label="Contact Phone" value={profile.emergencyContactPhone} />
              <InfoItem label="Relationship" value={profile.emergencyContactRelation} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bank Account Details */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Salary Bank Account Details
          </CardTitle>
          <CardDescription>
            Account verified for payroll direct deposit and disbursements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {primaryBank ? (
            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-base">{primaryBank.bankName}</span>
                  {primaryBank.branchName && (
                    <span className="text-xs text-muted-foreground ml-2">({primaryBank.branchName} Branch)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {primaryBank.accountType}
                  </Badge>
                  <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs">
                    Verified
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t text-xs">
                <div>
                  <span className="text-muted-foreground">Account Title</span>
                  <p className="font-semibold text-foreground mt-0.5">{primaryBank.accountTitle}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Account Number</span>
                  <p className="font-mono font-semibold text-foreground mt-0.5">{primaryBank.accountNumber}</p>
                </div>
                {primaryBank.routingNumber && (
                  <div>
                    <span className="text-muted-foreground">Routing Number</span>
                    <p className="font-mono text-foreground mt-0.5">{primaryBank.routingNumber}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-4 grid-cols-2 sm:grid-cols-2">
              <InfoItem label="Bank Name" value={profile.bankName} />
              <InfoItem label="Bank Account No" value={profile.bankAccountNo ? <span className="font-mono">{profile.bankAccountNo}</span> : '—'} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
