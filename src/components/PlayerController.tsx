import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, useRapier, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier'
import { useInputStore } from '../store/InputStore'
import { useCameraStore } from '../store/CameraStore'
import { useCarStore } from '../store/CarStore'
import { playerState } from '../state/playerState'
import { PLAYER_HEIGHT } from '../world/cityConfig'
import { TUNING } from '../tuning'

const RADIUS = 0.34
const HALF_HEIGHT = (PLAYER_HEIGHT - RADIUS * 2) / 2
const FOOT_OFFSET = HALF_HEIGHT + RADIUS

/** Сколько секунд после схода с земли ещё можно прыгнуть. */
const COYOTE_TIME = 0.12
/** Скорость поворота (рад/с), при которой крен выходит на максимум. */
const LEAN_FULL_RATE = 5
/** Длина шага: на такой дистанции нога проходит полный цикл. */
const STRIDE_LENGTH = 2.0
const LEAN_SMOOTHING = 9
/** Наклон вперёд на спринте, радианы. */
const SPRINT_PITCH = 0.2
const SPRINT_PITCH_SMOOTHING = 7

const JACKET = '#3f6f78'
const PANTS = '#333b48'
const SKIN = '#e0a97e'
const HAIR = '#3a2b21'
const SHOE = '#1f2328'
const BAG = '#6b4a33'

/** Разница углов по кратчайшей дуге, от -π до π. */
function angleDiff(target: number, current: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

export function PlayerController({ spawn }: { spawn: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null)
  const { world, rapier } = useRapier()

  const visual = useRef<THREE.Group>(null)
  /** Внутренняя группа: крен в повороте и наклон вперёд на спринте. */
  const lean = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)

  const facing = useRef(0)
  const phase = useRef(0)
  const coyote = useRef(0)
  /** Сколько ещё секунд земля считается «под ногами». */
  const groundTimer = useRef(0)
  /** Сколько ещё секунд нельзя прыгать через бордюр. */
  const hopCooldown = useRef(0)
  /** Текущий крен корпуса, -1..1. */
  const leanAmount = useRef(0)
  /** Текущий наклон вперёд, радианы. */
  const pitchAmount = useRef(0)

  useFrame((_, delta) => {
    const rb = body.current
    if (!rb) return
    playerState.body = rb
    const dt = Math.min(delta, 1 / 30)

    // ─── За рулём персонаж отключён ─────────────────────────────────────────
    // Управляет машина (CarController), она же пишет позицию и скорость.
    if (useCarStore.getState().isDriving) {
      if (visual.current) visual.current.visible = false
      return
    }
    if (visual.current) visual.current.visible = true

    const input = useInputStore.getState()
    const keys = input.keys
    const t = TUNING

    // ─── Ввод ─────────────────────────────────────────────────────────────────
    const forwardInput = !!(keys['KeyW'] || keys['ArrowUp'])
    const backwardInput = !!(keys['KeyS'] || keys['ArrowDown'])
    const strafeRight = !!(keys['KeyD'] || keys['ArrowRight'])
    const strafeLeft = !!(keys['KeyA'] || keys['ArrowLeft'])
    const sprint = !!(keys['ShiftLeft'] || keys['ShiftRight'])

    const position = rb.translation()
    const velocity = rb.linvel()

    const camYaw = useCameraStore.getState().yaw
    // Режим 'body' — GTA: A/D доворачивают камеру (CameraFollow), ход идёт по
    // курсу корпуса. Режим 'camera' — привычное WASD относительно взгляда камеры.
    const bodyMode = t.controlMode === 'body'

    let dirX = 0
    let dirZ = 0
    /** Продольная составляющая: >0 — вперёд, <0 — назад. */
    let forward = 0

    if (bodyMode) {
      if (forwardInput !== backwardInput) {
        forward = forwardInput ? 1 : -1
        const sinH = Math.sin(facing.current)
        const cosH = Math.cos(facing.current)
        dirX = -sinH * forward
        dirZ = -cosH * forward
      }
    } else {
      let f = 0
      let s = 0
      if (forwardInput) f += 1
      if (backwardInput) f -= 1
      if (strafeRight) s += 1
      if (strafeLeft) s -= 1
      const len = Math.hypot(f, s)
      if (len > 0) {
        f /= len
        s /= len
        forward = f
        // Вперёд/вбок относительно взгляда камеры, а не мировых осей.
        dirX = -Math.sin(camYaw) * f + Math.cos(camYaw) * s
        dirZ = -Math.cos(camYaw) * f - Math.sin(camYaw) * s
      }
    }
    const moving = dirX !== 0 || dirZ !== 0

    // ─── Доворот корпуса ──────────────────────────────────────────────────────
    // В режиме 'camera' корпус доворачивается туда, куда идёт; в режиме 'body' —
    // к прицелу, следом за камерой. Скорость ограничена, чтобы модель не
    // проворачивалась рывком на пол-оборота.
    let targetFacing = facing.current
    if (bodyMode) targetFacing = camYaw
    else if (moving) targetFacing = Math.atan2(-dirX, -dirZ)
    const yawDiff = angleDiff(targetFacing, facing.current)
    const turnStep = THREE.MathUtils.clamp(
      yawDiff * (1 - Math.exp(-t.bodyTurnResponse * dt)),
      -t.bodyTurnRate * dt,
      t.bodyTurnRate * dt,
    )
    facing.current += turnStep

    // ─── Опора ────────────────────────────────────────────────────────────────
    // Земля держится «липкой»: после касания ещё ненадолго считаем, что
    // персонаж стоит на земле. Иначе луч-детектор дрожит на стыках плиток,
    // и скорость хода пульсирует.
    const groundRay = new rapier.Ray(
      { x: position.x, y: position.y, z: position.z },
      { x: 0, y: -1, z: 0 },
    )
    const groundHit = world.castRay(
      groundRay,
      FOOT_OFFSET + 0.14,
      true,
      undefined,
      undefined,
      undefined,
      rb,
    )
    if (groundHit) groundTimer.current = t.groundSticky
    groundTimer.current = Math.max(0, groundTimer.current - dt)
    let grounded = groundTimer.current > 0
    coyote.current = grounded ? COYOTE_TIME : Math.max(0, coyote.current - dt)

    // ─── Горизонтальное движение с ускорением ─────────────────────────────────
    const baseSpeed = sprint ? t.walkSpeed * t.sprintMultiplier : t.walkSpeed
    const speed = forward < 0 ? baseSpeed * t.backSpeedFactor : baseSpeed
    const targetX = dirX * speed
    const targetZ = dirZ * speed
    // В воздухе управление вялое — как в GTA.
    const lambda = grounded ? (moving ? t.accelRate : t.brakeRate) : t.airControlRate
    let vx = THREE.MathUtils.damp(velocity.x, targetX, lambda, dt)
    let vz = THREE.MathUtils.damp(velocity.z, targetZ, lambda, dt)

    // ─── Прыжок ───────────────────────────────────────────────────────────────
    const jumpPressed = input.consumePress('Space')
    if (jumpPressed && coyote.current > 0) {
      vx = velocity.x
      vz = velocity.z
      rb.setLinvel({ x: vx, y: t.jumpSpeed, z: vz }, true)
      coyote.current = 0
      grounded = false
    } else {
      rb.setLinvel({ x: vx, y: velocity.y, z: vz }, true)
    }

    // ─── Перешагивание бордюров ───────────────────────────────────────────────
    // Ступеньку ищем лучом заранее, до столкновения: персонаж наезжает на
    // бордюр без остановки. Раньше прыжок срабатывал уже после торможения, и
    // ход рвался на каждом бордюре.
    if (hopCooldown.current > 0) {
      hopCooldown.current = Math.max(0, hopCooldown.current - dt)
    }
    if (grounded && moving && hopCooldown.current <= 0) {
      const feetY = position.y - FOOT_OFFSET
      const stepRay = new rapier.Ray(
        { x: position.x, y: feetY + 0.12, z: position.z },
        { x: dirX, y: 0, z: dirZ },
      )
      const stepHit = world.castRay(
        stepRay,
        t.stepLookAhead,
        true,
        undefined,
        undefined,
        undefined,
        rb,
      )
      if (stepHit) {
        const shape = stepHit.collider.shape as {
          halfExtents?: { x: number; y: number; z: number }
        }
        if (shape.halfExtents) {
          const top = stepHit.collider.translation().y + shape.halfExtents.y
          const rise = top - feetY
          // Запрыгиваем только на настоящую ступеньку: не на шов и не на стену.
          if (rise > t.minStepHeight && rise <= t.maxStepHeight) {
            rb.setLinvel({ x: vx, y: t.stepHopSpeed, z: vz }, true)
            hopCooldown.current = t.stepHopCooldown
            grounded = false
          }
        }
      }
    }

    // ─── Поворот персонажа ────────────────────────────────────────────────────
    playerState.facing = facing.current

    const horizontalSpeed = Math.hypot(vx, vz)
    playerState.speed = horizontalSpeed
    playerState.grounded = grounded
    playerState.position.set(position.x, position.y, position.z)

    // ─── Крен в повороте ──────────────────────────────────────────────────────
    // Крен пропорционален скорости поворота корпуса. На бегу он заметнее,
    // стоя — едва заметен.
    const turnSpeed = dt > 0 ? turnStep / dt : 0
    const leanTarget = grounded
      ? THREE.MathUtils.clamp(turnSpeed / LEAN_FULL_RATE, -1, 1) * (moving ? 1 : 0.45)
      : 0
    leanAmount.current = THREE.MathUtils.damp(
      leanAmount.current,
      leanTarget,
      LEAN_SMOOTHING,
      dt,
    )

    // ─── Наклон вперёд на спринте ─────────────────────────────────────────────
    const pitchTarget = sprint && horizontalSpeed > 0.6 ? SPRINT_PITCH : 0
    pitchAmount.current = THREE.MathUtils.damp(
      pitchAmount.current,
      pitchTarget,
      SPRINT_PITCH_SMOOTHING,
      dt,
    )

    // ─── Анимация шага ────────────────────────────────────────────────────────
    if (visual.current) {
      visual.current.rotation.y = facing.current

      // Полный цикл шага — на дистанцию двух шагов.
      phase.current += (horizontalSpeed / (STRIDE_LENGTH * 2)) * Math.PI * 2 * dt

      const stride = THREE.MathUtils.clamp(horizontalSpeed / t.walkSpeed, 0, 1)
      // Амплитуда растёт с ускорением: на бегу шаг шире.
      const amplitude = (0.45 + 0.35 * stride) * stride
      const swing = Math.sin(phase.current) * amplitude

      if (leftLeg.current) leftLeg.current.rotation.x = swing
      if (rightLeg.current) rightLeg.current.rotation.x = -swing
      // Руки работают в противофазе с ногами.
      if (leftArm.current) leftArm.current.rotation.x = -swing * 0.75
      if (rightArm.current) rightArm.current.rotation.x = swing * 0.75

      // Лёгкое подпрыгивание корпуса на каждом шаге.
      visual.current.position.y = Math.abs(Math.sin(phase.current)) * 0.035 * stride
    }

    if (lean.current) {
      // Положительный крен — наклон влево, под поворот.
      lean.current.rotation.z = leanAmount.current * t.maxLean
      lean.current.rotation.x = -pitchAmount.current
    }
  })

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[spawn[0], spawn[1] + FOOT_OFFSET + 0.02, spawn[2]]}
      enabledRotations={[false, false, false]}
      lockRotations
      ccd
      friction={0.1}
      restitution={0}
      linearDamping={0.05}
    >
      <CapsuleCollider args={[HALF_HEIGHT, RADIUS]} />

      {/* Модель персонажа: начало координат — на уровне ступней */}
      <group ref={visual} position={[0, -FOOT_OFFSET, 0]}>
        {/* Крен корпуса и наклон вперёд — внутри группы поворота */}
        <group ref={lean}>
          {/* Ноги */}
          <group ref={leftLeg} position={[-0.13, 0.88, 0]}>
            <mesh position={[0, -0.43, 0]} castShadow>
              <boxGeometry args={[0.17, 0.86, 0.19]} />
              <meshStandardMaterial color={PANTS} roughness={0.9} />
            </mesh>
            <mesh position={[0, -0.82, 0.04]} castShadow>
              <boxGeometry args={[0.19, 0.11, 0.28]} />
              <meshStandardMaterial color={SHOE} roughness={0.7} />
            </mesh>
          </group>
          <group ref={rightLeg} position={[0.13, 0.88, 0]}>
            <mesh position={[0, -0.43, 0]} castShadow>
              <boxGeometry args={[0.17, 0.86, 0.19]} />
              <meshStandardMaterial color={PANTS} roughness={0.9} />
            </mesh>
            <mesh position={[0, -0.82, 0.04]} castShadow>
              <boxGeometry args={[0.19, 0.11, 0.28]} />
              <meshStandardMaterial color={SHOE} roughness={0.7} />
            </mesh>
          </group>

          {/* Торс */}
          <mesh position={[0, 1.2, 0]} castShadow>
            <capsuleGeometry args={[0.22, 0.34, 6, 14]} />
            <meshStandardMaterial color={JACKET} roughness={0.75} />
          </mesh>
          {/* Рюкзак — показывает, куда «смотрит» персонаж */}
          <mesh position={[0, 1.24, 0.22]} castShadow>
            <boxGeometry args={[0.3, 0.36, 0.16]} />
            <meshStandardMaterial color={BAG} roughness={0.85} />
          </mesh>

          {/* Руки */}
          <group ref={leftArm} position={[-0.31, 1.45, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow>
              <boxGeometry args={[0.12, 0.48, 0.14]} />
              <meshStandardMaterial color={JACKET} roughness={0.75} />
            </mesh>
          </group>
          <group ref={rightArm} position={[0.31, 1.45, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow>
              <boxGeometry args={[0.12, 0.48, 0.14]} />
              <meshStandardMaterial color={JACKET} roughness={0.75} />
            </mesh>
          </group>

          {/* Голова */}
          <mesh position={[0, 1.63, 0]} castShadow>
            <sphereGeometry args={[0.145, 18, 14]} />
            <meshStandardMaterial color={SKIN} roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.7, -0.02]} castShadow>
            <sphereGeometry args={[0.152, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={HAIR} roughness={0.95} />
          </mesh>
        </group>
      </group>
    </RigidBody>
  )
}
