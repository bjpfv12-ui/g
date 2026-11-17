import { useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { generateCity, type BoxDef } from '../world/cityLayout'
import { createAsphaltTexture, createGroundTexture } from '../world/textures'
import { timeState } from '../state/timeState'
import { Instances, withVertexColors, type InstanceItem } from './Instances'

/** Сколько кварталов умещается в один чанк (влияет на frustum culling). */
const CHUNK_BLOCKS = 4
const GROUND_SIZE = 2600

interface ChunkLayerProps {
  chunks: [string, InstanceItem[]][]
  geometry: THREE.BufferGeometry
  castShadow?: boolean
  receiveShadow?: boolean
  /** Готовый материал — один на все чанки слоя. */
  material?: THREE.Material
  children?: ReactNode
}

function ChunkLayer({
  chunks,
  geometry,
  castShadow = true,
  receiveShadow = true,
  material,
  children,
}: ChunkLayerProps) {
  return (
    <>
      {chunks.map(([key, items]) => (
        <Instances
          key={key}
          geometry={geometry}
          items={items}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        >
          {material ? <primitive object={material} attach="material" /> : children}
        </Instances>
      ))}
    </>
  )
}

export function CityGenerator({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const data = useMemo(() => generateCity(config), [config])
  const { scene } = useThree()

  /**
   * Стеклу нужна собственная карта окружения: three берёт envMapIntensity
   * материала только если envMap задан на самом материале, а из scene.environment
   * он подставляет общий scene.environmentIntensity. Так окна отражают небо
   * в полную силу, а весь остальной город берёт приглушённое небо.
   *
   * Материал общий для всех чанков слоя — иначе каждый чанк создал бы свой.
   */
  const glassMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.1,
        metalness: 0.9,
        envMapIntensity: 1.6,
      }),
    [],
  )

  useEffect(() => () => glassMaterial.dispose(), [glassMaterial])

  useFrame(() => {
    if (scene.environment && glassMaterial.envMap !== scene.environment) {
      glassMaterial.envMap = scene.environment
      glassMaterial.needsUpdate = true
    }
    // Ночью стекло перестаёт отражать яркое небо.
    glassMaterial.envMapIntensity = 1.6 * (0.06 + 0.94 * timeState.daylight)
  })

  const geometries = useMemo(
    () => ({
      box: withVertexColors(new THREE.BoxGeometry(1, 1, 1)),
      canopy: withVertexColors(new THREE.IcosahedronGeometry(1, 0)),
      cylinder: withVertexColors(new THREE.CylinderGeometry(1, 1, 1, 10)),
      tapered: withVertexColors(new THREE.CylinderGeometry(0.68, 1, 1, 8)),
      sphere: withVertexColors(new THREE.SphereGeometry(0.5, 12, 10)),
    }),
    [],
  )

  const textures = useMemo(() => {
    const alongZ = createAsphaltTexture()
    const alongX = alongZ.clone()
    alongZ.repeat.set(config.roadWidth / 12, data.extent / 12)
    alongX.repeat.set(data.extent / 12, config.roadWidth / 12)
    alongX.needsUpdate = true

    const ground = createGroundTexture()
    ground.repeat.set(GROUND_SIZE / 16, GROUND_SIZE / 16)
    return { alongZ, alongX, ground }
  }, [config.roadWidth, data.extent])

  /** Раскладываем объекты по чанкам, чтобы отсечение пирамидой работало. */
  const layer = useMemo(() => {
    const result = new Map<string, InstanceItem[]>()
    const chunkSize = CHUNK_BLOCKS * (config.blockSize + config.roadWidth)
    const add = (name: string, defs: BoxDef[]) => {
      for (const def of defs) {
        const key = `${Math.floor(def.position[0] / chunkSize)}_${Math.floor(
          def.position[2] / chunkSize,
        )}`
        const bucketKey = `${name}|${key}`
        let bucket = result.get(bucketKey)
        if (!bucket) {
          bucket = []
          result.set(bucketKey, bucket)
        }
        bucket.push({
          position: def.position,
          scale: def.size,
          color: def.color,
          rotation: def.rotation,
        })      }
    }
    add('buildings', data.buildings)
    add('parapets', data.parapets)
    add('roofProps', data.roofProps)
    add('roofAntennas', data.roofAntennas)
    add('windows', data.windows)
    add('litWindows', data.litWindows)
    add('trees', data.treeTrunks)
    add('canopies', data.treeCanopies)
    add('palmTrunks', data.palmTrunks)
    add('palmFronds', data.palmFronds)
    add('carBodies', data.carBodies)
    add('carRoofs', data.carRoofs)
    add('carWheels', data.carWheels)
    add('lampPoles', data.lampPoles)
    add('lampHeads', data.lampHeads)
    add('marks', data.yellowMarks)
    add('whiteMarks', data.whiteMarks)
    add('parks', data.parkSlabs)
    add('skyline', data.skyline)
    return result
  }, [data, config.blockSize, config.roadWidth])

  const group = (name: string): [string, InstanceItem[]][] =>
    [...layer.entries()].filter(([key]) => key.startsWith(`${name}|`))

  const sidewalkItems = useMemo(
    () =>
      data.blocks.map((block) => ({
        position: [block.center[0], config.curbHeight / 2, block.center[1]] as [
          number,
          number,
          number,
        ],
        scale: [block.size, config.curbHeight, block.size] as [number, number, number],
      })),
    [data.blocks, config.curbHeight],
  )

  const half = data.extent / 2

  return (
    <group>
      {/* Земля за пределами города */}
      <mesh
        position={[0, -0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial map={textures.ground} roughness={1} />
      </mesh>

      {/* Проезжая часть */}
      {data.roadLines.map((x) => (
        <mesh key={`rz-${x}`} position={[x, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[config.roadWidth, data.extent]} />
          <meshStandardMaterial map={textures.alongZ} roughness={0.95} metalness={0} />
        </mesh>
      ))}
      {data.roadLines.map((z) => (
        <mesh key={`rx-${z}`} position={[0, 0, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[data.extent, config.roadWidth]} />
          <meshStandardMaterial map={textures.alongX} roughness={0.95} metalness={0} />
        </mesh>
      ))}

      {/* Тротуары */}
      <Instances geometry={geometries.box} items={sidewalkItems} castShadow={false} receiveShadow>
        <meshStandardMaterial color="#b9b2a5" roughness={0.95} />
      </Instances>

      {/* Здания */}
      <ChunkLayer chunks={group('buildings')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.1} />
      </ChunkLayer>

      {/* Парапеты и кровля */}
      <ChunkLayer chunks={group('parapets')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </ChunkLayer>
      <ChunkLayer chunks={group('roofProps')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={0.85} metalness={0.2} />
      </ChunkLayer>
      <ChunkLayer chunks={group('roofAntennas')} geometry={geometries.cylinder}>
        <meshStandardMaterial vertexColors roughness={0.6} metalness={0.55} />
      </ChunkLayer>

      {/* Тёмное стекло: гладкое и отражающее — в окнах видно небо */}
      <ChunkLayer
        chunks={group('windows')}
        geometry={geometries.box}
        material={glassMaterial}
        castShadow={false}
        receiveShadow={false}
      />

      {/* Светящиеся окна: emissive заставляет их светиться и ловить bloom */}
      <ChunkLayer
        chunks={group('litWindows')}
        geometry={geometries.box}
        castShadow={false}
        receiveShadow={false}
      >
        <meshStandardMaterial
          vertexColors
          emissive="#ffb765"
          emissiveIntensity={20}
          roughness={0.35}
          metalness={0.1}
         
        />
      </ChunkLayer>

      {/* Зелень парков */}
      <ChunkLayer chunks={group('parks')} geometry={geometries.box} castShadow={false}>
        <meshStandardMaterial vertexColors roughness={1} />
      </ChunkLayer>

      {/* Деревья */}
      <ChunkLayer chunks={group('trees')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={1} />
      </ChunkLayer>
      <ChunkLayer chunks={group('canopies')} geometry={geometries.canopy}>
        <meshStandardMaterial vertexColors roughness={0.95} flatShading />
      </ChunkLayer>

      {/* Пальмы */}
      <ChunkLayer chunks={group('palmTrunks')} geometry={geometries.tapered}>
        <meshStandardMaterial vertexColors roughness={0.95} flatShading />
      </ChunkLayer>
      <ChunkLayer chunks={group('palmFronds')} geometry={geometries.canopy}>
        <meshStandardMaterial
          vertexColors
          roughness={0.9}
          flatShading
          side={THREE.DoubleSide}
         
        />
      </ChunkLayer>

      {/* Машины */}
      <ChunkLayer chunks={group('carBodies')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={0.42} metalness={0.35} />
      </ChunkLayer>
      <ChunkLayer chunks={group('carRoofs')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={0.25} metalness={0.5} />
      </ChunkLayer>
      <ChunkLayer chunks={group('carWheels')} geometry={geometries.cylinder}>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </ChunkLayer>

      {/* Фонари */}
      <ChunkLayer chunks={group('lampPoles')} geometry={geometries.cylinder}>
        <meshStandardMaterial vertexColors roughness={0.7} metalness={0.4} />
      </ChunkLayer>
      <ChunkLayer
        chunks={group('lampHeads')}
        geometry={geometries.sphere}
        castShadow={false}
        receiveShadow={false}
      >
        <meshStandardMaterial
          vertexColors
          emissive="#ffcf96"
          emissiveIntensity={16}
          roughness={0.4}
          metalness={0}
        />
      </ChunkLayer>

      {/* Разметка */}
      <ChunkLayer
        chunks={group('marks')}
        geometry={geometries.box}
        castShadow={false}
        receiveShadow={false}
      >
        <meshStandardMaterial vertexColors roughness={0.8} />
      </ChunkLayer>
      <ChunkLayer
        chunks={group('whiteMarks')}
        geometry={geometries.box}
        castShadow={false}
        receiveShadow={false}
      >
        <meshStandardMaterial vertexColors roughness={0.8} />
      </ChunkLayer>

      {/* Дальний скайлайн */}
      <ChunkLayer chunks={group('skyline')} geometry={geometries.box}>
        <meshStandardMaterial vertexColors roughness={1} />
      </ChunkLayer>

      {/* ─── Коллайдеры ──────────────────────────────────────────────────────── */}
      <RigidBody type="fixed" colliders={false} friction={0.9}>
        <CuboidCollider args={[GROUND_SIZE / 2, 1, GROUND_SIZE / 2]} position={[0, -1, 0]} />

        {data.blocks.map((block, index) => (
          <CuboidCollider
            key={`sw-${index}`}
            args={[block.size / 2, config.curbHeight / 2, block.size / 2]}
            position={[block.center[0], config.curbHeight / 2, block.center[1]]}
          />
        ))}

        {data.buildings.map((building, index) => (
          <CuboidCollider
            key={`b-${index}`}
            args={[building.size[0] / 2, building.size[1] / 2, building.size[2] / 2]}
            position={[
              building.position[0],
              building.position[1] + building.size[1] / 2,
              building.position[2],
            ]}
          />
        ))}

        {data.carBodies.map((car, index) => (
          <CuboidCollider
            key={`c-${index}`}
            args={[car.size[0] / 2, car.size[1] / 2, car.size[2] / 2]}
            position={car.position}
            rotation={[0, typeof car.rotation === 'number' ? car.rotation : (car.rotation?.[1] ?? 0), 0]}
          />
        ))}

        {data.lampPoles.map((pole, index) => (
          <CuboidCollider
            key={`l-${index}`}
            args={[pole.size[0] / 2, pole.size[1] / 2, pole.size[2] / 2]}
            position={pole.position}
          />
        ))}

        {data.treeTrunks.map((trunk, index) => (
          <CuboidCollider
            key={`t-${index}`}
            args={[0.35, trunk.size[1] / 2, 0.35]}
            position={trunk.position}
          />
        ))}

        {/* Границы мира */}
        <CuboidCollider args={[half + 60, 40, 2]} position={[0, 40, half + 60]} />
        <CuboidCollider args={[half + 60, 40, 2]} position={[0, 40, -half - 60]} />
        <CuboidCollider args={[2, 40, half + 60]} position={[half + 60, 40, 0]} />
        <CuboidCollider args={[2, 40, half + 60]} position={[-half - 60, 40, 0]} />
      </RigidBody>
    </group>
  )
}
