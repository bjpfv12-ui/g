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
  /** Тело игрока — камера исключает его из своих лучей. */
  body: null as RapierRigidBody | null,
}
