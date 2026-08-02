import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl } from '@/lib/utils'
import type {
  TemplatePageSchema,
  TemplateFieldDef,
  SimpleFieldDef,
} from './template-schemas'

interface Props {
  schema: TemplatePageSchema
  config: Record<string, any>
  onChange: (next: Record<string, any>) => void
}

export function TemplatePageForm({ schema, config, onChange }: Props) {
  const set = (key: string, value: any) => onChange({ ...config, [key]: value })

  return (
    <div className='space-y-6'>
      {schema.fields.map(field => (
        <FieldRenderer key={field.key} field={field} value={config[field.key]} onChange={(v) => set(field.key, v)} />
      ))}
    </div>
  )
}

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: TemplateFieldDef
  value: any
  onChange: (v: any) => void
}) {
  switch (field.type) {
    case 'array':
      return <ObjectArrayField field={field} value={value ?? []} onChange={onChange} />
    case 'object':
      return <ObjectField field={field} value={value ?? {}} onChange={onChange} />
    case 'stringArray':
      return <StringArrayField field={field} value={value ?? []} onChange={onChange} />
    case 'boolean':
      return (
        <div className='flex items-center justify-between p-3 border rounded-lg'>
          <div>
            <Label className='text-sm font-medium'>{field.label}</Label>
            {field.help && <p className='text-xs text-muted-foreground'>{field.help}</p>}
          </div>
          <Switch checked={!!value} onCheckedChange={onChange} />
        </div>
      )
    case 'image':
      return <ImageField field={field} value={value || ''} onChange={onChange} />
    case 'richText':
      return (
        <div className='space-y-1.5'>
          <Label className='text-sm font-medium'>{field.label}</Label>
          <RichTextEditor value={value || ''} onChange={onChange} />
        </div>
      )
    case 'textarea':
      return (
        <div className='space-y-1.5'>
          <Label className='text-sm font-medium'>{field.label}</Label>
          <Textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={4} placeholder={field.placeholder} />
        </div>
      )
    case 'number':
      return (
        <div className='space-y-1.5'>
          <Label className='text-sm font-medium'>{field.label}</Label>
          <Input type='number' value={value ?? ''} onChange={e => onChange(Number(e.target.value))} placeholder={field.placeholder} />
        </div>
      )
    default:
      return (
        <div className='space-y-1.5'>
          <Label className='text-sm font-medium'>{field.label}</Label>
          <Input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} />
        </div>
      )
  }
}

function ObjectField({
  field,
  value,
  onChange,
}: {
  field: Extract<TemplateFieldDef, { type: 'object' }>
  value: Record<string, any>
  onChange: (v: Record<string, any>) => void
}) {
  return (
    <div className='space-y-3'>
      <Label className='text-sm font-medium'>{field.label}</Label>
      {field.fields.map(f => (
        <FieldRenderer key={f.key} field={f} value={value[f.key]} onChange={v => onChange({ ...value, [f.key]: v })} />
      ))}
    </div>
  )
}

function ImageField({ field, value, onChange }: { field: SimpleFieldDef; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='space-y-1.5'>
      <Label className='text-sm font-medium'>{field.label}</Label>
      <div className='flex items-center gap-3'>
        {value && <img src={mediaUrl(value)} alt='' className='h-12 w-12 rounded border object-cover' />}
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder='Media path or URL' />
        <Button type='button' variant='outline' onClick={() => setOpen(true)}>Browse</Button>
      </div>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        selected={value ? [value] : []}
        onSelect={urls => { onChange(urls[0] || ''); setOpen(false) }}
        multiple={false}
      />
    </div>
  )
}

function ObjectArrayField({
  field,
  value,
  onChange,
}: {
  field: Extract<TemplateFieldDef, { type: 'array' }>
  value: any[]
  onChange: (v: any[]) => void
}) {
  const updateItem = (idx: number, next: any) => {
    onChange(value.map((item, i) => (i === idx ? next : item)))
  }
  const removeItem = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const addItem = () => {
    const blank: Record<string, any> = {}
    field.fields.forEach(f => { blank[f.key] = '' })
    onChange([...value, blank])
  }

  return (
    <div className='space-y-3'>
      <Label className='text-sm font-medium'>{field.label}</Label>
      {value.length === 0 && <p className='text-xs text-muted-foreground'>No items yet.</p>}
      {value.map((item, idx) => (
        <div key={idx} className='border rounded-lg p-4 space-y-3 relative'>
          <div className='absolute right-2 top-2'>
            <Button type='button' variant='ghost' size='icon' className='h-7 w-7 text-destructive' onClick={() => removeItem(idx)}>
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
          <p className='text-xs font-semibold text-muted-foreground'>{field.itemLabel} #{idx + 1}</p>
          {field.fields.map(f => (
            <FieldRenderer key={f.key} field={f} value={item[f.key]} onChange={v => updateItem(idx, { ...item, [f.key]: v })} />
          ))}
        </div>
      ))}
      <Button type='button' variant='outline' size='sm' onClick={addItem}>
        <Plus className='h-3.5 w-3.5 mr-1' /> Add {field.itemLabel}
      </Button>
    </div>
  )
}

function StringArrayField({
  field,
  value,
  onChange,
}: {
  field: Extract<TemplateFieldDef, { type: 'stringArray' }>
  value: string[]
  onChange: (v: string[]) => void
}) {
  const updateItem = (idx: number, v: string) => onChange(value.map((item, i) => (i === idx ? v : item)))
  const removeItem = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const addItem = () => onChange([...value, ''])

  return (
    <div className='space-y-2'>
      <Label className='text-sm font-medium'>{field.label}</Label>
      {value.map((item, idx) => (
        <div key={idx} className='flex items-center gap-2'>
          <Input value={item} onChange={e => updateItem(idx, e.target.value)} placeholder={field.placeholder} />
          <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-destructive' onClick={() => removeItem(idx)}>
            <Trash2 className='h-3.5 w-3.5' />
          </Button>
        </div>
      ))}
      <Button type='button' variant='outline' size='sm' onClick={addItem}>
        <Plus className='h-3.5 w-3.5 mr-1' /> Add {field.itemLabel}
      </Button>
    </div>
  )
}
