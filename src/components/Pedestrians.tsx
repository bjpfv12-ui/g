import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { mulberry32 } from '../world/cityLayout'
import { worldState } from '../state/worldState'
import { withVertexColors } from './Instances'

const PED_COUNT = 30

const SHIRTS = ['#c96f5a', '#4e7f9c', '#d9b24a', '#6a8f5a', '#8f6bb0', '#c9c2b4', '#3f4a63', '#b8627f']
const PANTS = ['#3a3f4a', '#2f3540', '#4a4238', '#37414d']

interface Pedestrian {
  /** Индекс квартала по X и Z. */
  bi: number
  bj: number
  /** Позиция вдоль периметра тротуара. */
  s: number
  dir: 1 | -1
  speed: number
  /** Боковое смещение внутри полосы тротуара. */
  offset: number
  phase: number
  shirt: string
  pants: string
}

/** Точка на кольце тротуара вокруг квартала. */
function ringPoint(
  cx: number,
  cz: number,
  half: number,
  s: number,
  dir: 1 | -1,
  offset: number,
): { x: number; z: number; heading: number } {
  const perimeter = 8 * half
  let p = ((s % perimeter) + perimeter) % perimeter

  let x: number
  let z: number
  let heading: number

  if (p < 2 * half) {
    x = cx - half + p
    z = cz - half
    heading = 0
  } else if (p < 4 * half) {
    x = cx + half
    z = cz - half + (p - 2 * half)
    heading = Math.PI / 2
  } else if (p < 6 * half) {
    x = cx + half - (p - 4 * half)
    z = cz + half
    heading = Math.PI
  } else {
    x = cx - half
    z = cz + half - (p - 6 * half)
    heading = -Math.PI / 2
  }

  // Смещение перпендикулярно направлению движения.
  const nx = Math.sin(heading)
  const nz = Math.cos(heading)
  const lateral = offset * dir
  return { x: x + nx * lateral, z: z + nz * lateral, heading }
}

export function Pedestrians({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const torsoRef = useRef<THREE.InstancedMesh>(null)
  const headRef = useRef<THREE.InstancedMesh>(null)
  const legsRef = useRef<THREE.InstancedMesh>(null)

  const geometries = useMemo(
    () => ({
      torso: withVertexColors(new THREE.CapsuleGeometry(0.21, 0.44, 4, 10)),
      head: withVertexColors(new THREE.SphereGeometry(0.13, 12, 10)),
      leg: withVertexColors(new THREE.BoxGeometry(0.14, 0.78, 0.16)),
    }),
    [],
  )

  const rng = useMemo(() => mulberry32(config.seed + 4211), [config.seed])

  const pedestrians = useMemo(() => {
    const result: Pedestrian[] = []
    for (let i = 0; i < PED_COUNT; i++) {
      const half = config.blockSize / 2 - 2.5
      const perimeter = 8 * half
      result.push({
        bi: Math.floor(rng() * config.blocks),
        bj: Math.floor(rng() * config.blocks),
        s: rng() * perimeter,
        dir: rng() > 0.5 ? 1 : -1,
        speed: 1.1 + rng() * 0.9,
        offset: (rng() * 2 - 1) * 1.6,
        phase: rng() * Math.PI * 2,
        shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
        pants: PANTS[Math.floor(rng() * PANTS.length)],
      })
    }
    return result
  }, [config, rng])

  useLayoutEffect(() => {
    const torso = torsoRef.current
    const head = headRef.current
    const legs = legsRef.current
    if (!torso || !head || !legs) return
    const color = new THREE.Color()
    pedestrians.forEach((ped, i) => {
      color.set(ped.shirt)
      torso.setColorAt(i, color)
      color.set('#e0a97e')
      head.setColorAt(i, color)
      color.set(ped.pants)
      legs.setColorAt(i * 2, color)
      legs.setColorAt(i * 2 + 1, color)
    })
    if (torso.instanceColor) torso.instanceColor.needsUpdate = true
    if (head.instanceColor) head.instanceColor.needsUpdate = true
    if (legs.instanceColor) legs.instanceColor.needsUpdate = true
  }, [pedestrians])

  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const quaternion = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(), [])
  const position = useMemo(() => new THREE.Vector3(), [])
  const torsoScale = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const legScale = useMemo(() => new THREE.Vector3(1, 1, 1), [])

  useFrame((_, delta) => {
    const torso = torsoRef.current
    const head = headRef.current
    const legs = legsRef.current
    if (!torso || !head || !legs) return
    const dt = Math.min(delta, 1 / 30)

    const pitch = config.blockSize + config.roadWidth
    const linePos = (k: number) => (k - config.blocks / 2) * pitch
    const half = config.blockSize / 2 - 2.5

    for (let i = 0; i < pedestrians.length; i++) {
      const ped = pedestrians[i]
      ped.s += ped.dir * ped.speed * dt
      ped.phase += ped.speed * dt * 5.5

      const cx = linePos(ped.bi) + pitch / 2
      const cz = linePos(ped.bj) + pitch / 2
      const point = ringPoint(cx, cz, half, ped.s, ped.dir, ped.offset)

      const bob = Math.abs(Math.sin(ped.phase)) * 0.05
      euler.set(0, point.heading, 0)
      quaternion.setFromEuler(euler)

      position.set(point.x, 1.02 + bob, point.z)
      matrix.compose(position, quaternion, torsoScale)
      torso.setMatrixAt(i, matrix)

      position.set(point.x, 1.48 + bob, point.z)
      matrix.compose(position, quaternion, torsoScale)
      head.setMatrixAt(i, matrix)

      // Ноги: две фазы в противофазе.
      const swing = Math.sin(ped.phase) * 0.55
      for (let l = 0; l < 2; l++) {
        euler.set(l === 0 ? swing : -swing, point.heading, 0)
        quaternion.setFromEuler(euler)
        const side = l === 0 ? -0.11 : 0.11
        position.set(
          point.x + Math.cos(point.heading) * side,
          0.39,
          point.z - Math.sin(point.heading) * side,
        )
        matrix.compose(position, quaternion, legScale)
        legs.setMatrixAt(i * 2 + l, matrix)
      }

      const spot = worldState.pedestrians[i]
      if (spot) {
        spot.x = point.x
        spot.z = point.z
      } else {
        worldState.pedestrians.push({ x: point.x, z: point.z })
      }
    }

    torso.instanceMatrix.needsUpdate = true
    head.instanceMatrix.needsUpdate = true
    legs.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={torsoRef}
        args={[geometries.torso, undefined, PED_COUNT]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[geometries.head, undefined, PED_COUNT]} castShadow>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={legsRef}
        args={[geometries.leg, undefined, PED_COUNT * 2]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={0.9} />
      </instancedMesh>
    </group>
  )
}
