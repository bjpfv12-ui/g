import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { CityGenerator } from './components/CityGenerator'
import { PlayerController } from './components/PlayerController'
import { CameraRig } from './components/CameraRig'
import { Traffic } from './components/Traffic'
import { Pedestrians } from './components/Pedestrians'
import { Doors } from './components/Doors'
import { Hud } from './components/Hud'
import { releaseAllKeys, useInputStore } from './store/InputStore'
import { playerState } from './state/playerState'
import { DEFAULT_CITY } from './world/cityConfig'
import { getSpawnPoint } from './world/cityLayout'

const SUN_ELEVATION = 0.27
const SUN_AZIMUTH = -1.74
const GRAVITY = -22

const SUN_DIRECTION = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize()

/** Направленный свет, который едет за игроком: тени остаются резкими. */
function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const { scene } = useThree()

  useEffect(() => {
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene, target])

  useFrame(() => {
    const lightRef = light.current
    if (!lightRef) return
    const p = playerState.position
    lightRef.position.set(
      p.x + SUN_DIRECTION.x * 140,
      SUN_DIRECTION.y * 140,
      p.z + SUN_DIRECTION.z * 140,
    )
    target.position.set(p.x, 0, p.z)
    target.updateMatrixWorld()
  })

  return (
    <directionalLight
      ref={light}
      target={target}
      color="#ffc182"
      intensity={4.2}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-bias={-0.0004}
      shadow-normalBias={0.035}
    >
      <orthographicCamera attach="shadow-camera" args={[-85, 85, 85, -85, 1, 420]} />
    </directionalLight>
  )
}

/** Холодная подсветка с теневой стороны — не даёт затенённым фасадам «схлопнуться». */
function FillLight() {
  const light = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const { scene } = useThree()

  useEffect(() => {
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene, target])

  useFrame(() => {
    const lightRef = light.current
    if (!lightRef) return
    const p = playerState.position
    lightRef.position.set(p.x - SUN_DIRECTION.x * 120, 90, p.z - SUN_DIRECTION.z * 120)
    target.position.set(p.x, 0, p.z)
    target.updateMatrixWorld()
  })

  return (
    <directionalLight ref={light} target={target} color="#9db9dd" intensity={0.75} />
  )
}

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
          toneMappingExposure: 1.25,
        }}
      >
        <color attach="background" args={['#e6c49a']} />
        <fog attach="fog" args={['#e3c49b', 150, 900]} />

        <Sky
          distance={2000}
          sunPosition={SUN_DIRECTION.clone().multiplyScalar(1000)}
          turbidity={9}
          rayleigh={1.2}
          mieCoefficient={0.009}
          mieDirectionalG={0.86}
        />

        <hemisphereLight args={['#b6cbe8', '#8a7358', 0.85]} />
        <SunLight />
        <FillLight />

        <Physics gravity={[0, GRAVITY, 0]} interpolate>
          <CityGenerator config={DEFAULT_CITY} />
          <Traffic config={DEFAULT_CITY} />
          <Pedestrians config={DEFAULT_CITY} />
          <Doors config={DEFAULT_CITY} />
          <PlayerController spawn={spawn} />
          <CameraRig />
        </Physics>
      </Canvas>

      <Hud />
    </div>
  )
}
