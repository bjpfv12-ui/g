import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import type { ReactNode } from 'react'

export interface InstanceItem {
  position: [number, number, number]
  scale: [number, number, number]
  color?: string
  /** Поворот: число — вокруг Y, тройка [x, y, z] — полный эйлер (порядок YXZ). */
  rotation?: number | [number, number, number]
}

interface InstancesProps {
  geometry: THREE.BufferGeometry
  items: InstanceItem[]
  castShadow?: boolean
  receiveShadow?: boolean
  children?: ReactNode
}

/**
 * Инстансинг: одна геометрия — N копий. Цвет задаётся per-instance
 * (instanceColor), поэтому материал обязательно работает с vertexColors.
 */
export function Instances({
  geometry,
  items,
  castShadow = true,
  receiveShadow = true,
  children,
}: InstancesProps) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const color = new THREE.Color()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      position.set(item.position[0], item.position[1], item.position[2])
      scale.set(item.scale[0], item.scale[1], item.scale[2])
      if (typeof item.rotation === 'number') {
        euler.set(0, item.rotation, 0)
      } else if (item.rotation) {
        euler.set(item.rotation[0], item.rotation[1], item.rotation[2], 'YXZ')
      } else {
        euler.set(0, 0, 0)
      }
      quaternion.setFromEuler(euler)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
      if (item.color) {
        color.set(item.color)
        mesh.setColorAt(i, color)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])

  if (items.length === 0) return null

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled
    >
      <primitive object={geometry} attach="geometry" />
      {children}
    </instancedMesh>
  )
}

/**
 * Геометрия с белым vertex-color атрибутом: он нужен, чтобы instanceColor
 * корректно умножался на цвет вершины в шейдере.
 */
export function withVertexColors<T extends THREE.BufferGeometry>(geometry: T): T {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3).fill(1)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}
