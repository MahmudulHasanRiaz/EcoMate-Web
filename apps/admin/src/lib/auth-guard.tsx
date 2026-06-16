import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth-store';

type AllowedRole = 'superadmin' | 'admin' | 'manager' | 'cashier';

export function useRequireRole(allowedRoles: AllowedRole[]) {
  const { user } = useAuthStore((s) => s.auth);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate({ to: '/sign-in' });
      return;
    }
    if (!allowedRoles.includes(user.role as AllowedRole)) {
      navigate({ to: '/' });
    }
  }, [user, allowedRoles, navigate]);

  return user;
}
