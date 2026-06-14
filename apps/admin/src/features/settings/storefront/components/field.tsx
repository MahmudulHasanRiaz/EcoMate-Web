import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { MediaPicker } from '@/components/media-picker'
import { SafeImage } from '@/components/safe-image'
import { mediaUrl } from '@/lib/utils'
import { ImageIcon, X } from 'lucide-react'
import type { FieldSchema } from '@/features/settings/storefront/lib/field-schemas'

interface FieldProps {
  fieldKey: string
  schema: FieldSchema
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  hint?: string
}

export function Field({ fieldKey, schema, value, onChange, disabled, placeholder, hint }: FieldProps) {
  const inputProps = {
    id: fieldKey,
    'data-field-key': fieldKey,
    disabled,
  }

  const renderInput = () => {
    switch (schema.type) {
      case 'textarea':
        return (
          <Textarea
            {...inputProps}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
            rows={schema.rows ?? 3}
          />
        )

      case 'switch':
        return (
          <Switch
            {...inputProps}
            checked={value === 'true'}
            onCheckedChange={c => onChange(String(c))}
          />
        )

      case 'email':
        return (
          <Input
            {...inputProps}
            type='email'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      case 'tel':
        return (
          <Input
            {...inputProps}
            type='tel'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      case 'url':
        return (
          <Input
            {...inputProps}
            type='url'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      case 'image': {
        const [pickerOpen, setPickerOpen] = useState(false)
        return (
          <div className='space-y-2'>
            {value ? (
              <div className='relative h-24 w-full max-w-xs rounded-lg border overflow-hidden bg-muted group'>
                <SafeImage src={mediaUrl(value)} alt='' className='h-full w-full object-cover' />
                <div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2'>
                  <Button type='button' variant='secondary' size='sm' onClick={() => setPickerOpen(true)}>Change</Button>
                  <Button type='button' variant='destructive' size='sm' onClick={() => onChange('')}><X className='h-3 w-3' /></Button>
                </div>
              </div>
            ) : (
              <button type='button' onClick={() => setPickerOpen(true)}
                className='h-24 w-full max-w-xs rounded-lg border-2 border-dashed bg-muted/50 hover:bg-muted flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer'>
                <ImageIcon className='h-6 w-6 text-muted-foreground' />
                <span className='text-xs text-muted-foreground'>Pick image</span>
              </button>
            )}
            <MediaPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              selected={value ? [value] : []}
              onSelect={urls => { onChange(urls[0] || ''); setPickerOpen(false) }}
              multiple={false}
            />
          </div>
        )
      }

      default:
        return (
          <Input
            {...inputProps}
            type='text'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )
    }
  }

  return (
    <div className='space-y-1.5'>
      <Label htmlFor={fieldKey} className='text-xs font-medium text-foreground/80'>
        {schema.label}
      </Label>
      {renderInput()}
      {(hint || schema.hint) && (
        <p className='text-xs text-muted-foreground'>{hint ?? schema.hint}</p>
      )}
    </div>
  )
}
