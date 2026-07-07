import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      setSession: (session) => set({
        sessionId: session.id,
        showroomId: session.showroomId,
        showroomName: session.showroomName,
        cashierName: session.cashierName,
        openedAt: session.openedAt || new Date().toISOString(),
      }),
      clearSession: () => set({
        sessionId: null,
        showroomId: null,
        showroomName: null,
        cashierName: null,
        openedAt: null,
      }),
    }),
    { name: 'pos-session' },
  ),
);
