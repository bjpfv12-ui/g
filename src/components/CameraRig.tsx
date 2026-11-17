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

const target = new THREE.Vector3()
const desired = new THREE.Vector3()
const offset = new THREE.Vector3()
const direction = new THREE.Vector3()
const right = new THREE.Vector3()

export function CameraRig() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const { world, rapier } = useRapier()
  const lookTarget = useRef(new THREE.Vector3(0, 1.5, 0))

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const input = useInputStore.getState()
    const mouse = input.consumeMouseDelta()
    const cam = useCameraStore.getState()

    // ─── Орбита мышью ─────────────────────────────────────────────────────────
    if (mouse.x !== 0 || mouse.y !== 0) {
      const nextYaw = cam.yaw - mouse.x * SENSITIVITY
      const nextPitch = THREE.MathUtils.clamp(
        cam.pitch + mouse.y * SENSITIVITY,
        MIN_PITCH,
        MAX_PITCH,
      )
      cam.setYaw(nextYaw)
      cam.setPitch(nextPitch)
    }

    const yaw = cam.yaw
    const pitch = cam.pitch
    const distance = cam.distance

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
      const ray = new rapier.Ray(
        { x: target.x, y: target.y, z: target.z },
        { x: direction.x, y: direction.y, z: direction.z },
      )
      const hit = world.castRay(
        ray,
        fullDistance,
        true,
        undefined,
        undefined,
        undefined,
        playerState.body ?? undefined,
      )
      if (hit) {
        const safe = Math.max(1.4, hit.timeOfImpact - 0.35)
        desired.copy(target).addScaledVector(direction, safe)
      }
    }

    // ─── Сглаживание ─────────────────────────────────────────────────────────
    const lambda = 12
    camera.position.lerp(desired, 1 - Math.exp(-lambda * dt))
    lookTarget.current.lerp(target, 1 - Math.exp(-18 * dt))
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
