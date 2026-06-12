# Media Gallery Bulk Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add always-visible checkboxes, master Select All checkbox, Shift+Click range selection, and keyboard shortcuts to the Media Gallery page.

**Architecture:** All changes are client-side in a single component (`apps/admin/src/features/media/index.tsx`). No backend API changes needed.

**Tech Stack:** React 19, TypeScript, Zustand (client state), TanStack Query, Tailwind CSS 4

---

### Task 1: Always-visible checkboxes + unified click handler

**Files:**
- Modify: `apps/admin/src/features/media/index.tsx`

- [ ] **Step 1: Make checkboxes always visible**

Remove the `opacity-0 group-hover:opacity-100 transition-opacity` classes from the checkbox container div (around line 357-359):

```tsx
<div
  className='absolute top-1.5 left-1.5 z-10'
  onClick={e => e.stopPropagation()}
>
```

- [ ] **Step 2: Add `lastClickedIndex` state and range select helper**

Add state after `const [selectedIds, setSelectedIds]` (around line 38):

```typescript
const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
```

- [ ] **Step 3: Modify thumbnail click handler for keyboard modifiers**

Replace the existing `onClick` on the thumbnail div (around line 352-355) to handle modifiers:

```tsx
onClick={(e) => {
  const idx = data?.data?.findIndex(item => item.id === m.id) ?? -1
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(m.id)) next.delete(m.id)
      else next.add(m.id)
      return next
    })
    setLastClickedIndex(idx)
    return
  }
  if (e.shiftKey) {
    e.preventDefault()
    const anchor = lastClickedIndex ?? idx
    const start = Math.min(anchor, idx)
    const end = Math.max(anchor, idx)
    if (data?.data) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (let i = start; i <= end; i++) {
          next.add(data.data[i].id)
        }
        return next
      })
    }
    setLastClickedIndex(idx)
    return
  }
  // Normal click opens detail panel
  if (selected?.id === m.id) { setSelected(null); setDetailOpen(false) }
  else { setSelected(m); setDetailOpen(true) }
}}
```

- [ ] **Step 4: Add `useEffect` for keyboard shortcuts (Cmd+A, Esc)**

Add after the paste event listener (around line 175-178):

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      if (isInput) return
      e.preventDefault()
      if (data?.data?.length) {
        setSelectedIds(prev => {
          const next = new Set(prev)
          data.data.forEach(m => next.add(m.id))
          return next
        })
      }
    }
    if (e.key === 'Escape') {
      if (isInput) return
      setSelectedIds(new Set())
    }
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}, [data?.data])
```

- [ ] **Step 5: Verify build compiles**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: No type errors

---

### Task 2: Master Select All checkbox

**Files:**
- Modify: `apps/admin/src/features/media/index.tsx`

- [ ] **Step 1: Add master checkbox ref**

Add after other refs (around line 41):

```typescript
const masterRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 2: Add `useEffect` for indeterminate state**

Add after the keyboard shortcut useEffect:

```typescript
const pageItemIds = data?.data?.map(m => m.id) ?? []
const allSelected = pageItemIds.length > 0 && pageItemIds.every(id => selectedIds.has(id))
const someSelected = pageItemIds.some(id => selectedIds.has(id))

useEffect(() => {
  if (masterRef.current) {
    masterRef.current.indeterminate = someSelected && !allSelected
  }
}, [someSelected, allSelected])
```

- [ ] **Step 3: Add master checkbox above the grid + rewrite the grid header**

Replace the grid container starting from the div containing `{pending.length > 0 && ...}` grid and the main grid (around line 327-386) to include the master checkbox above the grid.

Insert master checkbox before the pending uploads grid:

```tsx
{(data?.data?.length ?? 0) > 0 && (
  <div className='flex items-center gap-2 px-1.5 pt-1 pb-0.5'>
    <input
      ref={masterRef}
      type='checkbox'
      checked={allSelected}
      onChange={() => {
        if (allSelected) {
          setSelectedIds(prev => {
            const next = new Set(prev)
            pageItemIds.forEach(id => next.delete(id))
            return next
          })
        } else {
          setLastClickedIndex(null)
          setSelectedIds(prev => {
            const next = new Set(prev)
            pageItemIds.forEach(id => next.add(id))
            return next
          })
        }
      }}
      className='h-4 w-4 rounded cursor-pointer accent-primary'
    />
    <span className='text-xs text-muted-foreground'>
      {allSelected
        ? `${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'} selected`
        : someSelected
          ? `${selectedIds.size} selected — click to select all ${pageItemIds.length} on this page`
          : `Select all ${pageItemIds.length} item${pageItemIds.length === 1 ? '' : 's'} on this page`
      }
    </span>
  </div>
)}
```

Place this right before `{pending.length > 0 && (` (the pending uploads grid), inside the `data?.data?.length || pending.length` block.

- [ ] **Step 4: Verify build compiles**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: No type errors

---

### Self-Review Checklist

1. **Spec coverage:** Checkboxes always visible ✓, Master checkbox ✓, Shift+Click range ✓, Cmd/Ctrl+Click toggle ✓, Cmd+A select all ✓, Esc clear ✓
2. **No placeholders:** No TBD, TODO, or vague steps
3. **Type consistency:** `lastClickedIndex` is `number | null`, consistent across all uses
