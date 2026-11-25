/**
 * tuning.ts — ВСЕ настройки управления и физики в одном файле.
 *
 * Меняй числа здесь — игра подхватит их сама (в дев-режиме ещё и на лету,
 * без перезапуска: см. `window.__tuning` в консоли браузера).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * УПРАВЛЕНИЕ ПЕРСОНАЖЕМ
 * ─────────────────────────────────────────────────────────────────────────
 * controlMode:
 *   'camera' — привычный режим: W/S — вперёд-назад относительно взгляда
 *              камеры, A/D — шаг вбок, поворот — мышью.
 *   'body'   — режим GTA: A/D доворачивают персонажа (и камеру за ним),
 *              W/S — ход по курсу корпуса, поворот — мышью или A/D.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Режим управления персонажем: 'camera' или 'body'. */
export type ControlMode = 'camera' | 'body'

export interface Tuning {
  // ── Персонаж: скорости ────────────────────────────────────────────────────
  /** Скорость ходьбы, м/с. */
  walkSpeed: number
  /** Во сколько раз спринт быстрее ходьбы (Shift). */
  sprintMultiplier: number
  /** Задний ход — доля от обычной скорости. */
  backSpeedFactor: number
  /** Насколько резко персонаж набирает скорость, 1/с. Больше — быстрее. */
  accelRate: number
  /** Насколько резко персонаж тормозит, 1/с. */
  brakeRate: number
  /** Управление в воздухе, 1/с. Меньше — «вязче» в прыжке. */
  airControlRate: number

  // ── Персонаж: поворот ─────────────────────────────────────────────────────
  /** Режим управления: 'camera' (WASD от камеры) или 'body' (A/D крутят). */
  controlMode: ControlMode
  /** Максимальная скорость поворота корпуса, рад/с. */
  bodyTurnRate: number
  /** Сглаживание поворота корпуса, 1/с. Больше — догоняет прицел быстрее. */
  bodyTurnResponse: number
  /** Скорость поворота камеры клавишами A/D, рад/с (режим 'body'). */
  cameraKeyTurnRate: number
  /** Чувствительность мыши. Больше — быстрее поворот камеры. */
  mouseSensitivity: number
  /**
   * Чувствительность обзора пальцем, рад/пиксель.
   * Больше, чем у мыши: палец на телефоне двигается короче и грубее.
   */
  touchLookSensitivity: number
  /** Максимальный крен корпуса в повороте, радианы. */
  maxLean: number

  // ── Персонаж: прыжок и бордюры ────────────────────────────────────────────
  /** Высота прыжка: начальная вертикальная скорость, м/с. */
  jumpSpeed: number
  /** Максимальная высота ступеньки, на которую персонаж запрыгивает, м. */
  maxStepHeight: number
  /** Импульс вверх при перешагивании бордюра, м/с. */
  stepHopSpeed: number
  /** Минимальная высота ступеньки (ниже — игнорируем швы). */
  minStepHeight: number
  /** Насколько далеко ищем бордюр впереди, м. */
  stepLookAhead: number
  /** Пауза между прыжками через бордюр, с. */
  stepHopCooldown: number
  /** Сколько секунд после касания земля считается «под ногами», с. */
  groundSticky: number
}

export const TUNING: Tuning = {
  walkSpeed: 5.4,
  sprintMultiplier: 1.8,
  backSpeedFactor: 0.55,
  accelRate: 16,
  brakeRate: 18,
  airControlRate: 6,

  controlMode: 'camera',
  bodyTurnRate: 6.5,
  bodyTurnResponse: 12,
  cameraKeyTurnRate: 1.9,
  mouseSensitivity: 0.0026,
  touchLookSensitivity: 0.006,
  maxLean: 0.22,

  jumpSpeed: 8.8,
  maxStepHeight: 0.45,
  stepHopSpeed: 3.2,
  minStepHeight: 0.04,
  stepLookAhead: 0.7,
  stepHopCooldown: 0.45,
  groundSticky: 0.1,
}

// Dev-хук: можно править настройки прямо в консоли браузера, без перезапуска.
//   __tuning.walkSpeed = 9
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __tuning: Tuning }).__tuning = TUNING
}
