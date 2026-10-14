export function BulkSteadfastDefaultWarning({
  courier,
  setCount,
}: {
  courier: string
  setCount: number
}) {
  // MEDIUM bulk-silent: the bulk dispatch path resolves ONE Steadfast
  // profile upfront (the default account) and ignores per-order overrides —
  // warn visibly when >1 sets exist so staff never book silently.
  if (courier !== 'steadfast' || setCount <= 1) return null
  return (
    <p
      role='note'
      className='basis-full w-full text-center text-[11px] text-amber-600 dark:text-amber-400'
    >
      Bulk books with the default Steadfast account
    </p>
  )
}
