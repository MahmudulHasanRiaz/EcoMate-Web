import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
