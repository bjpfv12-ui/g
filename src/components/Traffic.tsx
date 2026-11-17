import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { mulberry32 } from '../world/cityLayout'
import { playerState } from '../state/playerState'
import { worldState } from '../state/worldState'
import { withVertexColors } from './Instances'

const CAR_COUNT = 34
const LANE_OFFSET = 4
const TURN_CHANCE = 0.34

const CAR_COLORS = [
  '#8d3f36',
  '#3f5f8d',
  '#c9c2b4',
  '#4a4d52',
  '#6b7f5a',
  '#b0763f',
  '#2f3438',
  '#d3d0c8',
  '#7a4b6d',
  '#2f6f6a',
]

interface Car {
  /** 0 — движется вдоль X, 1 — вдоль Z. */
  axis: 0 | 1
  dir: 1 | -1
  /** Индекс дороги, по которой едет. */
  line: number
  /** Координата вдоль оси движения. */
  t: number
  speed: number
  /** Боковое смещение в полосе (сглаженное). */
  lane: number
  laneTarget: number
  /** Следующий перекрёсток по ходу движения. */
  nextCross: number
}

/** Ближайшая ось дороги впереди по направлению dir. */
function nextIntersection(lines: number[], t: number, dir: number): number {
  let best = dir > 0 ? Infinity : -Infinity
  for (const l of lines) {
    if (dir > 0 && l > t + 0.5 && l < best) best = l
    if (dir < 0 && l < t - 0.5 && l > best) best = l
  }
  return best
}

function laneTargetFor(axis: 0 | 1, dir: 1 | -1): number {
  // Правостороннее движение: держимся правой полосы от центра дороги.
  if (axis === 1) return dir > 0 ? -LANE_OFFSET : LANE_OFFSET
  return dir > 0 ? LANE_OFFSET : -LANE_OFFSET
}

function headingFor(axis: 0 | 1, dir: 1 | -1): number {
  if (axis === 1) return dir > 0 ? 0 : Math.PI
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2
}

export function Traffic({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const bodyRef = useRef<THREE.InstancedMesh>(null)
  const roofRef = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => withVertexColors(new THREE.BoxGeometry(1, 1, 1)), [])

  const lines = useMemo(() => {
    const pitch = config.blockSize + config.roadWidth
    const result: number[] = []
    for (let k = 0; k <= config.blocks; k++) result.push((k - config.blocks / 2) * pitch)
    return result
  }, [config])

  const extent = config.blocks * config.blockSize + (config.blocks + 1) * config.roadWidth
  const limit = extent / 2 - 14

  const rng = useMemo(() => mulberry32(config.seed + 977), [config.seed])

  const cars = useMemo(() => {
    const result: Car[] = []
    for (let i = 0; i < CAR_COUNT; i++) {
      const axis: 0 | 1 = rng() > 0.5 ? 1 : 0
      const dir: 1 | -1 = rng() > 0.5 ? 1 : -1
      const line = Math.floor(rng() * lines.length)
      const t = (rng() * 2 - 1) * limit
      const laneTarget = laneTargetFor(axis, dir)
      result.push({
        axis,
        dir,
        line,
        t,
        speed: 8 + rng() * 9,
        lane: laneTarget,
        laneTarget,
        nextCross: nextIntersection(lines, t, dir),
      })
    }
    return result
  }, [lines, limit, rng])

  // Цвета задаются один раз — машины не перекрашиваются на ходу.
  useLayoutEffect(() => {
    const body = bodyRef.current
    const roof = roofRef.current
    if (!body || !roof) return
    const color = new THREE.Color()
    cars.forEach((_, i) => {
      color.set(CAR_COLORS[i % CAR_COLORS.length])
      body.setColorAt(i, color)
      color.set('#2b3036')
      roof.setColorAt(i, color)
    })
    if (body.instanceColor) body.instanceColor.needsUpdate = true
    if (roof.instanceColor) roof.instanceColor.needsUpdate = true
  }, [cars])

  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const quaternion = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(), [])
  const position = useMemo(() => new THREE.Vector3(), [])
  const scale = useMemo(() => new THREE.Vector3(1.85, 0.85, 4.3), [])
  const roofScale = useMemo(() => new THREE.Vector3(1.6, 0.72, 2), [])
  const offset = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const body = bodyRef.current
    const roof = roofRef.current
    if (!body || !roof) return
    const dt = Math.min(delta, 1 / 30)

    const px = playerState.position.x
    const pz = playerState.position.z

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]

      // ─── Положение ─────────────────────────────────────────────────────────
      let x = car.axis === 1 ? lines[car.line] + car.lane : car.t
      let z = car.axis === 0 ? lines[car.line] + car.lane : car.t

      // ─── Игрок впереди — сбрасываем скорость ───────────────────────────────
      const heading = headingFor(car.axis, car.dir)
      const fx = Math.sin(heading)
      const fz = Math.cos(heading)
      const toPlayerX = px - x
      const toPlayerZ = pz - z
      const ahead = toPlayerX * fx + toPlayerZ * fz
      const lateral = Math.abs(toPlayerX * fz - toPlayerZ * fx)
      const braking = ahead > 0 && ahead < 11 && lateral < 2.8
      const speedFactor = braking ? Math.max(0, (ahead - 2.5) / 8.5) : 1

      car.t += car.dir * car.speed * speedFactor * dt

      // ─── Перекрёсток ───────────────────────────────────────────────────────
      const crossed =
        (car.dir > 0 && car.t >= car.nextCross) || (car.dir < 0 && car.t <= car.nextCross)
      if (crossed && Number.isFinite(car.nextCross)) {
        const j = lines.findIndex((l) => Math.abs(l - car.nextCross) < 0.01)
        const canTurn = j > 0 && j < lines.length - 1
        if (canTurn && rng() < TURN_CHANCE) {
          const newAxis: 0 | 1 = car.axis === 1 ? 0 : 1
          const newDir: 1 | -1 = rng() > 0.5 ? 1 : -1
          car.t = car.axis === 1 ? x : z
          car.axis = newAxis
          car.dir = newDir
          car.line = j
          car.laneTarget = laneTargetFor(newAxis, newDir)
        }
        car.nextCross = nextIntersection(lines, car.t, car.dir)
      }

      // ─── Выезд за границы — переспавн подальше от игрока ───────────────────
      if (Math.abs(car.t) > limit) {
        const far = Math.abs(x - px) > 140 || Math.abs(z - pz) > 140
        if (far) {
          car.axis = rng() > 0.5 ? 1 : 0
          car.dir = rng() > 0.5 ? 1 : -1
          car.line = Math.floor(rng() * lines.length)
          car.t = (rng() * 2 - 1) * limit
          car.laneTarget = laneTargetFor(car.axis, car.dir)
          car.lane = car.laneTarget
          car.nextCross = nextIntersection(lines, car.t, car.dir)
        } else {
          car.dir = car.dir > 0 ? -1 : 1
          car.nextCross = nextIntersection(lines, car.t, car.dir)
        }
      }

      car.lane = THREE.MathUtils.damp(car.lane, car.laneTarget, 3.5, dt)

      x = car.axis === 1 ? lines[car.line] + car.lane : car.t
      z = car.axis === 0 ? lines[car.line] + car.lane : car.t

      // ─── Матрицы ──────────────────────────────────────────────────────────
      const yaw = headingFor(car.axis, car.dir)
      euler.set(0, yaw, 0)
      quaternion.setFromEuler(euler)

      position.set(x, 0.55, z)
      matrix.compose(position, quaternion, scale)
      body.setMatrixAt(i, matrix)

      offset.set(0, 0, 0.35).applyQuaternion(quaternion)
      position.set(x + offset.x, 1.2, z + offset.z)
      matrix.compose(position, quaternion, roofScale)
      roof.setMatrixAt(i, matrix)

      const spot = worldState.traffic[i]
      if (spot) {
        spot.x = x
        spot.z = z
      } else {
        worldState.traffic.push({ x, z })
      }
    }

    body.instanceMatrix.needsUpdate = true
    roof.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[geometry, undefined, CAR_COUNT]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={0.42} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[geometry, undefined, CAR_COUNT]} castShadow>
        <meshStandardMaterial vertexColors roughness={0.3} metalness={0.45} />
      </instancedMesh>
    </group>
  )
}
