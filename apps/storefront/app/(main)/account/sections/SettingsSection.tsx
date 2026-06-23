"use client";

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api/settings';
import { toast } from 'sonner';

export function SettingsSection() {
  const [autoVariant, setAutoVariant] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then(s => setAutoVariant(s.autoVariantSelect ?? true))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (val: boolean) => {
    setSaving(true);
    setAutoVariant(val);
    try {
      await updateSettings({ autoVariantSelect: val });
      toast.success('Setting updated');
    } catch {
      setAutoVariant(!val);
      toast.error('Failed to update setting');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">Settings</h3>

      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Auto-select Variant</p>
            <p className="text-xs text-gray-500 mt-0.5">When viewing a product detail page, automatically select the first available variant</p>
          </div>
          <button
            onClick={() => handleToggle(!autoVariant)}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors ${autoVariant ? 'bg-brand-blue' : 'bg-gray-300'} ${saving ? 'opacity-60' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${autoVariant ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
