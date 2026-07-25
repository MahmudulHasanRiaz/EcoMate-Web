import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Save, Loader2 } from 'lucide-react'

interface Props {
  settings: Record<string, string> | undefined
  onSave: (settings: Record<string, string>) => void
  isPending: boolean
}

export function BackupSettingsForm({ settings, onSave, isPending }: Props) {
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) setForm({ ...settings })
  }, [settings])

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => onSave(form)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="schedule_enabled">Automatic Backups</Label>
          <Switch
            id="schedule_enabled"
            checked={form['backup_schedule_enabled'] === 'true'}
            onCheckedChange={(v) => handleChange('backup_schedule_enabled', String(v))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cron">Schedule (cron)</Label>
          <Input
            id="cron"
            value={form['backup_schedule_cron'] || '0 2 * * *'}
            onChange={(e) => handleChange('backup_schedule_cron', e.target.value)}
            disabled={form['backup_schedule_enabled'] !== 'true'}
            placeholder="0 2 * * *"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="default_scope">Default Scope</Label>
          <select
            id="default_scope"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
            value={form['backup_default_scope'] || 'db_only'}
            onChange={(e) => handleChange('backup_default_scope', e.target.value)}
          >
            <option value="db_only">Database Only</option>
            <option value="db_files">Database + Files</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="daily">Keep Daily</Label>
            <Input
              id="daily" type="number" min="0"
              value={form['backup_retention_daily'] || '7'}
              onChange={(e) => handleChange('backup_retention_daily', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weekly">Keep Weekly</Label>
            <Input
              id="weekly" type="number" min="0"
              value={form['backup_retention_weekly'] || '4'}
              onChange={(e) => handleChange('backup_retention_weekly', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthly">Keep Monthly</Label>
            <Input
              id="monthly" type="number" min="0" max="12"
              value={form['backup_retention_monthly'] || '3'}
              onChange={(e) => handleChange('backup_retention_monthly', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="yearly">Keep Yearly</Label>
            <Input
              id="yearly" type="number" min="0"
              value={form['backup_retention_yearly'] || '1'}
              onChange={(e) => handleChange('backup_retention_yearly', e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_total">Max Total Backups</Label>
          <Input
            id="max_total" type="number" min="1"
            value={form['backup_max_total'] || '30'}
            onChange={(e) => handleChange('backup_max_total', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="include_paths">Include Paths (comma-separated)</Label>
          <Input
            id="include_paths"
            value={(() => {
              try {
                const v = form['backup_include_paths'];
                return v ? JSON.parse(v).join(', ') : 'uploads';
              } catch { return form['backup_include_paths'] || 'uploads'; }
            })()}
            onChange={(e) => handleChange('backup_include_paths',
              JSON.stringify(e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)))}
          />
        </div>

        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  )
}