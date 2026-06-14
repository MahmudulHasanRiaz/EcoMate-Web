"use client";

import { User, Package, MapPin, Heart, Settings, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

type Section = 'profile' | 'orders' | 'addresses' | 'settings';

function SidebarItem({
  icon, label, isActive, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
        isActive
          ? 'bg-brand-blue/10 text-brand-blue font-semibold'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
      }`}
    >
      <div className={isActive ? 'text-brand-blue' : 'text-gray-400'}>{icon}</div>
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function Sidebar({
  activeSection,
  onNavigate,
}: {
  activeSection: Section;
  onNavigate: (section: Section) => void;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || '?'
    : '?';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center font-bold text-2xl">
          {initials}
        </div>
        <div>
          <h3 className="font-bold text-gray-800 text-lg">
            {user?.firstName} {user?.lastName}
          </h3>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-1">
        <SidebarItem icon={<User size={18} />} label="Profile Overview" isActive={activeSection === 'profile'} onClick={() => onNavigate('profile')} />
        <SidebarItem icon={<Package size={18} />} label="My Orders" isActive={activeSection === 'orders'} onClick={() => onNavigate('orders')} />
        <SidebarItem icon={<MapPin size={18} />} label="Saved Addresses" isActive={activeSection === 'addresses'} onClick={() => onNavigate('addresses')} />
        <SidebarItem icon={<Heart size={18} />} label="Wishlist" onClick={() => router.push('/wishlist')} />
        <SidebarItem icon={<Settings size={18} />} label="Settings" isActive={activeSection === 'settings'} onClick={() => onNavigate('settings')} />
      </div>

      <div className="mt-8 pt-8 border-t border-gray-100">
        <button
          onClick={logout}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-600 hover:text-red-500 transition-colors p-3 rounded-lg hover:bg-red-50"
        >
          <span>Log Out</span>
          <LogOut size={18} />
        </button>
      </div>
    </div>
  );
}
