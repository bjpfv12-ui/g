import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, CoefficientCombineRule, type RapierRigidBody } from '@react-three/rapier'
import { DEFAULT_CITY, PLAYER_HEIGHT, type CityConfig } from '../world/cityConfig'
import { generateCity, type ParkedCarDef } from '../world/cityLayout'
import { useInputStore } from '../store/InputStore'
import { useCarStore } from '../store/CarStore'
import { useUiStore } from '../store/UiStore'
import { playerState } from '../state/playerState'
import { TUNING } from '../tuning'

/** Радиус, в котором игрок может сесть в машину, м. */
const INTERACT_RADIUS = 3
/** Насколько машина выезжает из бордюра при выходе, м. */
const EXIT_OFFSET = 0.75

const UP = new THREE.Vector3(0, 1, 0)

// Черновики для расчётов в кадре — за рулём едет только одна машина.
const carQuaternion = new THREE.Quaternion()
const carForward = new THREE.Vector3()
const carSide = new THREE.Vector3()

/** Припаркованная машина с идентификатором — по нему её находит игрок. */
interface Car extends ParkedCarDef {
  id: string
}

/** Dev-хук: состояние вождения — видно из консоли без отладчика. */
const carDebug = {
  isDriving: false,
  currentCarId: null as string | null,
  speed: 0,
  throttle: 0,
  /** Позиции припаркованных машин — удобно для отладки и автотестов. */
  parked: [] as { x: number; z: number }[],
  /** Внутренние значения руля: цель, факт и ограничения. */
  steer: {
    target: 0,
    actual: 0,
    limit: 0,
    authority: 0,
  },
  /** Сырая угловая скорость тела из Rapier — для проверки, что вращение не сбрасывается. */
  angvel: { x: 0, y: 0, z: 0 },
}

if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __carState: typeof carDebug }).__carState = carDebug
}

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
      if (t) uv.push(t.getX(i), t.getY(i))
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
  index,
  chassisMaterial,
  wheelMaterial,
  register,
}: {
  def: Car
  index: number
  chassisMaterial: THREE.Material
  wheelMaterial: THREE.Material
  register: (index: number, body: RapierRigidBody | null) => void
}) {
  const body = useRef<RapierRigidBody>(null)
  const chassis = useMemo(() => buildChassis(def), [def])
  const wheels = useMemo(() => buildWheels(def), [def])

  useEffect(() => {
    register(index, body.current)
    return () => register(index, null)
  }, [index, register])

  return (
    <RigidBody
      ref={body}
      colliders={false}
      type="dynamic"
      position={def.position}
      rotation={[0, def.yaw, 0]}
      enabledRotations={[false, true, false]}
      linearDamping={0.25}
      angularDamping={0.5}
      friction={0.9}
      restitution={0}
    >
      <CuboidCollider
        args={[def.width / 2, def.height / 2, def.length / 2]}
        friction={0}
      />
      <mesh geometry={chassis} material={chassisMaterial} castShadow receiveShadow />
      <mesh geometry={wheels} material={wheelMaterial} castShadow />
    </RigidBody>
  )
}

export function CarController({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const cars = useMemo<Car[]>(
    () => generateCity(config).parkedCars.map((def, index) => ({ ...def, id: `car-${index}` })),
    [config],
  )
  const indexById = useMemo(() => new Map(cars.map((car, i) => [car.id, i])), [cars])

  const bodies = useRef<(RapierRigidBody | null)[]>([])

  const setCarPrompt = useUiStore((state) => state.setCarPrompt)

  const chassisMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }),
    [],
  )
  const wheelMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    [],
  )

  useEffect(
    () => () => {
      chassisMaterial.dispose()
      wheelMaterial.dispose()
    },
    [chassisMaterial, wheelMaterial],
  )

  /** Регистрация тела машины в общем массиве — по индексу из карты города. */
  const register = useCallback((index: number, body: RapierRigidBody | null) => {
    bodies.current[index] = body
  }, [])

  // ─── Шаг 2: вход в машину ─────────────────────────────────────────────────
  const enterCar = useCallback(
    (index: number) => {
      const car = cars[index]
      const body = bodies.current[index]
      if (!car || !body) return

      useCarStore.getState().enterCar(car.id)
      playerState.driving = true

      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // Шины «без трения»: сцепление с асфальтом держит только код (импульс
      // GRIP). Плоское днище кузова иначе упирается в асфальт, и руль
      // физически не может провернуть машину — она словно на рельсах.
      if (TUNING.carFrictionlessTires) {
        body.collider(0)?.setFrictionCombineRule(CoefficientCombineRule.Min)
      }

      // Камера не должна цеплять коллайдер машины — иначе она прижимается
      // к кузову и не видно, куда едешь.
      playerState.carBody = body

      // Персонаж прячем целиком: тело отключаем, меш гасит PlayerController.
      playerState.body?.setEnabled(false)
    },
    [cars],
  )

  // ─── Шаг 4: выход из машины ───────────────────────────────────────────────
  const exitCar = useCallback(
    (index: number) => {
      const def = cars[index]
      const body = bodies.current[index]

      useCarStore.getState().exitCar()
      playerState.driving = false

      if (!body || !def) return

      // Гасим машину.
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      // Возвращаем обычное трение — припаркованная машина должна стоять.
      body.collider(0)?.setFrictionCombineRule(CoefficientCombineRule.Average)
      playerState.carBody = null

      // Возвращаем игрока у двери — со стороны бордюра.
      const player = playerState.body
      if (player) {
        const t = body.translation()
        const [dirX, dirZ] = def.curbDir
        const x = t.x + dirX * (def.width / 2 + EXIT_OFFSET)
        const z = t.z + dirZ * (def.width / 2 + EXIT_OFFSET)
        player.setEnabled(true)
        player.setTranslation({ x, y: PLAYER_HEIGHT / 2 + 0.15, z }, true)
        player.setLinvel({ x: 0, y: 0, z: 0 }, true)
        player.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }
    },
    [cars],
  )

  // ─── Шаг 3: управление машиной ───────────────────────────────────────────
  const drive = useCallback(
    (index: number, dt: number) => {
      const body = bodies.current[index]
      const def = cars[index]
      if (!body) return

      const input = useInputStore.getState()
      const keys = input.keys

      const mass = body.mass()
      const rot = body.rotation()
      carQuaternion.set(rot.x, rot.y, rot.z, rot.w)

      // Вперёд по локальной оси машины, в горизонтали.
      carForward.set(0, 0, 1).applyQuaternion(carQuaternion)
      carForward.y = 0
      if (carForward.lengthSq() < 1e-6) carForward.set(0, 0, 1)
      carForward.normalize()
      // Боковое направление: forward × up.
      carSide.crossVectors(carForward, UP).normalize()

      const forward = carForward
      const side = carSide

      const velocity = body.linvel()
      const angular = body.angvel()
      const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z
      const sideSpeed = velocity.x * side.x + velocity.z * side.z

      let throttle = 0
      if (keys['KeyW'] || keys['ArrowUp']) throttle += 1
      if (keys['KeyS'] || keys['ArrowDown']) throttle -= 1

      let steer = 0
      if (keys['KeyA'] || keys['ArrowLeft']) steer += 1
      if (keys['KeyD'] || keys['ArrowRight']) steer -= 1

      const braking = !!keys['Space']

      // ─── Газ / задний ход ─────────────────────────────────────────────────
      // Тяну импульсом так, чтобы продольная скорость подтягивалась к целевой:
      // так машина гарантированно трогается, даже если сцепление подъедает
      // часть усилия. Боковой компонент скорости трогать нельзя — его гасит
      // сцепление ниже, иначе машину будет разворачивать на месте.
      if (throttle !== 0 && !braking) {
        const accel = throttle > 0 ? TUNING.carEngineAccel : TUNING.carReverseAccel
        const desired = THREE.MathUtils.clamp(
          forwardSpeed + throttle * accel * dt,
          -TUNING.carMaxReverseSpeed,
          TUNING.carMaxSpeed,
        )
        const impulse = (desired - forwardSpeed) * mass
        body.applyImpulse(
          { x: forward.x * impulse, y: 0, z: forward.z * impulse },
          true,
        )
      }

      // ─── Сцепление: скорость доворачивается за кузовом ─────────────────────
      // Важно: величина скорости при этом сохраняется. Раньше боковое
      // скольжение просто гасилось импульсом, и при резком повороте (кузов
      // успевает провернуться быстрее, чем траектория) весь ход съедался —
      // машина тормозила до нуля прямо в повороте и дальше крутилась волчком.
      // Теперь импульс поворачивает вектор скорости к курсу кузова, а её
      // модуль почти не меняется.
      const speedNow = Math.hypot(velocity.x, velocity.z)
      if (speedNow > 0.05) {
        const follow = 1 - Math.exp(-TUNING.carGrip * dt)
        // Угол скольжения: насколько скорость отстаёт от курса кузова.
        const slip = Math.abs(Math.asin(THREE.MathUtils.clamp(sideSpeed / speedNow, -1, 1)))
        // В заносе машина всё же слегка теряет ход.
        const drag = Math.max(0, 1 - TUNING.carTurnDrag * slip * dt)
        const wantX = forward.x * speedNow * drag
        const wantZ = forward.z * speedNow * drag
        const nextX = velocity.x + (wantX - velocity.x) * follow
        const nextZ = velocity.z + (wantZ - velocity.z) * follow
        body.applyImpulse(
          { x: (nextX - velocity.x) * mass, y: 0, z: (nextZ - velocity.z) * mass },
          true,
        )
      }

      // ─── Руль ─────────────────────────────────────────────────────────────
      // Управляем не моментом, а целевой скоростью поворота кузова.
      // Так руль сам возвращается в «прямо», а на большой скорости угол
      // ограничивается — как в настоящей машине.
      const speedFactor = THREE.MathUtils.clamp(
        Math.abs(forwardSpeed) / TUNING.carSteerFullSpeed,
        TUNING.carMinSteerAuthority,
        1,
      )
      // carYawFalloff = 0 — спада нет, руль одинаково резкий на любой скорости.
      const yawLimit =
        TUNING.carYawFalloff > 0
          ? TUNING.carMaxYawRate /
            (1 + Math.abs(forwardSpeed) / TUNING.carYawFalloff)
          : TUNING.carMaxYawRate
      // На заднем ходу руль работает наоборот.
      const direction = forwardSpeed < 0 ? -1 : 1
      const targetYawRate = steer * direction * yawLimit * speedFactor
      const inertia = (mass * (def.width * def.width + def.length * def.length)) / 12
      const yawError = targetYawRate - angular.y
      const torque = yawError * inertia * TUNING.carSteerResponse * dt
      body.applyTorqueImpulse({ x: 0, y: torque, z: 0 }, true)

      if (import.meta.env.DEV) {
        carDebug.steer.target = targetYawRate
        carDebug.steer.actual = angular.y
        carDebug.steer.limit = yawLimit
        carDebug.steer.authority = speedFactor
      }

      // ─── Тормоз ───────────────────────────────────────────────────────────
      if (braking) {
        const speed = Math.hypot(velocity.x, velocity.z)
        if (speed > 0.02) {
          const factor = Math.max(0, 1 - TUNING.carBrake * dt)
          body.setLinvel({ x: velocity.x * factor, y: velocity.y, z: velocity.z * factor }, true)
        }
        body.setAngvel({ x: 0, y: angular.y * Math.max(0, 1 - TUNING.carBrake * dt), z: 0 }, true)
      }

      // ─── Ограничение максимальной скорости ──────────────────────────────
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z)
      if (horizontalSpeed > TUNING.carMaxSpeed) {
        const scale = TUNING.carMaxSpeed / horizontalSpeed
        body.setLinvel({ x: velocity.x * scale, y: velocity.y, z: velocity.z * scale }, true)
      }

      // ─── Камера и HUD следуют за машиной ─────────────────────────────────
      const t = body.translation()
      playerState.position.set(t.x, t.y, t.z)
      const speed = body.linvel()
      playerState.speed = Math.hypot(speed.x, speed.z)

      // Курс машины — камера по нему возвращается за кузов.
      playerState.carYaw = Math.atan2(forward.x, forward.z)
      playerState.carForwardSpeed = forwardSpeed
      playerState.carYawRate = angular.y
      // Насколько кузов перевёрнут: «вверх» машины в мировых координатах.
      playerState.carUpY = UP.clone().applyQuaternion(carQuaternion).y

      carDebug.speed = playerState.speed
      carDebug.throttle = throttle
    },
    [cars],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const input = useInputStore.getState()
    const pressedF = input.consumePress('KeyF')

    // ─── Какая машина наша ──────────────────────────────────────────────────
    const carState = useCarStore.getState()
    const drivingIndex =
      carState.isDriving && carState.currentCarId
        ? (indexById.get(carState.currentCarId) ?? -1)
        : -1

    if (drivingIndex >= 0) {
      drive(drivingIndex, dt)
      setCarPrompt('Нажми F, чтобы выйти')
      carDebug.isDriving = true
      carDebug.currentCarId = carState.currentCarId
      if (pressedF) exitCar(drivingIndex)
      return
    }

    // ─── Поиск ближайшей машины ────────────────────────────────────────────
    const px = playerState.position.x
    const pz = playerState.position.z
    let nearest = -1
    let nearestDistance = INTERACT_RADIUS

    for (let i = 0; i < cars.length; i++) {
      const body = bodies.current[i]
      if (!body) continue
      const t = body.translation()
      const distance = Math.hypot(t.x - px, t.z - pz)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = i
      }
      if (import.meta.env.DEV) {
        const parked = carDebug.parked
        if (parked.length <= i) parked.push({ x: t.x, z: t.z })
        else {
          parked[i].x = t.x
          parked[i].z = t.z
        }
      }
    }

    if (pressedF && nearest >= 0) enterCar(nearest)
    setCarPrompt(nearest >= 0 ? 'Нажми F, чтобы сесть' : null)
    carDebug.isDriving = false
    carDebug.currentCarId = null
    carDebug.speed = 0
    carDebug.throttle = 0
  })

  return (
    <group>
      {cars.map((def, index) => (
        <ParkedCar
          key={def.id}
          def={def}
          index={index}
          chassisMaterial={chassisMaterial}
          wheelMaterial={wheelMaterial}
          register={register}
        />
      ))}
    </group>
  )
}
