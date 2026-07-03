import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  sessionId: string | null;
  showroomId: string | null;
  showroomName: string | null;
  cashierName: string | null;
  setSession: (session: { id: string; showroomId: string; showroomName: string; cashierName: string }) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      showroomId: null,
      showroomName: null,
      cashierName: null,
      setSession: (session) => set({
        sessionId: session.id,
        showroomId: session.showroomId,
        showroomName: session.showroomName,
        cashierName: session.cashierName,
      }),
      clearSession: () => set({
        sessionId: null,
        showroomId: null,
        showroomName: null,
        cashierName: null,
      }),
    }),
    { name: 'pos-session' },
  ),
);
