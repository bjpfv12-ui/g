import { create } from 'zustand'

/**
 * CarStore — состояние вождения.
 *
 * `isDriving` — сидит ли игрок в машине.
 * `currentCarId` — id той машины, за рулём которой он сидит.
 *
 * Флаг читается контроллером игрока и камерой через getState(),
 * чтобы не перерисовывать сцену на каждый кадр.
 */
interface CarState {
  isDriving: boolean
  currentCarId: string | null
  /** Сел в машину. */
  enterCar: (id: string) => void
  /** Вышел из машины. */
  exitCar: () => void
}

export const useCarStore = create<CarState>((set) => ({
  isDriving: false,
  currentCarId: null,
  enterCar: (id) => set({ isDriving: true, currentCarId: id }),
  exitCar: () => set({ isDriving: false, currentCarId: null }),
}))
