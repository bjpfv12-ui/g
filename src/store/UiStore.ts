import { create } from 'zustand'

interface UiState {
  /** Подсказка взаимодействия, например «E — открыть дверь». */
  doorPrompt: string | null
  setDoorPrompt: (prompt: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  doorPrompt: null,
  setDoorPrompt: (doorPrompt) =>
    set((state) => (state.doorPrompt === doorPrompt ? state : { doorPrompt })),
}))
