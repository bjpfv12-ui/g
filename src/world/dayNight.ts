import * as THREE from 'three'

/** Полный цикл суток, реальные секунды. */
export const DAY_CYCLE_SECONDS = 300

/** Час, с которого начинается цикл: утро. */
export const START_HOUR = 8

/** Максимальная высота солнца над горизонтом, радианы (~62°). */
export const MAX_SUN_ELEVATION = 1.08

/** Пиковая яркость солнца — совпадает с дневным значением. */
export const MAX_SUN_INTENSITY = 10.5
export const MAX_AMBIENT_INTENSITY = 0.37
export const MAX_FILL_INTENSITY = 0.9
export const MAX_ENV_INTENSITY = 0.74

const NIGHT_AMBIENT_INTENSITY = 0.16
const MOON_FILL_INTENSITY = 0.5
const NIGHT_ENV_INTENSITY = 0.03

const DAY_SUN_COLOR = new THREE.Color('#fff4e6')
const SUNSET_SUN_COLOR = new THREE.Color('#ff8a3d')
const DAY_AMBIENT = new THREE.Color('#b0c4de')
const NIGHT_AMBIENT = new THREE.Color('#2c3a5c')
const SUNSET_AMBIENT = new THREE.Color('#8d7fa0')
const DAY_FILL = new THREE.Color('#9db9dd')
const MOON_FILL = new THREE.Color('#7e93c4')
const DAY_FOG = new THREE.Color('#c9d6df')
const NIGHT_FOG = new THREE.Color('#161d2e')
const SUNSET_FOG = new THREE.Color('#dfa984')

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export interface DayNight {
  /** Фаза цикла 0..1. */
  phase: number
  /** Время суток в часах, 0..24. */
  hour: number
  /** Высота солнца над горизонтом, радианы (отрицательная — за горизонтом). */
  elevation: number
  /** Азимут солнца, радианы. */
  azimuth: number
  /** Направление на солнце, единичный вектор. */
  direction: THREE.Vector3
  /** Высота солнца в долях максимума: 1 — зенит, -1 — под горизонтом. */
  sunHeight: number
  /** 0 — глубокая ночь, 1 — полдень. */
  daylight: number
  /** 0..1 — насколько солнце у горизонта (рассвет или закат). */
  twilight: number
  /** Солнце поднимается (рассвет) или опускается (закат). */
  rising: boolean
}

export interface DayLight {
  sunColor: THREE.Color
  sunIntensity: number
  ambientColor: THREE.Color
  ambientIntensity: number
  fillColor: THREE.Color
  fillIntensity: number
  fogColor: THREE.Color
  environmentIntensity: number
}

/**
 * Солнце ходит по дуге, а часы идут синхронно: 6:00 — рассвет, 12:00 — зенит,
 * 18:00 — закат, 00:00 — под горизонтом. Полный оборот — за 5 минут.
 */
export function getDayNight(phase: number): DayNight {
  const p = ((phase % 1) + 1) % 1
  const hour = (START_HOUR + p * 24) % 24

  // Угол солнца: 0 на рассвете, π на закате, -π/2 в полночь.
  const hourAngle = ((hour - 6) / 24) * Math.PI * 2
  const sunHeight = Math.sin(hourAngle)
  const elevation = sunHeight * MAX_SUN_ELEVATION
  const azimuth = Math.PI / 2 - hourAngle

  const direction = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize()

  return {
    phase: p,
    hour,
    elevation,
    azimuth,
    direction,
    sunHeight,
    daylight: smoothstep(-0.1, 0.3, sunHeight),
    twilight: Math.max(0, 1 - Math.abs(sunHeight) / 0.35),
    // Коснуться горизонта можно и на рассвете, и на закате — различаем
    // их по направлению движения солнца, а не по знаку высоты.
    rising: Math.cos(hourAngle) >= 0,
  }
}

/** Цвета и интенсивности для текущего положения солнца. */
export function getDayLight(dn: DayNight, out?: DayLight): DayLight {
  const result: DayLight =
    out ??
    ({
      sunColor: new THREE.Color(),
      ambientColor: new THREE.Color(),
      fillColor: new THREE.Color(),
      fogColor: new THREE.Color(),
      sunIntensity: 0,
      ambientIntensity: 0,
      fillIntensity: 0,
      environmentIntensity: 0,
    } satisfies DayLight)

  const { daylight, twilight, sunHeight } = dn

  // Солнце: у горизонта оранжевое, в зените почти белое.
  result.sunColor.copy(SUNSET_SUN_COLOR).lerp(DAY_SUN_COLOR, smoothstep(0.02, 0.45, sunHeight))
  result.sunIntensity = MAX_SUN_INTENSITY * Math.pow(Math.max(0, sunHeight), 0.55)

  // Ambient: ночью холодный и слабый, на закате — тёплый сумрак.
  result.ambientColor
    .copy(NIGHT_AMBIENT)
    .lerp(DAY_AMBIENT, daylight)
    .lerp(SUNSET_AMBIENT, twilight * daylight)
  result.ambientIntensity =
    NIGHT_AMBIENT_INTENSITY + (MAX_AMBIENT_INTENSITY - NIGHT_AMBIENT_INTENSITY) * daylight

  // Подсветка с теневой стороны: днём холодная, ночью — лунный свет.
  result.fillColor.copy(MOON_FILL).lerp(DAY_FILL, daylight)
  result.fillIntensity =
    MOON_FILL_INTENSITY + (MAX_FILL_INTENSITY - MOON_FILL_INTENSITY) * daylight

  // Туман: днём — городская дымка, на закате — тёплая, ночью — тёмная.
  result.fogColor.copy(NIGHT_FOG).lerp(DAY_FOG, daylight).lerp(SUNSET_FOG, twilight)
  result.environmentIntensity =
    NIGHT_ENV_INTENSITY + (MAX_ENV_INTENSITY - NIGHT_ENV_INTENSITY) * daylight

  return result
}

/** «07:42» из дробного часа. */
export function formatClock(hour: number): string {
  const whole = Math.floor(hour)
  const h = whole % 24
  const m = Math.floor((hour - whole) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Короткая подпись фазы суток для HUD. */
export function getPhaseLabel(dn: DayNight): string {
  if (dn.twilight > 0.55) return dn.rising ? 'Рассвет' : 'Закат'
  if (dn.daylight > 0.55) return 'День'
  return 'Ночь'
}
