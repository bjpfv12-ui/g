import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { generateCity, mulberry32, type BuildingDef } from '../world/cityLayout'
import { useInputStore } from '../store/InputStore'
import { useUiStore } from '../store/UiStore'
import { playerState } from '../state/playerState'
import { worldState } from '../state/worldState'
import { withVertexColors } from './Instances'

const MAX_DOORS = 26
const OPEN_ANGLE = -1.45
const INTERACT_RADIUS = 4.2

const SIGN_COLORS = ['#c96f5a', '#4e7f9c', '#d9b24a', '#6a8f5a', '#8f6bb0', '#b8627f']
const LEAF_COLORS = ['#5a4636', '#3f5560', '#6b4a33', '#4a5a4a', '#7a5a48']

interface Door {
  /** Позиция входа в мировых координатах (основание проёма). */
  x: number
  z: number
  /** Поворот локальной системы: локальный +Z смотрит наружу от фасада. */
  angle: number
  /** Смещение вдоль фасада. */
  shift: number
  open: boolean
  /** Текущий угол створки. */
  hinge: number
  sign: string
  leaf: string
}

/** Выбирает фасад, обращённый к дороге, и считает позицию входа. */
function pickFacade(
  building: BuildingDef,
  lines: number[],
  roadWidth: number,
): { axis: 0 | 1; side: 1 | -1; distance: number } {
  const [x, , z] = building.position
  const [w, , d] = building.size

  let best: { axis: 0 | 1; side: 1 | -1; distance: number } = {
    axis: 0,
    side: 1,
    distance: Infinity,
  }

  // Дороги, идущие вдоль X (их линии постоянны по Z).
  for (const line of lines) {
    const toNorth = line - roadWidth / 2 - (z + d / 2)
    const toSouth = z - d / 2 - (line + roadWidth / 2)
    if (toNorth >= -0.5 && toNorth < best.distance) best = { axis: 1, side: 1, distance: toNorth }
    if (toSouth >= -0.5 && toSouth < best.distance) best = { axis: 1, side: -1, distance: toSouth }
  }
  // Дороги, идущие вдоль Z (линии постоянны по X).
  for (const line of lines) {
    const toEast = line - roadWidth / 2 - (x + w / 2)
    const toWest = x - w / 2 - (line + roadWidth / 2)
    if (toEast >= -0.5 && toEast < best.distance) best = { axis: 0, side: 1, distance: toEast }
    if (toWest >= -0.5 && toWest < best.distance) best = { axis: 0, side: -1, distance: toWest }
  }
  return best
}

export function Doors({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const setDoorPrompt = useUiStore((state) => state.setDoorPrompt)
  const leaves = useRef<(THREE.Group | null)[]>([])
  const frameRef = useRef<THREE.InstancedMesh>(null)
  const interiorRef = useRef<THREE.InstancedMesh>(null)
  const signRef = useRef<THREE.InstancedMesh>(null)
  const lightRef = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => withVertexColors(new THREE.BoxGeometry(1, 1, 1)), [])

  const lines = useMemo(() => {
    const pitch = config.blockSize + config.roadWidth
    const result: number[] = []
    for (let k = 0; k <= config.blocks; k++) result.push((k - config.blocks / 2) * pitch)
    return result
  }, [config])

  const rng = useMemo(() => mulberry32(config.seed + 31337), [config.seed])

  const doors = useMemo(() => {
    const city = generateCity(config)
    const result: Door[] = []
    for (const building of city.buildings) {
      if (result.length >= MAX_DOORS) break
      if (building.size[1] < 9) continue
      if (rng() > 0.14) continue

      const facade = pickFacade(building, lines, config.roadWidth)
      const [x, baseY, z] = building.position
      const [w, , d] = building.size

      let angle: number
      let dx = 0
      let dz = 0
      let shift = 0

      if (facade.axis === 1) {
        // Фасад смотрит вдоль ±Z.
        angle = facade.side > 0 ? 0 : Math.PI
        dz = facade.side * (d / 2)
        shift = (rng() * 2 - 1) * Math.max(0, w / 2 - 3)
      } else {
        // Фасад смотрит вдоль ±X.
        angle = facade.side > 0 ? Math.PI / 2 : -Math.PI / 2
        dx = facade.side * (w / 2)
        shift = (rng() * 2 - 1) * Math.max(0, d / 2 - 3)
      }

      result.push({
        x: x + dx + Math.cos(angle) * shift,
        z: z + dz - Math.sin(angle) * shift,
        angle,
        shift,
        open: false,
        hinge: 0,
        sign: SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)],
        leaf: LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)],
      })
      void baseY
    }
    return result
  }, [config, lines, rng])

  // Статичные части входа — инстансингом, створки — отдельными мешами.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const interior = interiorRef.current
    const sign = signRef.current
    const light = lightRef.current
    if (!frame || !interior || !sign || !light) return

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const color = new THREE.Color()

    doors.forEach((door, index) => {
      euler.set(0, door.angle, 0)
      quaternion.setFromEuler(euler)

      const local = (lx: number, ly: number, lz: number) => {
        position.set(lx, ly, lz).applyQuaternion(quaternion)
        return position.clone().add(new THREE.Vector3(door.x, config.curbHeight, door.z))
      }

      // Стойки проёма и перемычка — три части на каждое крыло.
      for (let p = 0; p < 2; p++) {
        const side = p === 0 ? -0.93 : 0.93
        const point = local(side, 1.45, 0.42)
        scale.set(0.18, 2.9, 0.85)
        matrix.compose(point, quaternion, scale)
        frame.setMatrixAt(index * 3 + p, matrix)
      }
      const lintel = local(0, 2.72, 0.42)
      scale.set(2.05, 0.35, 0.85)
      matrix.compose(lintel, quaternion, scale)
      frame.setMatrixAt(index * 3 + 2, matrix)
      color.set('#8d8378')
      frame.setColorAt(index * 3, color)
      frame.setColorAt(index * 3 + 1, color)
      frame.setColorAt(index * 3 + 2, color)

      // Внутренняя ниша.
      const inner = local(0, 1.25, 0.06)
      scale.set(1.7, 2.5, 0.12)
      matrix.compose(inner, quaternion, scale)
      interior.setMatrixAt(index, matrix)
      color.set('#20242c')
      interior.setColorAt(index, color)

      // Свет в проёме.
      const lamp = local(0, 2.35, 0.13)
      scale.set(1.2, 0.2, 0.06)
      matrix.compose(lamp, quaternion, scale)
      light.setMatrixAt(index, matrix)
      color.set('#ffd79a')
      light.setColorAt(index, color)

      // Вывеска над входом.
      const board = local(0, 3.18, 0.12)
      scale.set(2.6, 0.42, 0.2)
      matrix.compose(board, quaternion, scale)
      sign.setMatrixAt(index, matrix)
      color.set(door.sign)
      sign.setColorAt(index, color)
    })

    frame.instanceMatrix.needsUpdate = true
    interior.instanceMatrix.needsUpdate = true
    sign.instanceMatrix.needsUpdate = true
    light.instanceMatrix.needsUpdate = true
    if (frame.instanceColor) frame.instanceColor.needsUpdate = true
    if (interior.instanceColor) interior.instanceColor.needsUpdate = true
    if (sign.instanceColor) sign.instanceColor.needsUpdate = true
    if (light.instanceColor) light.instanceColor.needsUpdate = true
  }, [doors, config.curbHeight])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const input = useInputStore.getState()
    const press = input.consumePress('KeyE')

    const px = playerState.position.x
    const pz = playerState.position.z

    worldState.doors.length = 0
    let nearest: Door | null = null
    let nearestDistance = INTERACT_RADIUS

    for (const door of doors) {
      worldState.doors.push({ x: door.x, z: door.z })
      const dx = door.x - px
      const dz = door.z - pz
      const distance = Math.hypot(dx, dz)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = door
      }
    }

    if (press && nearest) {
      nearest.open = !nearest.open
    }

    setDoorPrompt(
      nearest ? (nearest.open ? 'E — закрыть дверь' : 'E — открыть дверь') : null,
    )

    for (let i = 0; i < doors.length; i++) {
      const door = doors[i]
      door.hinge = THREE.MathUtils.damp(
        door.hinge,
        door.open ? OPEN_ANGLE : 0,
        6,
        dt,
      )
      const leaf = leaves.current[i]
      if (leaf) leaf.rotation.y = door.hinge
    }
  })

  return (
    <group>
      <instancedMesh ref={frameRef} args={[geometry, undefined, MAX_DOORS * 3]} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={interiorRef} args={[geometry, undefined, MAX_DOORS]} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} />
      </instancedMesh>
      <instancedMesh ref={signRef} args={[geometry, undefined, MAX_DOORS]} castShadow>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={lightRef} args={[geometry, undefined, MAX_DOORS]}>
        <meshStandardMaterial
          vertexColors
          emissive="#ffcf96"
          emissiveIntensity={14}
          roughness={0.4}
          metalness={0}
        />
      </instancedMesh>

      {doors.map((door, index) => (
        <group
          key={index}
          position={[door.x, config.curbHeight, door.z]}
          rotation={[0, door.angle, 0]}
        >
          <group
            ref={(el) => {
              leaves.current[index] = el
            }}
            position={[-0.83, 0, 0.62]}
          >
            <mesh position={[0.83, 1.21, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.66, 2.42, 0.09]} />
              <meshStandardMaterial color={door.leaf} roughness={0.8} />
            </mesh>
            <mesh position={[1.5, 1.2, 0.08]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              <meshStandardMaterial color="#d9b24a" roughness={0.4} metalness={0.6} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}
