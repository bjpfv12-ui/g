import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import type { Sky as SkyObject } from 'three-stdlib'
import { playerState } from '../state/playerState'
import { timeState } from '../state/timeState'
import {
  DAY_CYCLE_SECONDS,
  formatClock,
  getDayLight,
  getDayNight,
  getPhaseLabel,
  type DayLight,
} from '../world/dayNight'

/**
 * День и ночь: солнце ходит по дуге, а вместе с ним меняются цвет солнца,
 * ambient, подсветка, туман и отражения. Полный цикл — 5 минут.
 *
 * Компонент владеет всем, что зависит от времени суток: небом, туманом и
 * обоими направленными источниками.
 */
export function DayNight() {
  const sun = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const sky = useRef<SkyObject>(null)
  const fog = useRef<THREE.Fog>(null)
  const background = useRef<THREE.Color>(null)

  const { scene } = useThree()
  const sunTarget = useMemo(() => new THREE.Object3D(), [])
  const fillTarget = useMemo(() => new THREE.Object3D(), [])
  const light = useMemo<DayLight>(
    () => ({
      sunColor: new THREE.Color(),
      ambientColor: new THREE.Color(),
      fillColor: new THREE.Color(),
      fogColor: new THREE.Color(),
      sunIntensity: 0,
      ambientIntensity: 0,
      fillIntensity: 0,
      environmentIntensity: 0,
    }),
    [],
  )
  const sunPosition = useMemo(() => new THREE.Vector3(), [])
  const fillPosition = useMemo(() => new THREE.Vector3(), [])
  /** Пройденное время цикла, секунды. */
  const elapsed = useRef(0)

  useEffect(() => {
    scene.add(sunTarget)
    scene.add(fillTarget)
    return () => {
      scene.remove(sunTarget)
      scene.remove(fillTarget)
    }
  }, [scene, sunTarget, fillTarget])

  useFrame((_, delta) => {
    // Dev-переопределение: фиксируем фазу суток для наглядных снимков.
    const override = (
      globalThis as { __timeOfDay?: { phase: number } }
    ).__timeOfDay
    if (override) {
      elapsed.current = override.phase * DAY_CYCLE_SECONDS
    } else {
      elapsed.current = (elapsed.current + delta) % DAY_CYCLE_SECONDS
    }
    const dn = getDayNight(elapsed.current / DAY_CYCLE_SECONDS)
    getDayLight(dn, light)

    const p = playerState.position

    // ─── Солнце ──────────────────────────────────────────────────────────────
    const sunLight = sun.current
    if (sunLight) {
      sunLight.color.copy(light.sunColor)
      sunLight.intensity = light.sunIntensity
      sunPosition.set(
        p.x + dn.direction.x * 140,
        dn.direction.y * 140,
        p.z + dn.direction.z * 140,
      )
      sunLight.position.copy(sunPosition)
      sunTarget.position.set(p.x, 0, p.z)
      sunTarget.updateMatrixWorld()
    }

    // ─── Небо: солнце едет по дуге ──────────────────────────────────────────
    const skyMesh = sky.current
    if (skyMesh) {
      const material = skyMesh.material as THREE.ShaderMaterial
      material.uniforms.sunPosition.value.copy(dn.direction).multiplyScalar(1000)
    }

    // ─── Подсветка с теневой стороны ─────────────────────────────────────────
    const fillLight = fill.current
    if (fillLight) {
      fillLight.color.copy(light.fillColor)
      fillLight.intensity = light.fillIntensity
      fillPosition.set(p.x - dn.direction.x * 120, 90, p.z - dn.direction.z * 120)
      fillLight.position.copy(fillPosition)
      fillTarget.position.set(p.x, 0, p.z)
      fillTarget.updateMatrixWorld()
    }

    // ─── Ambient, туман и фон ───────────────────────────────────────────────
    const ambientLight = ambient.current
    if (ambientLight) {
      ambientLight.color.copy(light.ambientColor)
      ambientLight.intensity = light.ambientIntensity
    }
    const fogRef = fog.current
    if (fogRef) fogRef.color.copy(light.fogColor)
    const bg = background.current
    if (bg) bg.copy(light.fogColor)

    // Небо-карта отражает день: ночью отражения почти гаснут.
    scene.environmentIntensity = light.environmentIntensity

    // ─── Канал для HUD ───────────────────────────────────────────────────────
    timeState.phase = dn.phase
    timeState.hour = dn.hour
    timeState.clock = formatClock(dn.hour)
    timeState.label = getPhaseLabel(dn)
    timeState.daylight = dn.daylight
  })

  return (
    <>
      <color ref={background} attach="background" args={['#c9d6df']} />
      <fog ref={fog} attach="fog" args={['#c9d6df', 50, 300]} />

      <Sky
        ref={sky}
        distance={2000}
        sunPosition={[400, 500, 400]}
        turbidity={2.2}
        rayleigh={2.8}
        mieCoefficient={0.004}
        mieDirectionalG={0.78}
      />

      {/* Отражённое небо: холодный подсвет заполняет теневые стороны. */}
      <ambientLight ref={ambient} color="#b0c4de" intensity={0.37} />

      {/* Направленный свет едет за игроком: тени остаются резкими. */}
      <directionalLight
        ref={sun}
        target={sunTarget}
        color="#fff4e6"
        intensity={10.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      >
        <orthographicCamera attach="shadow-camera" args={[-85, 85, 85, -85, 1, 420]} />
      </directionalLight>

      {/* Подсветка с теневой стороны — не даёт затенённым фасадам «схлопнуться». */}
      <directionalLight ref={fill} target={fillTarget} color="#9db9dd" intensity={0.9} />
    </>
  )
}
