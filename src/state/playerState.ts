import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'

/**
 * Плоский, нереактивный канал связи между контроллером игрока и камерой.
 * Объекты мутируются на месте — без ре-рендеров и аллокаций в кадре.
 */
export const playerState = {
  position: new THREE.Vector3(0, 1, 0),
  /** Направление взгляда персонажа в радианах (0 = минус Z). */
  facing: 0,
  /** Горизонтальная скорость, м/с — для HUD и анимации шага. */
  speed: 0,
  grounded: true,
  /** Игрок за рулём: персонаж скрыт, скорость принадлежит машине. */
  driving: false,
  /** Курс машины (yaw тела), радианы. Локальная ось +Z — вперёд. */
  carYaw: 0,
  /** Направление движения машины в мире (нормированный, горизонтальный). */
  carForward: new THREE.Vector3(0, 0, 1),
  /**
   * Положение машины на предыдущем физическом шаге — с ним камера
   * интерполирует, чтобы не повторять ступенчатую физику.
   */
  carPositionPrev: new THREE.Vector3(0, 0, 0),
  /** Положение машины на текущем физическом шаге. */
  carPosition: new THREE.Vector3(0, 0, 0),
  /** Время последнего физического шага, мс (performance.now). */
  carStepTime: 0,
  /** Длительность физического шага, с. */
  carStepDuration: 1 / 60,
  /** Скорость машины вдоль её продольной оси, м/с (со знаком). */
  carForwardSpeed: 0,
  /** Скорость поворота кузова машины, рад/с (со знаком). */
  carYawRate: 0,
  /** Тело игрока — камера исключает его из своих лучей. */
  body: null as RapierRigidBody | null,
  /** Тело машины, пока игрок за рулём: камера исключает и его. */
  carBody: null as RapierRigidBody | null,
  /** Насколько кузов машины перевёрнут: 1 — стоит на колёсах, 0 — на боку. */
  carUpY: 1,
}

// Dev-хук: позволяет из devtools/теста телепортировать игрока.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __playerState: typeof playerState }).__playerState = playerState
}
