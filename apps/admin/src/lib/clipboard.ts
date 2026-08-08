import { toast } from 'sonner'

export async function copyToClipboard(text: string, label?: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label ? `${label} copied` : 'Copied to clipboard')
  } catch {
    toast.error('Failed to copy')
  }
}