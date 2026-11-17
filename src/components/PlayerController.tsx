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
const SPRINT_SPEED = 10.6
const JUMP_SPEED = 8.8
const STEP_HOP_SPEED = 3.4
const MAX_STEP_HEIGHT = 0.45

const JACKET = '#3f6f78'
const PANTS = '#333b48'
const SKIN = '#e0a97e'
const HAIR = '#3a2b21'
const SHOE = '#1f2328'
const BAG = '#6b4a33'

/** Плавный поворот угла через кратчайшую дугу. */
function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return current + diff * t
}

export function PlayerController({ spawn }: { spawn: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null)
  const { world, rapier } = useRapier()

  const visual = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)

  const facing = useRef(0)
  const phase = useRef(0)
  const coyote = useRef(0)

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
    coyote.current = grounded ? 0.12 : Math.max(0, coyote.current - dt)
    // ─── Горизонтальное движение с ускорением ─────────────────────────────────
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED
    const targetX = dirX * speed
    const targetZ = dirZ * speed
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

    // ─── Поворот персонажа и анимация шага ────────────────────────────────────
    if (inputLength > 0) {
      const targetFacing = Math.atan2(-dirX, -dirZ)
      facing.current = lerpAngle(facing.current, targetFacing, 1 - Math.exp(-16 * dt))
    }
    playerState.facing = facing.current

    const horizontalSpeed = Math.hypot(vx, vz)
    playerState.speed = horizontalSpeed
    playerState.grounded = grounded
    playerState.position.set(position.x, position.y, position.z)

    if (visual.current) {
      visual.current.rotation.y = facing.current
      const stride = Math.min(1, horizontalSpeed / WALK_SPEED)
      phase.current += horizontalSpeed * dt * 2.3
      const swing = Math.sin(phase.current) * 0.7 * stride
      if (leftLeg.current) leftLeg.current.rotation.x = swing
      if (rightLeg.current) rightLeg.current.rotation.x = -swing
      if (leftArm.current) leftArm.current.rotation.x = -swing * 0.7
      if (rightArm.current) rightArm.current.rotation.x = swing * 0.7
      visual.current.position.y = Math.abs(Math.sin(phase.current)) * 0.035 * stride
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
    </RigidBody>
  )
}
