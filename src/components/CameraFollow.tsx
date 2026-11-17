import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useInputStore } from '../store/InputStore'
import { useCameraStore } from '../store/CameraStore'
import { playerState } from '../state/playerState'

const SENSITIVITY = 0.0022
const MIN_PITCH = -0.38
const MAX_PITCH = 1.2
const HEIGHT_OFFSET = 0.58
const SHOULDER_OFFSET = 0.55
const BASE_FOV = 66
const SPRINT_FOV = 74
/** Минимальная высота камеры над землёй, м. */
const GROUND_CLEARANCE = 0.9
/** Минимальное расстояние от камеры до игрока, м. */
const MIN_DISTANCE = 1.4
/** Отступ от препятствия, чтобы камера не липла к стене. */
const WALL_MARGIN = 0.35
/** Радиус проверки вокруг точки камеры, м. */
const PROBE_RADIUS = 0.45
/** Насколько резко камера догоняет игрока. */
const FOLLOW_LAMBDA = 12
/** Насколько резко камера доворачивает взгляд на игрока. */
const LOOK_LAMBDA = 18
/**
 * Камера возвращается за кузов только пока машина поворачивает: иначе
 * автоповорот перебивал бы мышь и игрок не мог бы осмотреться.
 *
 * Догоняет не мгновенно — с задержкой, поэтому в повороте кузов видно
 * сбоку, как в GTA, а не запертым прямо по курсу.
 */
const CAR_ALIGN_MOUSE_IDLE = 0.25
/** Насколько плавно камера догоняет курс машины, 1/с. */
const CAR_ALIGN_RATE = 2.6
/** Минимальная скорость машины, с которой камера возвращается за кузов, м/с. */
const CAR_ALIGN_SPEED = 1.5
/** Порог «машина поворачивает», рад/с. */
const CAR_TURN_RATE = 0.12

/** Разница углов по кратчайшей дуге, от -π до π. */
function angleDiff(target: number, current: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

/** Плавный поворот угла через кратчайшую дугу. */
function lerpAngle(current: number, target: number, t: number): number {
  return current + angleDiff(target, current) * t
}

/**
 * Точки, в которых проверяем препятствия: центр и четыре смещения, чтобы
 * камера не ныряла в углы стен.
 */
const PROBES: Array<[number, number]> = [
  [0, 0],
  [PROBE_RADIUS, 0],
  [-PROBE_RADIUS, 0],
  [0, PROBE_RADIUS],
  [0, -PROBE_RADIUS],
]

const target = new THREE.Vector3()
const desired = new THREE.Vector3()
const offset = new THREE.Vector3()
const direction = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const probePoint = new THREE.Vector3()
const probeDir = new THREE.Vector3()

export function CameraFollow() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const { world, rapier } = useRapier()
  const lookTarget = useRef(new THREE.Vector3(0, 1.5, 0))
  /** Сколько секунд прошло с последнего движения мыши. */
  const mouseIdle = useRef(0)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const input = useInputStore.getState()
    const mouse = input.consumeMouseDelta()
    const cam = useCameraStore.getState()

    // Dev-переопределение: свободная камера для обзорных снимков (скрипты).
    if (import.meta.env.DEV) {
      const free = (globalThis as { __freeCam?: { pos: number[]; look: number[] } }).__freeCam
      if (free) {
        camera.position.set(free.pos[0], free.pos[1], free.pos[2])
        camera.lookAt(free.look[0], free.look[1], free.look[2])
        return
      }
    }

    // ─── Орбита мышью ─────────────────────────────────────────────────────────
    if (mouse.x !== 0 || mouse.y !== 0) {
      mouseIdle.current = 0
      const nextYaw = cam.yaw - mouse.x * SENSITIVITY
      const nextPitch = THREE.MathUtils.clamp(
        cam.pitch + mouse.y * SENSITIVITY,
        MIN_PITCH,
        MAX_PITCH,
      )
      cam.setYaw(nextYaw)
      cam.setPitch(nextPitch)
    } else {
      mouseIdle.current += dt
    }

    // ─── Камера возвращается за машину ───────────────────────────────────────
    // Действует только пока машина реально поворачивает: тогда машина не
    // уезжает вбок из поля зрения. Мышь при этом всегда главнее — стоит
    // игроку дёрнуть мышь, автоповорот отпускает камеру.
    if (
      playerState.driving &&
      playerState.carForwardSpeed > CAR_ALIGN_SPEED &&
      Math.abs(playerState.carYawRate) > CAR_TURN_RATE &&
      mouseIdle.current > CAR_ALIGN_MOUSE_IDLE
    ) {
      // При yaw = 0 камера смотрит в -Z, а машина едет локальной осью +Z —
      // значит целевой yaw на π больше курса машины.
      const targetYaw = playerState.carYaw + Math.PI
      const store = useCameraStore.getState()
      store.setYaw(lerpAngle(store.yaw, targetYaw, 1 - Math.exp(-CAR_ALIGN_RATE * dt)))
    }

    const yaw = useCameraStore.getState().yaw
    const pitch = useCameraStore.getState().pitch
    const distance = useCameraStore.getState().distance

    // ─── Цель — чуть выше головы ─────────────────────────────────────────────
    target.set(
      playerState.position.x,
      playerState.position.y + HEIGHT_OFFSET,
      playerState.position.z,
    )

    const cosPitch = Math.cos(pitch)
    offset.set(
      Math.sin(yaw) * cosPitch,
      Math.sin(pitch),
      Math.cos(yaw) * cosPitch,
    )
    offset.multiplyScalar(distance)

    // Лёгкий сдвиг камеры вбок — «через плечо», как в GTA.
    right.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(SHOULDER_OFFSET)
    desired.copy(target).add(offset).add(right)

    // ─── Коллизия камеры со стенами ───────────────────────────────────────────
    direction.copy(desired).sub(target)
    const fullDistance = direction.length()
    if (fullDistance > 0.001) {
      direction.divideScalar(fullDistance)
      // Перпендикуляр к направлению взгляда — для смещения проб.
      up.copy(direction).cross(right).normalize()
      if (!Number.isFinite(up.x)) up.set(0, 1, 0)

      // Из нескольких лучей берём самый короткий свободный отрезок.
      let allowed = 1
      for (const [ox, oy] of PROBES) {
        probePoint.copy(desired).addScaledVector(right, ox).addScaledVector(up, oy)
        probeDir.copy(probePoint).sub(target)
        const probeLength = probeDir.length()
        if (probeLength < 0.001) continue
        probeDir.divideScalar(probeLength)

        const ray = new rapier.Ray(
          { x: target.x, y: target.y, z: target.z },
          { x: probeDir.x, y: probeDir.y, z: probeDir.z },
        )
        const hit = world.castRay(
          ray,
          probeLength,
          true,
          undefined,
          undefined,
          undefined,
          playerState.body ?? undefined,
        )
        if (hit) {
          const free = (hit.timeOfImpact * probeLength - WALL_MARGIN) / fullDistance
          if (free < allowed) allowed = free
        }
      }

      if (allowed < 1) {
        const safe = Math.max(MIN_DISTANCE, allowed * fullDistance)
        desired.copy(target).addScaledVector(direction, safe)
      }
    }

    // Камера не проваливается под землю, даже если смотреть сильно вверх.
    desired.y = Math.max(desired.y, GROUND_CLEARANCE)

    // ─── Сглаживание ─────────────────────────────────────────────────────────
    camera.position.lerp(desired, 1 - Math.exp(-FOLLOW_LAMBDA * dt))
    lookTarget.current.lerp(target, 1 - Math.exp(-LOOK_LAMBDA * dt))
    camera.lookAt(lookTarget.current)

    // Лёгкое расширение поля зрения на бегу — ощущение скорости.
    const sprinting = playerState.speed > 7.5
    const targetFov = sprinting ? SPRINT_FOV : BASE_FOV
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, dt)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
