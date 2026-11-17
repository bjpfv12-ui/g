import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, useRapier, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier'
import { useInputStore } from '../store/InputStore'
import { useCameraStore } from '../store/CameraStore'
import { playerState } from '../state/playerState'
import { PLAYER_HEIGHT } from '../world/cityConfig'

const RADIUS = 0.34
const HALF_HEIGHT = (PLAYER_HEIGHT - RADIUS * 2) / 2
const FOOT_OFFSET = HALF_HEIGHT + RADIUS

const WALK_SPEED = 5.4
/** Спринт ровно в 1.8 раза быстрее ходьбы. */
const SPRINT_SPEED = WALK_SPEED * 1.8
const JUMP_SPEED = 8.8
const STEP_HOP_SPEED = 3.4
const MAX_STEP_HEIGHT = 0.45
/** Сколько секунд после схода с земли ещё можно прыгнуть. */
const COYOTE_TIME = 0.12

/** Длина шага: на такой дистанции нога проходит полный цикл. */
const STRIDE_LENGTH = 2.0
/** Максимальный крен корпуса в повороте, радианы. */
const MAX_LEAN = 0.22
/** Скорость поворота (рад/с), при которой крен выходит на максимум. */
const LEAN_RESPONSE = 0.06
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

/** Плавный поворот угла через кратчайшую дугу. */
function lerpAngle(current: number, target: number, t: number): number {
  return current + angleDiff(target, current) * t
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
  /** Текущий крен корпуса, -1..1. */
  const leanAmount = useRef(0)
  /** Текущий наклон вперёд, радианы. */
  const pitchAmount = useRef(0)

  useFrame((_, delta) => {
    const rb = body.current
    if (!rb) return
    playerState.body = rb
    const dt = Math.min(delta, 1 / 30)

    const input = useInputStore.getState()
    const keys = input.keys

    // ─── Ввод → направление в плоскости ───────────────────────────────────────
    let forward = 0
    let strafe = 0
    if (keys['KeyW'] || keys['ArrowUp']) forward += 1
    if (keys['KeyS'] || keys['ArrowDown']) forward -= 1
    if (keys['KeyD'] || keys['ArrowRight']) strafe += 1
    if (keys['KeyA'] || keys['ArrowLeft']) strafe -= 1
    const sprint = !!(keys['ShiftLeft'] || keys['ShiftRight'])

    const inputLength = Math.hypot(forward, strafe)
    const yaw = useCameraStore.getState().yaw

    let dirX = 0
    let dirZ = 0
    if (inputLength > 0) {
      const f = forward / inputLength
      const s = strafe / inputLength
      // Вперёд/вбок относительно взгляда камеры, а не мировых осей.
      dirX = -Math.sin(yaw) * f + Math.cos(yaw) * s
      dirZ = -Math.cos(yaw) * f - Math.sin(yaw) * s
    }

    const position = rb.translation()
    const velocity = rb.linvel()

    // ─── Опора ────────────────────────────────────────────────────────────────
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
    let grounded = groundHit !== null
    coyote.current = grounded ? COYOTE_TIME : Math.max(0, coyote.current - dt)

    // ─── Горизонтальное движение с ускорением ─────────────────────────────────
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED
    const targetX = dirX * speed
    const targetZ = dirZ * speed
    // В воздухе управление вялое — как в GTA.
    const groundedLambda = grounded ? 16 : 5
    let vx = THREE.MathUtils.damp(velocity.x, targetX, groundedLambda, dt)
    let vz = THREE.MathUtils.damp(velocity.z, targetZ, groundedLambda, dt)

    // ─── Прыжок ───────────────────────────────────────────────────────────────
    const jumpPressed = input.consumePress('Space')
    if (jumpPressed && coyote.current > 0) {
      vx = velocity.x
      vz = velocity.z
      rb.setLinvel({ x: vx, y: JUMP_SPEED, z: vz }, true)
      coyote.current = 0
      grounded = false
    } else {
      rb.setLinvel({ x: vx, y: velocity.y, z: vz }, true)
    }

    // ─── Перешагивание бордюров ───────────────────────────────────────────────
    const currentSpeed = Math.hypot(velocity.x, velocity.z)
    if (
      grounded &&
      coyote.current > 0 &&
      inputLength > 0 &&
      currentSpeed < speed * 0.45
    ) {
      const feetY = position.y - FOOT_OFFSET
      const stepRay = new rapier.Ray(
        { x: position.x, y: feetY + 0.12, z: position.z },
        { x: dirX, y: 0, z: dirZ },
      )
      const stepHit = world.castRay(
        stepRay,
        0.85,
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
          if (top - feetY <= MAX_STEP_HEIGHT) {
            rb.setLinvel({ x: vx, y: STEP_HOP_SPEED, z: vz }, true)
          }
        }
      }
    }

    // ─── Поворот персонажа ────────────────────────────────────────────────────
    let turnDelta = 0
    if (inputLength > 0) {
      const targetFacing = Math.atan2(-dirX, -dirZ)
      turnDelta = angleDiff(targetFacing, facing.current)
      facing.current = lerpAngle(facing.current, targetFacing, 1 - Math.exp(-16 * dt))
    }
    playerState.facing = facing.current

    const horizontalSpeed = Math.hypot(vx, vz)
    playerState.speed = horizontalSpeed
    playerState.grounded = grounded
    playerState.position.set(position.x, position.y, position.z)

    // ─── Крен в повороте ──────────────────────────────────────────────────────
    // Поворот тем быстрее, чем больше угол остался довернуть; крен пропорционален
    // скорости поворота. В воздухе корпус держим ровно.
    const appliedTurn = turnDelta * (1 - Math.exp(-16 * dt))
    const turnSpeed = dt > 0 ? appliedTurn / dt : 0
    const leanTarget = grounded
      ? THREE.MathUtils.clamp(turnSpeed * LEAN_RESPONSE, -1, 1)
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

      const stride = THREE.MathUtils.clamp(horizontalSpeed / WALK_SPEED, 0, 1)
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
      lean.current.rotation.z = leanAmount.current * MAX_LEAN
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
