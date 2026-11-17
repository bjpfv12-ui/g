import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Sky, Environment } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { CityGenerator } from './components/CityGenerator'
import { PlayerController } from './components/PlayerController'
import { CarController } from './components/CarController'
import { CameraFollow } from './components/CameraFollow'
import { Traffic } from './components/Traffic'
import { Pedestrians } from './components/Pedestrians'
import { Doors } from './components/Doors'
import { Clouds } from './components/Clouds'
import { DayNight } from './components/DayNight'
import { PostFX } from './components/PostFX'
import { Hud } from './components/Hud'
import { releaseAllKeys, useInputStore } from './store/InputStore'
import { DEFAULT_CITY } from './world/cityConfig'
import { getSpawnPoint } from './world/cityLayout'

const GRAVITY = -22

/** Стартовое положение солнца — совпадает с 8:00 в цикле суток. */
const SUN_ELEVATION = 0.62
const SUN_AZIMUTH = -0.4

const SUN_DIRECTION = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize()

/** Dev-проба: отдаёт наружу рендерер, сцену и камеру для диагностики из тестов. */
function DevProbe() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = globalThis as unknown as {
      __gl: THREE.WebGLRenderer
      __scene: THREE.Scene
      __camera: THREE.Camera
    }
    target.__gl = gl
    target.__scene = scene
    target.__camera = camera
  }, [gl, scene, camera])
  return null
}

/**
 * Небо-карта окружения светит на всю сцену сразу — приглушаем её глобально.
 * Стекло получает собственную карту (см. CityGenerator), поэтому отражает
 * небо в полную силу, а бетон и асфальт не уходят в синеву.
 *
 * Саму интенсивность меняет DayNight вместе со временем суток.
 */
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const spawn = useMemo(() => getSpawnPoint(DEFAULT_CITY), [])

  useEffect(() => {
    const store = useInputStore.getState()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code.startsWith('Arrow')) {
        event.preventDefault()
      }
      store.setKey(event.code, true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      store.setKey(event.code, false)
    }
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement) {
        store.addMouseDelta(event.movementX, event.movementY)
      }
    }
    const onPointerLockChange = () => {
      const canvas = containerRef.current?.querySelector('canvas')
      store.setPointerLocked(document.pointerLockElement === canvas)
      if (!document.pointerLockElement) releaseAllKeys()
    }
    const onBlur = () => releaseAllKeys()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
    }
  }, [])

  const requestLock = () => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (canvas && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()
    }
  }

  return (
    <div className="app" ref={containerRef} onPointerDown={requestLock}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 4, 10], fov: 66, near: 0.3, far: 4000 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMappingExposure: 1.08,
        }}
      >
        {/* День и ночь: солнце, небо, туман и ambient живут здесь. */}
        <DayNight />

        {/* Окружение-карта: снимаем небо в кубическую карту, чтобы стекло
            и кузова отражали настоящее небо, а не чёрный цвет. */}
        <Environment resolution={64} frames={1} near={0.1} far={5000}>
          <Sky
            distance={1000}
            sunPosition={SUN_DIRECTION.clone().multiplyScalar(1000)}
            turbidity={3.2}
            rayleigh={1.6}
            mieCoefficient={0.006}
            mieDirectionalG={0.8}
          />
        </Environment>

        <Clouds />
        <DevProbe />

        <Physics gravity={[0, GRAVITY, 0]} interpolate>
          <CityGenerator config={DEFAULT_CITY} />
          <CarController config={DEFAULT_CITY} />
          <Traffic config={DEFAULT_CITY} />
          <Pedestrians config={DEFAULT_CITY} />
          <Doors config={DEFAULT_CITY} />
          <PlayerController spawn={spawn} />
          <CameraFollow />
        </Physics>

        <PostFX />
      </Canvas>

      <Hud />
    </div>
  )
}
