"use client";

import { useState, useEffect } from 'react';
import { MapPin, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { getAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress } from '@/lib/api/addresses';
import type { AddressData } from '@/lib/api/addresses';
import { toast } from 'sonner';

function AddressForm({ initial, onSave, onCancel }: { initial?: AddressData; onSave: (d: AddressData) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<AddressData>(initial || { label: '', fullName: '', phoneNumber: '', street: '', city: '', state: '', zipCode: '', country: 'Bangladesh', isDefault: false });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">Label</label>
          <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Home / Office" required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">Full Name</label>
          <input type="text" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">Phone</label>
          <input type="tel" value={form.phoneNumber} onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">City</label>
          <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div><label className="text-xs font-semibold text-gray-600">Street Address</label>
        <input type="text" value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">State</label>
          <input type="text" value={form.state || ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">ZIP Code</label>
          <input type="text" value={form.zipCode || ''} onChange={e => setForm(f => ({ ...f, zipCode: e.target.value }))} className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isDefault" checked={form.isDefault || false} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} className="rounded" />
        <label htmlFor="isDefault" className="text-sm text-gray-600">Set as default address</label>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="bg-brand-blue hover:bg-brand-blue/90 text-white px-6 h-10 rounded-xl text-sm font-bold transition-all disabled:opacity-60">
          {saving ? <Loader2 className="animate-spin inline" size={16} /> : (initial ? 'Update' : 'Add Address')}
        </button>
        <button type="button" onClick={onCancel} className="px-6 h-10 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

export function AddressesSection() {
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchAddresses = async () => {
    setLoading(true);
    try { setAddresses(await getAddresses()); } catch { setAddresses([]); } finally { setLoading(false); }
  };

  useEffect(() => { fetchAddresses(); }, []);

  const handleCreate = async (dto: AddressData) => {
    await createAddress(dto);
    setShowForm(false);
    toast.success('Address added');
    fetchAddresses();
  };

  const handleUpdate = async (dto: AddressData) => {
    if (!editingId) return;
    await updateAddress(editingId, dto);
    setEditingId(null);
    toast.success('Address updated');
    fetchAddresses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this address?')) return;
    await deleteAddress(id);
    toast.success('Address deleted');
    fetchAddresses();
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultAddress(id);
    fetchAddresses();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800">Saved Addresses</h3>
        {!showForm && <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"><Plus size={16} /> Add Address</button>}
      </div>

      {showForm && <div className="mb-6 p-4 border border-gray-200 rounded-xl"><AddressForm onSave={handleCreate} onCancel={() => setShowForm(false)} /></div>}
      {editingId && <div className="mb-6 p-4 border border-gray-200 rounded-xl"><AddressForm initial={addresses.find(a => a.id === editingId)} onSave={handleUpdate} onCancel={() => setEditingId(null)} /></div>}

      {addresses.length === 0 && !showForm ? (
        <div className="text-center py-12 text-gray-400">
          <MapPin size={48} strokeWidth={1} className="mx-auto mb-4 opacity-50" />
          <p>No saved addresses</p>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map(addr => (
            <div key={addr.id} className={`p-4 rounded-xl border ${addr.isDefault ? 'border-brand-blue/30 bg-brand-blue/5' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 text-sm">{addr.label}</span>
                    {addr.isDefault && <span className="text-[10px] bg-brand-blue/10 text-brand-blue font-semibold px-2 py-0.5 rounded-full">Default</span>}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{addr.fullName} — {addr.phoneNumber}</p>
                  <p className="text-sm text-gray-500">{addr.street}, {addr.city}{addr.state ? `, ${addr.state}` : ''}{addr.zipCode ? ` - ${addr.zipCode}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!addr.isDefault && <button onClick={() => handleSetDefault(addr.id!)} className="text-xs text-gray-400 hover:text-brand-blue">Set Default</button>}
                  <button onClick={() => setEditingId(addr.id!)} className="p-1.5 text-gray-400 hover:text-gray-600"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(addr.id!)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
