import { create } from 'zustand'

export type Activity = 'explorer' | 'taxonomy' | 'problems' | 'ai' | 'masters' | 'settings'
export type RightTab = 'form' | 'xml' | 'preview'
export type BottomTab = 'problems' | 'ai' | 'output'

interface UiState {
  activity: Activity
  sidebarOpen: boolean
  bottomOpen: boolean
  rightTab: RightTab
  bottomTab: BottomTab
  setActivity(a: Activity): void
  toggleSidebar(): void
  toggleBottom(): void
  setRightTab(t: RightTab): void
  setBottomTab(t: BottomTab): void
}

export const useUi = create<UiState>((set, get) => ({
  activity: 'explorer',
  sidebarOpen: true,
  bottomOpen: true,
  rightTab: 'form',
  bottomTab: 'output',
  // Clicking the active activity collapses the side panel (VS Code behaviour).
  setActivity: (a) =>
    set(get().activity === a && get().sidebarOpen ? { sidebarOpen: false } : { activity: a, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setRightTab: (rightTab) => set({ rightTab }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
}))
