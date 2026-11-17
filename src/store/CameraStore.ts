import { create } from 'zustand'

/**
 * CameraStore — орбитальный риг камеры.
 *
 * yaw/pitch читаются игроком каждый кадр (камера-относительное движение),
 * поэтому состояние меняется из CameraRig и не вызывает ре-рендеров.
 */
export interface CameraState {
  yaw: number
  pitch: number
  distance: number
  setYaw: (yaw: number) => void
  setPitch: (pitch: number) => void
  setDistance: (distance: number) => void
}

export const useCameraStore = create<CameraState>((set) => ({
  yaw: 0,
  pitch: 0.18,
  distance: 7.2,
  setYaw: (yaw) => set({ yaw }),
  setPitch: (pitch) => set({ pitch }),
  setDistance: (distance) => set({ distance }),
}))
