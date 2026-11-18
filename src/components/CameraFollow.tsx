import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useInputStore } from '../store/InputStore'
import { useCameraStore } from '../store/CameraStore'
import { playerState } from '../state/playerState'
import { TUNING } from '../tuning'

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

// ─── Камера за рулём: GTA-стиль ──────────────────────────────────────────────
/** Расстояние от машины до камеры по «пружине», м. */
const CAR_DISTANCE = 6
/** Высота камеры над машиной, м. */
const CAR_HEIGHT = 3
/**
 * Наклон камеры, соответствующий высоте CAR_HEIGHT на расстоянии
 * CAR_DISTANCE: sin(pitch)·distance = CAR_HEIGHT.
 */
const CAR_PITCH = Math.asin(CAR_HEIGHT / CAR_DISTANCE)
/** Насколько быстро камера доворачивает за машину, 1/с. */
const CAR_ALIGN_RATE = 9
/** Сколько секунд без движения мыши камера возвращается за машину, с. */
const CAR_ALIGN_DELAY = 0.5
/** Точка взгляда смещена вперёд по курсу машины, м. */
const CAR_LOOKAHEAD = 2
/** Высота точки взгляда над центром машины, м. */
const CAR_LOOK_HEIGHT = 1.2
/** Поле зрения на максимальной скорости. */
const CAR_FOV_FAST = 78

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
const carPos = new THREE.Vector3()
const lookPoint = new THREE.Vector3()
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
  /** Были ли мы за рулём в прошлом кадре — для отслеживания посадки. */
  const wasDriving = useRef(false)
  /** Длина «пружины» камеры: 1 — вся дистанция, меньше — подтянута препятствием. */
  const pullScale = useRef(1)

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
      const nextYaw = cam.yaw - mouse.x * TUNING.mouseSensitivity
      const nextPitch = THREE.MathUtils.clamp(
        cam.pitch + mouse.y * TUNING.mouseSensitivity,
        MIN_PITCH,
        MAX_PITCH,
      )
      cam.setYaw(nextYaw)
      cam.setPitch(nextPitch)
    } else {
      mouseIdle.current += dt
    }

    // ─── Поворот камеры клавишами A/D ─────────────────────────────────────────
    // Только в режиме 'body': там A/D доворачивают персонажа, и камера
    // встаёт за спину. В режиме 'camera' A/D — это шаг вбок, и камера
    // остаётся там, куда её повернула мышь.
    if (!playerState.driving && TUNING.controlMode === 'body') {
      const keys = input.keys
      const turn =
        (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) +
        (keys['KeyD'] || keys['ArrowRight'] ? -1 : 0)
      if (turn !== 0) {
        const store = useCameraStore.getState()
        store.setYaw(store.yaw + turn * TUNING.cameraKeyTurnRate * dt)
      }
    }

    // ─── Камера за рулём: авто-следование за машиной ─────────────────────────
    // Камера стоит на «пружине» позади машины и плавно доворачивает за её
    // курсом. Мышь временно перехватывает управление, но через полсекунды
    // без движения мыши камера сама возвращается в идеальное положение.
    const driving = playerState.driving
    if (driving) {
      if (!wasDriving.current) {
        // Только что сели — ставим камеру за машину сразу, без рывка.
        wasDriving.current = true
        const store = useCameraStore.getState()
        store.setYaw(playerState.carYaw + Math.PI)
        store.setPitch(CAR_PITCH)
        mouseIdle.current = CAR_ALIGN_DELAY + 0.1
      }

      if (mouseIdle.current > CAR_ALIGN_DELAY) {
        const store = useCameraStore.getState()
        const t = 1 - Math.exp(-CAR_ALIGN_RATE * dt)
        // При yaw = 0 камера смотрит в -Z, а машина едет локальной осью +Z —
        // значит целевой yaw на π больше курса машины.
        store.setYaw(lerpAngle(store.yaw, playerState.carYaw + Math.PI, t))
        store.setPitch(THREE.MathUtils.lerp(store.pitch, CAR_PITCH, t))
      }
    } else {
      wasDriving.current = false
    }

    const yaw = useCameraStore.getState().yaw
    const pitch = useCameraStore.getState().pitch
    const distance = driving ? CAR_DISTANCE : useCameraStore.getState().distance

    if (driving) {
      // Ось «пружины» — центр машины. Камера висит на 6 м позади и 3 м выше.
      //
      // Положение машины интерполируется между двумя последними шагами
      // физики: сама физика ступенчатая (1/60 с), и без интерполяции камера
      // дёргалась бы вслед за каждым шагом.
      const alpha = THREE.MathUtils.clamp(
        (performance.now() - playerState.carStepTime) /
          (playerState.carStepDuration * 1000),
        0,
        1,
      )
      carPos.lerpVectors(
        playerState.carPositionPrev,
        playerState.carPosition,
        alpha,
      )
      target.copy(carPos)

      // Взгляд — не строго в корму: точка смещена вперёд по курсу машины,
      // поэтому дорога видна заранее, а машина сидит в кадре по центру снизу.
      lookPoint.copy(carPos).addScaledVector(playerState.carForward, CAR_LOOKAHEAD)
      lookPoint.y = carPos.y + CAR_LOOK_HEIGHT
    } else {
      // ─── Цель — чуть выше головы ───────────────────────────────────────────
      target.set(
        playerState.position.x,
        playerState.position.y + HEIGHT_OFFSET,
        playerState.position.z,
      )
      lookPoint.copy(target)
    }

    const cosPitch = Math.cos(pitch)
    offset.set(
      Math.sin(yaw) * cosPitch,
      Math.sin(pitch),
      Math.cos(yaw) * cosPitch,
    )
    offset.multiplyScalar(distance)

    // Лёгкий сдвиг камеры вбок — «через плечо», как в GTA. За рулём сдвиг
    // убран: машина должна оставаться в центре кадра.
    right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    desired.copy(target).add(offset).addScaledVector(right, driving ? 0 : SHOULDER_OFFSET)

    // ─── Коллизия камеры со стенами ───────────────────────────────────────────
    direction.copy(desired).sub(target)
    const fullDistance = direction.length()
    if (fullDistance > 0.001) {
      direction.divideScalar(fullDistance)
      // Перпендикуляр к направлению взгляда — для смещения проб.
      up.copy(direction).cross(right)
      if (up.lengthSq() < 1e-6) up.set(0, 1, 0)
      else up.normalize()

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
        // За рулём луч стартует внутри кузова: его коллайдер надо исключить,
        // иначе камера прижимается к машине вплотную и не видно дороги.
        const carCollider = playerState.carBody?.collider(0)
        const hit = world.castRay(
          ray,
          probeLength,
          true,
          undefined,
          undefined,
          carCollider ?? undefined,
          playerState.body ?? undefined,
        )
        if (hit) {
          const free = (hit.timeOfImpact * probeLength - WALL_MARGIN) / fullDistance
          if (free < allowed) allowed = free
        }
      }

      if (allowed < 1) {
        // Результат пробы скачет: луч то цепляет столб, то нет. На скорости
        // это рвёт камеру — поэтому длину пружины подтягиваем плавно.
        const targetScale = Math.max(MIN_DISTANCE / fullDistance, allowed)
        pullScale.current +=
          (targetScale - pullScale.current) * (1 - Math.exp(-6 * dt))
        const safe = Math.max(MIN_DISTANCE, pullScale.current * fullDistance)
        desired.copy(target).addScaledVector(direction, safe)
      } else {
        // Препятствие ушло — пружина так же плавно расправляется.
        pullScale.current += (1 - pullScale.current) * (1 - Math.exp(-6 * dt))
      }
    }

    // Камера не проваливается под землю, даже если смотреть сильно вверх.
    desired.y = Math.max(desired.y, GROUND_CLEARANCE)

    // ─── Сглаживание ─────────────────────────────────────────────────────────
    camera.position.lerp(desired, 1 - Math.exp(-FOLLOW_LAMBDA * dt))
    lookTarget.current.lerp(lookPoint, 1 - Math.exp(-LOOK_LAMBDA * dt))
    camera.lookAt(lookTarget.current)

    // Поле зрения: на бегу чуть шире, за рулём — шире с ростом скорости.
    let targetFov = BASE_FOV
    if (driving) {
      const fast = THREE.MathUtils.clamp(playerState.speed / TUNING.carMaxSpeed, 0, 1)
      targetFov = THREE.MathUtils.lerp(BASE_FOV, CAR_FOV_FAST, fast)
    } else if (playerState.speed > 7.5) {
      targetFov = SPRINT_FOV
    }
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, dt)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
