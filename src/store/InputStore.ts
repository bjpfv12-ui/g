import { create } from 'zustand'

/**
 * InputStore — единственный источник правды про ввод.
 *
 * Мутируемые объекты (keys / pressQueue / mouse) живут вне React-стейта:
 * их читают через getState() прямо в useFrame, поэтому каждый кадр
 * не вызывает ни одного ре-рендера. В zustand попадает только то, что
 * реально нужно рендерить (pointerLocked).
 */

export interface MouseDelta {
  x: number
  y: number
}

const keys: Record<string, boolean> = {}
const pressQueue: string[] = []
const mouse: MouseDelta = { x: 0, y: 0 }

export interface InputState {
  keys: Record<string, boolean>
  pointerLocked: boolean
  setKey: (code: string, down: boolean) => void
  consumePress: (code: string) => boolean
  setPointerLocked: (locked: boolean) => void
  addMouseDelta: (x: number, y: number) => void
  consumeMouseDelta: () => MouseDelta
}

export const useInputStore = create<InputState>((set) => ({
  keys,
  pointerLocked: false,

  setKey: (code, down) => {
    if (down && !keys[code]) pressQueue.push(code)
    keys[code] = down
  },

  /** Возвращает true ровно один раз за нажатие — для jump и прочих edge-событий. */
  consumePress: (code) => {
    const index = pressQueue.indexOf(code)
    if (index === -1) return false
    pressQueue.splice(index, 1)
    return true
  },

  setPointerLocked: (locked) => set({ pointerLocked: locked }),

  addMouseDelta: (x, y) => {
    mouse.x += x
    mouse.y += y
  },

  consumeMouseDelta: () => {
    const delta = { x: mouse.x, y: mouse.y }
    mouse.x = 0
    mouse.y = 0
    return delta
  },
}))

/** Сброс всех клавиш — например, при потере фокуса окна. */
export function releaseAllKeys(): void {
  for (const code of Object.keys(keys)) keys[code] = false
  pressQueue.length = 0
}
