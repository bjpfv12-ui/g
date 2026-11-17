import { create } from 'zustand'

interface UiState {
  /** Подсказка взаимодействия, например «E — открыть дверь». */
  doorPrompt: string | null
  /** Подсказка взаимодействия с машиной, например «Нажмите F, чтобы сесть». */
  carPrompt: string | null
  setDoorPrompt: (prompt: string | null) => void
  setCarPrompt: (prompt: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  doorPrompt: null,
  carPrompt: null,
  setDoorPrompt: (doorPrompt) =>
    set((state) => (state.doorPrompt === doorPrompt ? state : { doorPrompt })),
  setCarPrompt: (carPrompt) =>
    set((state) => (state.carPrompt === carPrompt ? state : { carPrompt })),
}))
