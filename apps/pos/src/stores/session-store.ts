import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCartStore } from './cart-store';

interface SessionState {
  sessionId: string | null;
  showroomId: string | null;
  showroomName: string | null;
  cashierName: string | null;
  openedAt: string | null;  // ISO timestamp when session was opened
  setSession: (session: { id: string; showroomId: string; showroomName: string; cashierName: string; openedAt?: string }) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      showroomId: null,
      showroomName: null,
      cashierName: null,
      openedAt: null,
      setSession: (session) => {
        // A different session (or a fresh open) must never inherit the
        // previous cashier's cart, customer, discount or notes. Reload
        // persistence still works because rehydration calls no setter.
        const prevId = useSessionStore.getState().sessionId;
        set({
          sessionId: session.id,
          showroomId: session.showroomId,
          showroomName: session.showroomName,
          cashierName: session.cashierName,
          openedAt: session.openedAt || new Date().toISOString(),
        });
        if (prevId !== session.id) {
          useCartStore.getState().clearCart();
        }
      },
      clearSession: () => {
        set({
          sessionId: null,
          showroomId: null,
          showroomName: null,
          cashierName: null,
          openedAt: null,
        });
        useCartStore.getState().clearCart();
      },
    }),
    { name: 'pos-session' },
  ),
);
