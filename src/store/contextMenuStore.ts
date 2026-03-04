import { create } from 'zustand'

interface ContextMenuState {
  openMenuId: string | null
  openMenu: (id: string) => void
  closeMenu: () => void
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  openMenuId: null,

  openMenu: (id: string) => set({ openMenuId: id }),

  closeMenu: () => set({ openMenuId: null }),
}))
