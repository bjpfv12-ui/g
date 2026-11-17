/**
 * Общий срез состояния мира для карты и HUD.
 * Пишется из систем (транспорт, пешеходы), читается из мини-карты.
 */
export const worldState = {
  /** Позиции машин: [{x, z}] */
  traffic: [] as { x: number; z: number }[],
  /** Позиции пешеходов: [{x, z}] */
  pedestrians: [] as { x: number; z: number }[],
  /** Позиции входов (дверей): [{x, z}] */
  doors: [] as { x: number; z: number }[],
}

// Dev-хук: позволяет из devtools/теста читать состояние мира.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __worldState: typeof worldState }).__worldState = worldState
}
