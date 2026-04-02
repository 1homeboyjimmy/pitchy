import { create } from 'zustand';

interface LayoutState {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  isDashboard: boolean;
  setIsDashboard: (isDashboard: boolean) => void;
  isChatOpen: boolean;
  setIsChatOpen: (isChat: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  isDashboard: false,
  setIsDashboard: (isDashboard) => set({ isDashboard }),
  isChatOpen: false,
  setIsChatOpen: (isChatOpen) => set({ isChatOpen }),
}));
