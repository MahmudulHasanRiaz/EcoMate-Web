# Media Gallery — Bulk Selection Enhancement
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

**Date:** 2026-06-13
**Status:** Draft

## Overview

Enhance the Media Gallery page with file-manager-style bulk selection: always-visible checkboxes, a master "Select All" checkbox for the current page, and keyboard-modifier-driven selection (Shift+Click for range, Cmd/Ctrl+Click for toggle, Cmd/Ctrl+A for select all).

## Scope

Only the **Media Gallery page** (`apps/admin/src/features/media/index.tsx`). The MediaPicker dialog is out of scope.

## Features

### 1. Always-visible Checkboxes
- Remove `opacity-0 group-hover:opacity-100` on checkboxes so they are always visible
- Checkbox position: top-left corner of each thumbnail, `z-10`

### 2. Unified Click Handler on Thumbnails
- **Normal click** on thumbnail body → open detail panel (existing behavior, unchanged)
- **Cmd/Ctrl+Click** → toggle selection only, do NOT open detail panel
- **Shift+Click** → select a contiguous range from `lastClickedIndex` to current item index, do NOT open detail panel
- **Cmd/Ctrl+Shift+Click** → add range to existing selection

### 3. Master Checkbox (Select All)
- Positioned above the grid, left-aligned, before the bulk action bar
- Shows a tri-state visual: checked (all selected), indeterminate (some selected), unchecked (none selected)
- Label: "Select all {N} items on this page" / "Deselect all"
- On click: selects or deselects all items in the current page's data
- Also acts as a visual indicator of selection state

### 4. Keyboard Shortcuts
- **Cmd/Ctrl+A** → select all visible items on current page (when focus is on the page, not an input)
- **Esc** → clear selection
- These use `useEffect` with `keydown` event listener

### 5. Range Selection Behavior
- `lastClickedIndex` tracks the index of the last Ctrl+Click or Shift+Click interaction
- On Shift+Click: compute range from `lastClickedIndex` to current index, select all items in that range
- On Ctrl+Click: toggle current item, update `lastClickedIndex` to current index
- On normal click: reset `lastClickedIndex` to null

### 6. Bulk Action Bar
- Existing bar (shown when `selectedIds.size > 0`) remains unchanged
- Master checkbox above the grid serves as the Select All/Deselect All control

## State Changes

### New state variables
```typescript
const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
```

### Derived values
```typescript
const pageItemIds = data?.data?.map(m => m.id) ?? []
const allSelected = pageItemIds.length > 0 && pageItemIds.every(id => selectedIds.has(id))
const someSelected = pageItemIds.some(id => selectedIds.has(id))
```

## Data Flow

1. Filter/search query fetches paginated results from `/media` API (unchanged)
2. `selectedIds` Set tracks all selected IDs across any page
3. Master checkbox reads `allSelected`/`someSelected` to show tri-state
4. On "Select All": merge all `pageItemIds` into `selectedIds`
5. On "Deselect All": remove all `pageItemIds` from `selectedIds`
6. Shift+Click range computed from array index in `data.data`

## No Backend Changes

All logic is client-side. The backend API is unchanged.

## Keyboard Shortcuts Safety

- Cmd/Ctrl+A only fires when no `<input>`, `<textarea>`, or contenteditable is focused
- `e.preventDefault()` on matching shortcuts to avoid browser defaults
