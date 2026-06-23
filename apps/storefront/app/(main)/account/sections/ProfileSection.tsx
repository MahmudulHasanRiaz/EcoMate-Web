"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/api/auth';
import { normalizePhone } from '@/lib/phone-utils';
import { toast } from 'sonner';

export function ProfileSection() {
  const { user, refreshUser } = useAuth();

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phoneNumber || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const normalized = phone ? normalizePhone(phone) : phone;
    if (phone && !normalized) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phoneNumber: normalized || phone });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">Profile Settings</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
          <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Phone</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? <Loader2 className="animate-spin inline-block" size={18} /> : 'Save Changes'}
      </button>
    </div>
  );
}
