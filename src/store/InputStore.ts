import { create } from 'zustand'

/**
 * InputStore — единственный источник правды про ввод.
 *
 * Мутируемые объекты (keys / pressQueue / mouse / virtualMove) живут вне
 * React-стета: их читают через getState() прямо в useFrame, поэтому каждый
 * кадр не вызывает ни одного ре-рендера. В zustand попадает только то, что
 * реально нужно рендерить (pointerLocked, touch).
 */

export interface MouseDelta {
  x: number
  y: number
}

/**
 * Аналоговая ось движения от виртуального стика.
 *
 * `x` — вбок (вправо положительно), `y` — вперёд (вперёд положительно).
 * Значения в диапазоне -1…1; длина вектора задаёт силу нажатия.
 */
export interface VirtualMove {
  x: number
  y: number
}

const keys: Record<string, boolean> = {}
const pressQueue: string[] = []
const mouse: MouseDelta = { x: 0, y: 0 }
/** Ось виртуального стика — мутируется на месте, без ре-рендеров. */
const virtualMove: VirtualMove = { x: 0, y: 0 }
/** Стик сейчас зажат (палец на экране). */
let virtualActive = false

/**
 * Телефон или планшет: показываем экранное управление.
 *
 * Определяется по «грубому» указателю (у тач-устройств основной указатель
 * грубый). Гибридные ноутбуки переключаются в этот режим при первом касании.
 */
function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

export interface InputState {
  keys: Record<string, boolean>
  pointerLocked: boolean
  /** Телефон: экранное управление вместо клавиатуры. */
  touch: boolean
  /** Ось виртуального стика. */
  virtualMove: VirtualMove
  /** Стик зажат прямо сейчас. */
  virtualActive: boolean
  setKey: (code: string, down: boolean) => void
  consumePress: (code: string) => boolean
  setPointerLocked: (locked: boolean) => void
  addMouseDelta: (x: number, y: number) => void
  consumeMouseDelta: () => MouseDelta
  setTouch: (touch: boolean) => void
  setVirtualMove: (x: number, y: number, active: boolean) => void
}

export const useInputStore = create<InputState>((set) => ({
  keys,
  pointerLocked: false,
  touch: detectTouch(),
  virtualMove,
  virtualActive: false,

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

  setTouch: (touch) => set({ touch }),

  setVirtualMove: (x, y, active) => {
    const wasActive = virtualActive
    virtualMove.x = x
    virtualMove.y = y
    virtualActive = active
    // Ре-рендер нужен только на смене «стик зажат / отпущен» — движение
    // пальца читается из мутируемого объекта напрямую.
    if (wasActive !== active) set({ virtualActive: active })
  },
}))

/** Сброс всех клавиш — например, при потере фокуса окна. */
export function releaseAllKeys(): void {
  for (const code of Object.keys(keys)) keys[code] = false
  pressQueue.length = 0
  virtualMove.x = 0
  virtualMove.y = 0
  virtualActive = false
}

/** Текущая ось стика — читается в useFrame через getState(). */
export function readVirtualMove(): { x: number; y: number; active: boolean } {
  return { x: virtualMove.x, y: virtualMove.y, active: virtualActive }
}

// Dev-хук: позволяет из devtools/теста читать и выставлять ввод.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __inputStore: typeof useInputStore }).__inputStore = useInputStore
}
