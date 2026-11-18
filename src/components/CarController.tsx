import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
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
/**
 * Минимальный шаг времени для расчётов, с. Нулевой шаг (два кадра в одной
 * миллисекунде) приводит к делению на ноль и к NaN в скоростях.
 */
const MIN_DT = 1e-4

const UP = new THREE.Vector3(0, 1, 0)

// Черновики для расчётов в кадре — за рулём едет только одна машина.
const carQuaternion = new THREE.Quaternion()
const carForward = new THREE.Vector3()
const carUp = new THREE.Vector3()

/** Припаркованная машина с идентификатором — по нему её находит игрок. */
interface Car extends ParkedCarDef {
  id: string
}

/**
 * Dev-хук: состояние вождения — видно из консоли без отладчика.
 *
 * Имена полей `steer.*` и `trace` сохранены от прежней импульсной реализации:
 * на них завязаны диагностические скрипты в `scripts/`.
 */
const carDebug = {
  isDriving: false,
  currentCarId: null as string | null,
  speed: 0,
  throttle: 0,
  /** Позиции припаркованных машин — удобно для отладки и автотестов. */
  parked: [] as { x: number; z: number }[],
  /** Руль: цель, факт и ограничения. */
  steer: {
    /** Целевая скорость поворота кузова, рад/с. */
    target: 0,
    /** Фактическая угловая скорость кузова, рад/с. */
    actual: 0,
    /** Предел скорости поворота на текущей скорости, рад/с. */
    limit: 0,
    /** Остаток полномочий руля: 1 — едем медленно, 0 — на максимуме. */
    authority: 0,
    /** Направление скорости: 1 — вперёд, -1 — назад. */
    direction: 1,
    /** Момент к телу больше не прикладывается — оставлено для скриптов. */
    turnForce: 0,
    /** Аварийных доворотов больше нет — оставлено для скриптов. */
    unstuck: 0,
  },
  /** Сырая угловая скорость тела из Rapier. */
  angvel: { x: 0, y: 0, z: 0 },
  /** Тело и габариты текущей машины — для автотестов и замеров. */
  body: null as RapierRigidBody | null,
  dims: { width: 0, length: 0, height: 0 },
  /** Направление от осевой линии дороги к бордюру — куда уезжать на тротуар. */
  curbDir: [0, 0] as [number, number],
  /** Покадровая трасса руля — только для DEV-диагностики. */
  trace: [] as {
    t: number
    steer: number
    forwardSpeed: number
    target: number
    yaw: number
    turnForce: number
    angvel: number
  }[],
  traceOn: false,
  /** Тест-крючок: подставить нулевой dt в один кадр (проверка на NaN). */
  forceZeroDt: false,
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
      // Вращение разрешено только вокруг вертикальной оси Y. Это эквивалент
      // `lockRotations: { x: true, z: true }` в API @react-three/rapier:
      // кузов никогда не заваливается на бок и не переворачивается на бордюре,
      // а руль по-прежнему доворачивает машину.
      enabledRotations={[false, true, false]}
      linearDamping={0.25}
      angularDamping={0.5}
      friction={0.9}
      restitution={0}
    >
      {/* Нулевое трение шин: скорость машины задаёт код, а не контакт с
          асфальтом. Иначе коллайдер днища гасит поворот. */}
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
  /**
   * Счётчики пересоздания кузов: если тело физики сломано (NaN), Rapier
   * больше не отдаёт его состояние. Тогда пересоздаём RigidBody — машина
   * возвращается к жизни вместо того, чтобы потерять руль навсегда.
   */
  const [respawn, setRespawn] = useState<Record<number, number>>({})

  /** Пересоздать кузов машины с заданным индексом. */
  const respawnCar = useCallback((index: number) => {
    setRespawn((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + 1 }))
  }, [])

  /**
   * Текущая скорость машины вдоль её курса, м/с (со знаком).
   *
   * Живёт в коде, а не в физике: газ и тормоз плавно меняют её, а телу
   * каждый кадр выставляется готовая скорость. Так руль работает всегда —
   * его не может «съесть» контакт с асфальтом.
   */
  const driveSpeed = useRef(0)

  // Аварийное восстановление. Если тело физики испорчено (NaN в скоростях),
  // Rapier падает прямо на шаге физики — до блока руля кадр не доходит, и
  // обычный try/catch не помогает. Ловим ошибку на уровне окна и пересоздаём
  // кузов: иначе машина теряет руль навсегда.
  useEffect(() => {
    let lastRespawn = 0
    const onError = (event: ErrorEvent) => {
      const message = event.message ?? ''
      if (!/recursive use|unreachable|panic|wasm trap|NaN/i.test(message)) return
      const carState = useCarStore.getState()
      if (!carState.isDriving || !carState.currentCarId) return
      const index = indexById.get(carState.currentCarId)
      if (index === undefined) return
      // Ошибка повторяется каждый кадр — пересоздаём кузов не чаще раза в 3 с.
      const now = performance.now()
      if (now - lastRespawn < 3000) return
      lastRespawn = now
      console.warn('[car] физика упала, пересоздаём кузов:', message)
      respawnCar(index)
    }
    window.addEventListener('error', onError)
    return () => window.removeEventListener('error', onError)
  }, [indexById, respawnCar])

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
  const register = useCallback(
    (index: number, body: RapierRigidBody | null) => {
      bodies.current[index] = body
      // Тело пересоздали (сломанная физика) — обновляем ссылку камеры,
      // иначе она продолжит следить за уже несуществующим телом.
      const currentId = useCarStore.getState().currentCarId
      if (body && playerState.driving && currentId && indexById.get(currentId) === index) {
        playerState.carBody = body
      }
    },
    [indexById],
  )

  // ─── Шаг 2: вход в машину ─────────────────────────────────────────────────
  const enterCar = useCallback(
    (index: number) => {
      const car = cars[index]
      const body = bodies.current[index]
      if (!car || !body) return

      useCarStore.getState().enterCar(car.id)
      playerState.driving = true

      driveSpeed.current = 0
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)

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

      driveSpeed.current = 0

      if (!body || !def) return

      // Гасим машину.
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
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
  /**
   * Аркадное управление. Сил к телу не применяется — только прямое
   * выставление скорости:
   *
   * - W/S меняют целевую скорость вдоль курса кузова, скорость подтягивается
   *   к цели экспоненциально (плавный разгон и торможение);
   * - A/D выставляют угловую скорость вокруг Y: чем медленнее едет машина,
   *   тем резче руль;
   * - Space — мгновенный стоп.
   *
   * Вращение вокруг X и Z заблокировано на теле, так что машина не валится.
   */
  const drive = useCallback(
    (index: number, dt: number) => {
      const body = bodies.current[index]
      const def = cars[index]
      if (!body) return

      // Ссылка на тело держим актуальной сразу: если тело пересоздают,
      // отладочный хук должен показывать новое.
      carDebug.body = body

      // Время шага никогда не должно быть нулём: два кадра в одной
      // миллисекунде дают dt = 0, а деление на ноль превращает скорость в NaN.
      const sdt = Math.max(dt, MIN_DT)

      const input = useInputStore.getState()
      const keys = input.keys

      // Тело физики может оказаться испорченным (NaN в скоростях): Rapier
      // после этого перестаёт отдавать состояние и бросает исключение на
      // каждом обращении. Ловим это и пересоздаём кузов — иначе управление
      // пропало бы навсегда.
      let velocity: { x: number; y: number; z: number }
      let angular: { x: number; y: number; z: number }
      let rot: { x: number; y: number; z: number; w: number }
      try {
        velocity = body.linvel()
        angular = body.angvel()
        rot = body.rotation()
      } catch (err) {
        console.warn(
          '[car] тело физики сломано, пересоздаём кузов:',
          err instanceof Error ? err.message : err,
        )
        respawnCar(index)
        return
      }

      // Испорченные скорости остаются в теле навсегда — сбрасываем и
      // пересоздаём кузов, иначе руль пропадает навсегда.
      if (
        !Number.isFinite(velocity.x) ||
        !Number.isFinite(velocity.y) ||
        !Number.isFinite(velocity.z) ||
        !Number.isFinite(angular.x) ||
        !Number.isFinite(angular.y) ||
        !Number.isFinite(angular.z)
      ) {
        try {
          body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        } catch {
          /* тело мертво — ниже пересоздаём */
        }
        respawnCar(index)
        return
      }

      carQuaternion.set(rot.x, rot.y, rot.z, rot.w)

      // Вперёд по локальной оси машины, в горизонтали.
      carForward.set(0, 0, 1).applyQuaternion(carQuaternion)
      carForward.y = 0
      if (carForward.lengthSq() < 1e-6) carForward.set(0, 0, 1)
      carForward.normalize()

      // ─── Ввод ──────────────────────────────────────────────────────────────
      let throttle = 0
      if (keys['KeyW'] || keys['ArrowUp']) throttle += 1
      if (keys['KeyS'] || keys['ArrowDown']) throttle -= 1

      let steer = 0
      if (keys['KeyA'] || keys['ArrowLeft']) steer += 1
      if (keys['KeyD'] || keys['ArrowRight']) steer -= 1

      const braking = !!keys['Space']

      // ─── Скорость ──────────────────────────────────────────────────────────
      // Скорость живёт в коде: газ и тормоз плавно ведут её к цели, а телу
      // выставляется готовая скорость строго вдоль курса кузова.
      let turnRate = 0
      if (braking) {
        // Мгновенный стоп: и поступательная, и угловая скорость обнуляются.
        driveSpeed.current = 0
        body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      } else {
        const current = driveSpeed.current
        let target: number
        let rate: number
        if (throttle > 0) {
          target = TUNING.carMaxSpeed
          // Если едем назад — газ сначала тормозит, и только потом разгоняет.
          rate = current < -0.1 ? TUNING.carBrakeRate : TUNING.carAccelRate
        } else if (throttle < 0) {
          target = -TUNING.carMaxReverseSpeed
          // Если едем вперёд — S тормозит, а не разворачивает машину сразу.
          rate = current > 0.1 ? TUNING.carBrakeRate : TUNING.carReverseAccelRate
        } else {
          // Ничего не нажато — машина катится накатом и плавно тормозит.
          target = 0
          rate = TUNING.carCoastRate
        }

        // Плавное движение к цели: экспоненциальное сглаживание.
        let next = current + (target - current) * (1 - Math.exp(-rate * sdt))

        // Препятствие: физика гасит скорость о стену, а команда продолжает
        // давить машину в стену на полной скорости. Если фактическая
        // скорость сильно ниже заданной — машина упирается: подстраиваем
        // команду под факт, иначе спидометр врёт и машина стоит в стене.
        const actualSpeed = Math.hypot(velocity.x, velocity.z)
        if (next > 2 && actualSpeed < next * 0.4) {
          next += (actualSpeed - next) * (1 - Math.exp(-TUNING.carBlockRate * sdt))
        }

        driveSpeed.current = Math.abs(next) < 0.01 ? 0 : next

        body.setLinvel(
          {
            x: carForward.x * driveSpeed.current,
            y: velocity.y,
            z: carForward.z * driveSpeed.current,
          },
          true,
        )

        // ─── Руль ──────────────────────────────────────────────────────────
        // Угловая скорость ставится напрямую: руль работает всегда, его не
        // может «съесть» ни трение, ни контакт с бордюром. Чем медленнее едет
        // машина, тем резче поворот — на месте руль крутит сильнее всего.
        const speedFactor = THREE.MathUtils.clamp(
          Math.abs(driveSpeed.current) / TUNING.carMaxSpeed,
          0,
          1,
        )
        turnRate = THREE.MathUtils.lerp(
          TUNING.carTurnRateIdle,
          TUNING.carTurnRateFast,
          speedFactor,
        )
        body.setAngvel({ x: 0, y: steer * turnRate, z: 0 }, true)
      }

      // Фактическая угловая скорость после выставления — для телеметрии.
      let actualYawRate = 0
      try {
        const av = body.angvel()
        actualYawRate = av.y
        carDebug.angvel.x = av.x
        carDebug.angvel.y = av.y
        carDebug.angvel.z = av.z
      } catch {
        actualYawRate = 0
      }

      if (import.meta.env.DEV) {
        carDebug.steer.target = steer * turnRate
        carDebug.steer.actual = actualYawRate
        carDebug.steer.limit = turnRate
        carDebug.steer.authority = 1 - speedFactorOf(driveSpeed.current)
        carDebug.steer.direction = driveSpeed.current < -0.1 ? -1 : 1
      }

      // ─── Камера и HUD следуют за машиной ─────────────────────────────────
      const t = body.translation()
      playerState.position.set(t.x, t.y, t.z)
      playerState.speed = Math.abs(driveSpeed.current)

      // Курс машины — камера по нему возвращается за кузов.
      playerState.carYaw = Math.atan2(carForward.x, carForward.z)
      playerState.carForward.copy(carForward)
      playerState.carForwardSpeed = driveSpeed.current
      playerState.carYawRate = actualYawRate
      // Насколько кузов перевёрнут: «вверх» машины в мировых координатах.
      carUp.copy(UP).applyQuaternion(carQuaternion)
      playerState.carUpY = carUp.y

      carDebug.speed = playerState.speed
      carDebug.throttle = throttle
      carDebug.body = body
      carDebug.dims.width = def.width
      carDebug.dims.length = def.length
      carDebug.dims.height = def.height
      carDebug.curbDir = def.curbDir
      if (import.meta.env.DEV && carDebug.traceOn) {
        carDebug.trace.push({
          t: performance.now(),
          steer,
          forwardSpeed: driveSpeed.current,
          target: steer * turnRate,
          yaw: playerState.carYaw,
          turnForce: 0,
          angvel: actualYawRate,
        })
        if (carDebug.trace.length > 4000) carDebug.trace.shift()
      }
    },
    [cars, respawnCar],
  )

  useFrame((_, delta) => {
    const dt = carDebug.forceZeroDt ? 0 : Math.min(delta, 1 / 30)
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
          // Счётчик пересоздания: сломанное тело физики заменяется новым.
          key={`${def.id}-${respawn[index] ?? 0}`}
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

/** Доля потери полномочий руля: 0 — машина едет медленно, 1 — на максимуме. */
function speedFactorOf(speed: number): number {
  return THREE.MathUtils.clamp(Math.abs(speed) / TUNING.carMaxSpeed, 0, 1)
}
