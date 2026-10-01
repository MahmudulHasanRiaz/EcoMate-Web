import { Badge } from '@/components/ui/badge'
import { FieldTable } from './field-table'
import type { CustomerAddressView, OrderOthersInfoResponse } from '../api'

/**
 * Current customer profile, shown strictly apart from the order snapshot.
 *
 * The address list is grouped by normalized content with a role badge on each
 * record: one physical address can legitimately exist as BOTH a SHIPPING and a
 * BILLING record (they are separate business roles with separate lifecycles),
 * and a flat list would read as a duplicate.
 */
function AddressList({ addresses }: { addresses: CustomerAddressView[] }) {
  if (addresses.length === 0) {
    return <p className='text-xs text-muted-foreground'>No saved addresses yet.</p>
  }

  // Group identical-content records so a SHIPPING/BILLING pair reads as one
  // physical place serving two roles rather than as a duplicate.
  const groups = new Map<string, CustomerAddressView[]>()
  for (const a of addresses) {
    const key = [a.addressLine, a.area, a.thana, a.district, a.postalCode].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }

  return (
    <div className='space-y-2'>
      {[...groups.values()].map((group) => (
        <div key={group[0].id} className='rounded-md border p-2'>
          <p className='text-xs font-medium'>{group[0].addressLine}</p>
          <p className='text-[11px] text-muted-foreground'>
            {[group[0].area, group[0].thana, group[0].district, group[0].postalCode, group[0].country]
              .filter(Boolean)
              .join(', ')}
          </p>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            {group.map((a) => (
              <span key={a.id} className='inline-flex items-center gap-1'>
                <Badge variant={a.type === 'SHIPPING' ? 'info' : 'violet'} className='px-1.5 py-0 text-[10px]'>
                  {a.type}
                </Badge>
                {a.isDefault ? (
                  <span className='text-[10px] text-muted-foreground'>default</span>
                ) : null}
                {a.label ? <span className='text-[10px] text-muted-foreground'>({a.label})</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function CustomerProfileSection({ data }: { data: OrderOthersInfoResponse }) {
  const profile = data.customerProfile
  if (!profile) {
    return (
      <p className='px-3 py-6 text-center text-xs text-muted-foreground'>
        This order is not linked to a customer profile.
      </p>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5 text-[11px] text-sky-800 dark:text-sky-300'>
        <strong>Current customer profile</strong> — this is the customer's live data, not the
        order-time record. It changes when the profile is edited; the Order Snapshot section above
        does not.
      </div>

      {profile.fieldDiffs.length > 0 && (
        <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5'>
          <p className='mb-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400'>
            Differs from the order-time snapshot
          </p>
          <table className='w-full text-[11px]'>
            <tbody>
              {profile.fieldDiffs.map((d) => (
                <tr key={d.key}>
                  <td className='w-24 py-0.5 font-medium'>{d.label}</td>
                  <td className='py-0.5 text-muted-foreground'>
                    Snapshot: <span className='font-mono'>{String(d.snapshotValue ?? '—')}</span>
                  </td>
                  <td className='py-0.5'>
                    Now: <span className='font-mono'>{String(d.currentValue ?? '—')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FieldTable fields={data.sections.customerProfile} />

      <div>
        <p className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          Address book ({profile.addresses.length})
        </p>
        <AddressList addresses={profile.addresses} />
      </div>
    </div>
  )
}
