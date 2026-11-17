import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mulberry32 } from '../world/cityLayout'

const CLOUD_COUNT = 48
/** Поле облаков: квадрат со стороной FIELD, центрированный на городе. */
const FIELD = 900
const WIND = 2.6
const DRIFT = 0.35

interface Cloud {
  x: number
  y: number
  z: number
  /** Габарит плиты: ширина, толщина, длина. */
  w: number
  h: number
  d: number
  /** Наклон плиты, чтобы облака не выглядели плитами одного уровня. */
  tilt: number
  yaw: number
}

/**
 * Простые облака: белые полупрозрачные плиты, висящие над городом.
 * Никаких текстур — плоская заливка, как в старых консольных играх.
 */
export function Clouds() {
  const ref = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])

  const clouds = useMemo(() => {
    const rng = mulberry32(90210)
    const result: Cloud[] = []
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const w = 90 + rng() * 190
      result.push({
        x: (rng() * 2 - 1) * (FIELD / 2),
        y: 85 + rng() * 140,
        z: (rng() * 2 - 1) * (FIELD / 2),
        w,
        h: 3 + rng() * 7,
        d: w * (0.5 + rng() * 0.6),
        tilt: (rng() - 0.5) * 0.22,
        yaw: rng() * Math.PI,
      })
    }
    return result
  }, [])

  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const position = useMemo(() => new THREE.Vector3(), [])
  const scale = useMemo(() => new THREE.Vector3(), [])
  const quaternion = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    mesh.frustumCulled = false
    // Dev-хук: позволяет из devtools/теста подкрасить облака.
    if (import.meta.env.DEV) {
      ;(globalThis as unknown as { __clouds: THREE.InstancedMesh }).__clouds = mesh
    }
  }, [])

  useFrame((_, delta) => {
    const mesh = ref.current
    if (!mesh) return
    const dt = Math.min(delta, 1 / 30)
    const half = FIELD / 2

    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i]

      // Ветер: плиты плывут и уходят за границу поля по кругу.
      cloud.x += WIND * dt
      cloud.z += DRIFT * dt
      if (cloud.x > half) cloud.x = -half
      if (cloud.z > half) cloud.z = -half

      euler.set(cloud.tilt, cloud.yaw, cloud.tilt * 0.6)
      quaternion.setFromEuler(euler)
      position.set(cloud.x, cloud.y, cloud.z)
      scale.set(cloud.w, cloud.h, cloud.d)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, CLOUD_COUNT]} frustumCulled={false}>
      <meshStandardMaterial
        color="#ffffff"
        emissive="#ffffff"
        emissiveIntensity={0.75}
        roughness={1}
        metalness={0}
        transparent
        opacity={0.6}
        depthWrite={false}
        fog={false}
      />
    </instancedMesh>
  )
}
