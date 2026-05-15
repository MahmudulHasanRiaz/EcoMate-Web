import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { orderStatusApi } from './api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, GripVertical } from 'lucide-react'

export function OrderStatusSettings() {
  const queryClient = useQueryClient()
  const { data: statuses, isLoading } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => orderStatusApi.list().then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => orderStatusApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['order-statuses'] }); toast.success('Saved') },
  })

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  const sorted = (statuses || []).sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>Click badges to toggle allowed transitions. Edit name or color inline.</p>
      {sorted.map((s: { id: string; name: string; color: string; isInitial: boolean; isFinal: boolean; nextStatuses: string[] | null; sortOrder: number }) => (
        <Card key={s.id}>
          <CardContent className='p-4 space-y-3'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-4 w-4 text-muted-foreground shrink-0' />
              <div className='h-5 w-5 rounded-full shrink-0' style={{ backgroundColor: s.color }} />
              <input className='font-medium bg-transparent border-b border-transparent hover:border-muted-foreground/30 focus:border-primary outline-none flex-1' defaultValue={s.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== s.name) updateMut.mutate({ id: s.id, data: { name: e.target.value } }) }} />
              <div className='flex items-center gap-3 shrink-0'>
                <Input type='color' defaultValue={s.color} className='w-8 h-7 p-0.5 border-0 cursor-pointer' onBlur={(e) => updateMut.mutate({ id: s.id, data: { color: e.target.value } })} />
                <div className='flex items-center gap-1.5'><Switch defaultChecked={s.isInitial} onCheckedChange={(v) => updateMut.mutate({ id: s.id, data: { isInitial: v } })} /><Label className='text-[10px]'>Initial</Label></div>
                <div className='flex items-center gap-1.5'><Switch defaultChecked={s.isFinal} onCheckedChange={(v) => updateMut.mutate({ id: s.id, data: { isFinal: v } })} /><Label className='text-[10px]'>Final</Label></div>
                <Badge variant='outline' className='text-[10px]'>{s.isInitial ? 'Start' : s.isFinal ? 'End' : 'Mid'}</Badge>
              </div>
            </div>
            <div className='pl-8'>
              <Label className='text-[10px] text-muted-foreground mb-1.5 block'>Allowed transitions →</Label>
              <div className='flex flex-wrap gap-1'>
                {sorted.filter((t: { id: string }) => t.id !== s.id).map((target: { id: string; name: string; color: string }) => {
                  const allowed = (Array.isArray(s.nextStatuses) ? s.nextStatuses : []).includes(target.id)
                  return (
                    <Badge key={target.id} variant={allowed ? 'default' : 'outline'} className='cursor-pointer text-[11px] select-none' style={allowed ? { backgroundColor: target.color, color: '#fff' } : {}} onClick={() => {
                      const next = Array.isArray(s.nextStatuses) ? [...s.nextStatuses] : []
                      updateMut.mutate({ id: s.id, data: { nextStatuses: allowed ? next.filter(id => id !== target.id) : [...next, target.id] } })
                    }}>{target.name}</Badge>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
