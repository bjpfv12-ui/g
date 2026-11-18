import { useMemo } from 'react'
import * as THREE from 'three'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { generateCity, type ParkedCarDef } from '../world/cityLayout'

/**
 * ParkedCars.tsx — припаркованные машины как часть города.
 *
 * Это статичные объекты мира: у каждой свой `RigidBody` и свой кузов с
 * коллайдером. Управления здесь нет — машинами нельзя ездить, игрок может
 * только задеть их, и они отталкиваются как обычные твёрдые тела.
 */

/**
 * Склеивает несколько геометрий в одну с общим цветом.
 *
 * Своя реализация вместо three/examples/jsm/utils/BufferGeometryUtils:
 * там нет типов, а машинам нужен всего один случай — кузов с кабиной
 * и четыре колеса.
 */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const color: number[] = []

  for (const part of parts) {
    const p = part.getAttribute('position') as THREE.BufferAttribute
    const n = part.getAttribute('normal') as THREE.BufferAttribute
    const t = part.getAttribute('uv') as THREE.BufferAttribute | undefined
    const c = part.getAttribute('color') as THREE.BufferAttribute

    for (let i = 0; i < p.count; i++) {
      position.push(p.getX(i), p.getY(i), p.getZ(i))
      normal.push(n.getX(i), n.getY(i), n.getZ(i))
      if (t) uv.push(p.getX(i), p.getY(i))
      color.push(c.getX(i), c.getY(i), c.getZ(i))
    }
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  merged.computeBoundingSphere()
  return merged
}

/** Добавляет к геометрии атрибут цвета — один цвет на всю фигуру. */
function paint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const color = new THREE.Color(hex)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/**
 * Геометрия кузова: бокс + кабина, сдвинутая к передней части.
 * Локальная система машины: +Z — вперёд, +Y — вверх, начало — центр кузова.
 */
function buildChassis(def: ParkedCarDef): THREE.BufferGeometry {
  const body = paint(new THREE.BoxGeometry(def.width, def.height, def.length), def.color)

  const roof = paint(
    new THREE.BoxGeometry(def.width * 0.86, 0.72, def.length * 0.46),
    '#2b3036',
  )
  roof.translate(0, def.height / 2 + 0.42, 0.35)

  return mergeParts([body, roof])
}

/** Четыре колеса-цилиндра, ось каждого направлена поперёк кузова. */
function buildWheels(def: ParkedCarDef): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const radius = 0.32
  const width = 0.3
  const sideOffset = def.width / 2 - 0.08
  const axleOffset = def.length / 2 - 1
  const height = 0.34 - def.height / 2

  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const wheel = paint(new THREE.CylinderGeometry(radius, radius, width, 10), '#1c1f24')
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(side * sideOffset, height, axle * axleOffset)
      parts.push(wheel)
    }
  }

  return mergeParts(parts)
}

/** Одна припаркованная машина: своё физическое тело и свой меш. */
function ParkedCar({
  def,
  chassisMaterial,
  wheelMaterial,
}: {
  def: ParkedCarDef
  chassisMaterial: THREE.Material
  wheelMaterial: THREE.Material
}) {
  const chassis = useMemo(() => buildChassis(def), [def])
  const wheels = useMemo(() => buildWheels(def), [def])

  return (
    <RigidBody
      colliders={false}
      type="dynamic"
      position={def.position}
      rotation={[0, def.yaw, 0]}
      // Вращение разрешено только вокруг вертикальной оси Y: кузов не валится
      // на бок и не переворачивается, когда его подталкивают.
      enabledRotations={[false, true, false]}
      linearDamping={0.25}
      angularDamping={0.5}
      friction={0.6}
      restitution={0}
    >
      <CuboidCollider
        args={[def.width / 2, def.height / 2, def.length / 2]}
        friction={0.6}
      />
      <mesh geometry={chassis} material={chassisMaterial} castShadow receiveShadow />
      <mesh geometry={wheels} material={wheelMaterial} castShadow />
    </RigidBody>
  )
}

export function ParkedCars({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const cars = useMemo(() => generateCity(config).parkedCars, [config])

  const chassisMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }),
    [],
  )
  const wheelMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    [],
  )

  return (
    <group>
      {cars.map((def, index) => (
        <ParkedCar
          key={index}
          def={def}
          chassisMaterial={chassisMaterial}
          wheelMaterial={wheelMaterial}
        />
      ))}
    </group>
  )
}
