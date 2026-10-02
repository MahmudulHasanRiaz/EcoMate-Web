import type { ShiftSelectionValue } from '@/features/hr-shifts/components/shift-assignment-picker'

/**
 * Turns the picker's selection into the request body.
 *
 * Kept separate from the wizard so the exact field names can be asserted without
 * driving the whole form. The rotation items MUST use `shiftPresetId`: the
 * server DTO names the field that way, and the global whitelist pipe silently
 * strips unknown keys, so sending `presetId` produced a 400 with no other clue.
 */
export function buildShiftPayload(
  value: ShiftSelectionValue,
): {
  shiftPresetId?: string
  shiftDays?: number[]
  shiftRotations?: { dayOfWeek: number; shiftPresetId: string }[]
} {
  if (value.mode === 'template') {
    if (!value.presetId) return {}
    return { shiftPresetId: value.presetId, shiftDays: value.templateDays }
  }

  if (value.mode === 'custom') {
    // Custom hours are materialised into a preset by the caller; nothing to send
    // here beyond the chosen days.
    if (!value.presetId) return {}
    return { shiftPresetId: value.presetId, shiftDays: value.customDays }
  }

  const items = Object.entries(value.rotation)
    .filter(([, presetId]) => presetId && presetId !== '__none__')
    .map(([day, presetId]) => ({ dayOfWeek: Number(day), shiftPresetId: presetId }))

  return items.length > 0 ? { shiftRotations: items } : {}
}