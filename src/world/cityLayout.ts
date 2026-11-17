import { DEFAULT_CITY, type CityConfig } from './cityConfig'

export interface BoxDef {
  position: [number, number, number]
  size: [number, number, number]
  color?: string
  /** Поворот: число — вокруг Y, тройка — полный эйлер [x, y, z]. */
  rotation?: number | [number, number, number]
}

export interface BuildingDef extends BoxDef {
  kind: 'glass' | 'concrete' | 'brick'
  floors: number
}

export interface BlockDef {
  center: [number, number]
  size: number
  isPark: boolean
}

export interface CityData {
  blocks: BlockDef[]
  buildings: BuildingDef[]
  /** Тёмное отражающее стекло. */
  windows: BoxDef[]
  /** Светящиеся окна — отдельный слой, чтобы задать им emissive. */
  litWindows: BoxDef[]
  parapets: BoxDef[]
  roofProps: BoxDef[]
  /** Антенны и баки на крышах — цилиндры. */
  roofAntennas: BoxDef[]
  lampPoles: BoxDef[]
  lampHeads: BoxDef[]
  treeTrunks: BoxDef[]
  treeCanopies: BoxDef[]
  palmTrunks: BoxDef[]
  palmFronds: BoxDef[]
  carBodies: BoxDef[]
  carRoofs: BoxDef[]
  carWheels: BoxDef[]
  yellowMarks: BoxDef[]
  whiteMarks: BoxDef[]
  parkSlabs: BoxDef[]
  skyline: BoxDef[]
  /** Габарит города: от -extent/2 до +extent/2 по каждой оси. */
  extent: number
  /** Координаты осей дорог (центральные линии). */
  roadLines: number[]
}

/** Палитра фасадов: беж, серый, светло-коричневый, белый. */
const CONCRETE = [
  '#c7bca9',
  '#b9b0a1',
  '#d3c8b4',
  '#a9a396',
  '#c2b5a2',
  '#ded3bf',
  '#b6a894',
  '#d8d4cb',
  '#cfcbc2',
  '#9fa5a8',
  '#e2ddd2',
  '#b2aca2',
]
const BRICK = ['#a3664f', '#8e5845', '#b5795c', '#95604c', '#7f6a5c']
const GLASS = ['#8ea6b8', '#7d94a6', '#9fb2c0', '#6f8799', '#88a0b0']
/** Тёмное стекло — почти чёрное, с синим отливом. */
const DARK_GLASS = ['#1c2733', '#22303f', '#182029', '#2a3846', '#141b23', '#1e2a36']
/** Светящиеся окна — тёплый свет изнутри. */
const LIT_GLASS = ['#ffd79a', '#ffc98a', '#ffe0b0', '#ffbe7a', '#ffd08c']
const ROOF_COLORS = ['#8d8880', '#7d7871', '#9a958c', '#6f6a63']
const METAL_COLORS = ['#9aa0a6', '#7f868c', '#b0b6bb', '#6c7278']
const CAR_COLORS = ['#8d3f36', '#3f5f8d', '#c9c2b4', '#4a4d52', '#6b7f5a', '#b0763f', '#2f3438', '#d3d0c8']

/**
 * Лёгкая выжимка раскладки для мини-карты: только оси дорог и габариты,
 * без тысяч окон и зданий.
 */
export function getCityOutline(cfg: CityConfig = DEFAULT_CITY) {
  const pitch = cfg.blockSize + cfg.roadWidth
  const lines: number[] = []
  for (let k = 0; k <= cfg.blocks; k++) lines.push((k - cfg.blocks / 2) * pitch)
  return {
    lines,
    pitch,
    blocks: cfg.blocks,
    blockSize: cfg.blockSize,
    roadWidth: cfg.roadWidth,
    extent: cfg.blocks * cfg.blockSize + (cfg.blocks + 1) * cfg.roadWidth,
  }
}

/**
 * Точка старта игрока — угол тротуара центрального квартала,
 * рядом с перекрёстком. Важно: не внутри застройки, иначе камера
 * окажется внутри здания.
 */
export function getSpawnPoint(cfg: CityConfig = DEFAULT_CITY): [number, number, number] {
  const pitch = cfg.blockSize + cfg.roadWidth
  const linePos = (k: number) => (k - cfg.blocks / 2) * pitch
  const mid = Math.floor(cfg.blocks / 2)
  const blockCenter = linePos(mid) + pitch / 2
  const blockEdge = blockCenter - cfg.blockSize / 2
  const offset = blockEdge + cfg.sidewalkWidth / 2
  return [offset, cfg.curbHeight, offset]
}

export function mulberry32(seed: number): () => number {  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]

interface Lot {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** Бинарное деление участка на лоты — даёт нерегулярную, но правдоподобную застройку. */
function splitLots(lot: Lot, depth: number, rng: () => number, cfg: CityConfig, out: Lot[]): void {
  const w = lot.maxX - lot.minX
  const d = lot.maxZ - lot.minZ
  const canSplit = w > cfg.minLot * 2 || d > cfg.minLot * 2
  if (depth <= 0 || !canSplit) {
    out.push(lot)
    return
  }
  const splitX = w > d ? true : d > w ? false : rng() > 0.5
  if (splitX) {
    const cut = lot.minX + w * (0.4 + rng() * 0.2)
    splitLots({ ...lot, maxX: cut }, depth - 1, rng, cfg, out)
    splitLots({ ...lot, minX: cut }, depth - 1, rng, cfg, out)
  } else {
    const cut = lot.minZ + d * (0.4 + rng() * 0.2)
    splitLots({ ...lot, maxZ: cut }, depth - 1, rng, cfg, out)
    splitLots({ ...lot, minZ: cut }, depth - 1, rng, cfg, out)
  }
}

export function generateCity(config: CityConfig = DEFAULT_CITY): CityData {
  const cfg = config
  const rng = mulberry32(cfg.seed)

  const pitch = cfg.blockSize + cfg.roadWidth
  const linePos = (k: number) => (k - cfg.blocks / 2) * pitch
  const extent = cfg.blocks * cfg.blockSize + (cfg.blocks + 1) * cfg.roadWidth
  const halfExtent = extent / 2

  const data: CityData = {
    blocks: [],
    buildings: [],
    windows: [],
    litWindows: [],
    parapets: [],
    roofProps: [],
    roofAntennas: [],
    lampPoles: [],
    lampHeads: [],
    treeTrunks: [],
    treeCanopies: [],
    palmTrunks: [],
    palmFronds: [],
    carBodies: [],
    carRoofs: [],
    carWheels: [],
    yellowMarks: [],
    whiteMarks: [],
    parkSlabs: [],
    skyline: [],
    extent,
    roadLines: [],
  }

  const roadLines: number[] = []
  for (let k = 0; k <= cfg.blocks; k++) roadLines.push(linePos(k))
  data.roadLines = roadLines

  // ─── Кварталы, тротуары и застройка ───────────────────────────────────────────
  const inner = cfg.blockSize - cfg.sidewalkWidth * 2

  for (let i = 0; i < cfg.blocks; i++) {
    for (let j = 0; j < cfg.blocks; j++) {
      const cx = linePos(i) + pitch / 2
      const cz = linePos(j) + pitch / 2
      const isPark = rng() < 0.08
      data.blocks.push({ center: [cx, cz], size: cfg.blockSize, isPark })

      const half = inner / 2
      const lots: Lot[] = []
      splitLots(
        { minX: cx - half, minZ: cz - half, maxX: cx + half, maxZ: cz + half },
        3,
        rng,
        cfg,
        lots,
      )

      for (const lot of lots) {
        const lotW = lot.maxX - lot.minX
        const lotD = lot.maxZ - lot.minZ
        const lotCx = (lot.minX + lot.maxX) / 2
        const lotCz = (lot.minZ + lot.maxZ) / 2

        // Парк или пустырь — без здания.
        if (isPark || (rng() < 0.06 && lotW > 18 && lotD > 18)) {
          if (!isPark) {
            // парковка: ровная площадка с редкими деревьями
            const trees = 1 + Math.floor(rng() * 2)
            for (let t = 0; t < trees; t++) {
              const tx = lerp(lot.minX + 3, lot.maxX - 3, rng())
              const tz = lerp(lot.minZ + 3, lot.maxZ - 3, rng())
              pushTree(data, tx, tz, rng)
            }
          }
          continue
        }

        // Габарит здания внутри лота с зазором.
        const inset = cfg.buildingGap + rng() * 1.6
        const w = Math.max(8, lotW - inset * 2)
        const d = Math.max(8, lotD - inset * 2)

        // Высота зависит от удалённости от центра — так рождается скайлайн.
        const dist = Math.max(Math.abs(cx), Math.abs(cz)) / halfExtent
        const center = 1 - Math.min(1, dist)
        const downtown = Math.pow(smoothstep(center), 1.35)
        let height = lerp(cfg.suburbHeight, cfg.downtownHeight, downtown)
        height *= 0.55 + rng() * 0.75
        if (rng() < 0.05) height *= 1.35
        height = Math.max(9, height)

        const kind: BuildingDef['kind'] =
          height > 44 ? 'glass' : rng() < 0.28 ? 'brick' : 'concrete'
        const color =
          kind === 'glass'
            ? pick(rng, GLASS)
            : kind === 'brick'
              ? pick(rng, BRICK)
              : pick(rng, CONCRETE)

        const floors = Math.max(1, Math.floor((height - 4) / cfg.floorHeight))
        data.buildings.push({
          position: [lotCx, cfg.curbHeight, lotCz],
          size: [w, height, d],
          color,
          kind,
          floors,
        })

        // Парапет по периметру крыши.
        data.parapets.push({
          position: [lotCx, cfg.curbHeight + height + 0.35, lotCz],
          size: [w + 0.6, 0.7, d + 0.6],
          color: kind === 'glass' ? '#6f7d88' : '#a79c8c',
        })

        // Кровля: вентиляция, баки, антенны.
        const propCount = 1 + Math.floor(rng() * 3)
        for (let p = 0; p < propCount; p++) {
          const pw = 1.4 + rng() * 3
          const pd = 1.4 + rng() * 3
          const ph = 0.9 + rng() * 2.2
          data.roofProps.push({
            position: [
              lotCx + (rng() - 0.5) * (w - pw - 1.5),
              cfg.curbHeight + height + 0.7 + ph / 2,
              lotCz + (rng() - 0.5) * (d - pd - 1.5),
            ],
            size: [pw, ph, pd],
            color: pick(rng, ROOF_COLORS),
          })
        }

        // Антенны и водяные баки — вертикали, которые читаются в силуэте.
        const antennaCount = rng() < 0.55 ? 1 + Math.floor(rng() * 2) : 0
        for (let a = 0; a < antennaCount; a++) {
          const tank = rng() < 0.35
          const ah = tank ? 2.4 : 3 + rng() * 7
          data.roofAntennas.push({
            position: [
              lotCx + (rng() - 0.5) * (w - 2.5),
              cfg.curbHeight + height + 0.7 + ah / 2,
              lotCz + (rng() - 0.5) * (d - 2.5),
            ],
            // Для цилиндра size — это [радиус, высота, радиус].
            size: tank ? [1.3, ah, 1.3] : [0.09, ah, 0.09],
            color: tank ? pick(rng, METAL_COLORS) : '#5d6167',
          })
        }

        // Окна по всем четырём фасадам.
        if (height > 9) {
          addWindows(data, lotCx, lotCz, w, d, height, cfg, rng)
        }
      }

      // Парк: зелёная площадка + деревья.
      if (isPark) {
        data.parkSlabs.push({
          position: [cx, cfg.curbHeight + 0.02, cz],
          size: [inner, 0.04, inner],
          color: '#5c7346',
        })
        const treeCount = 7 + Math.floor(rng() * 6)
        for (let t = 0; t < treeCount; t++) {
          pushTree(
            data,
            lerp(cx - half + 2, cx + half - 2, rng()),
            lerp(cz - half + 2, cz + half - 2, rng()),
            rng,
          )
        }
      } else {
        // Пальмы вдоль тротуара — фирменный вид Los Santos.
        const edgeCount = 1 + (rng() > 0.62 ? 1 : 0)
        const inset = cfg.sidewalkWidth / 2
        for (let e = 0; e < edgeCount; e++) {
          const side = Math.floor(rng() * 4)
          const count = 3 + Math.floor(rng() * 4)
          const span = cfg.blockSize - 14
          for (let t = 0; t < count; t++) {
            const along =
              lerp(-span / 2, span / 2, (t + 0.5) / count) + (rng() - 0.5) * 3.5
            if (side === 0) pushPalm(data, cx + cfg.blockSize / 2 - inset, cz + along, rng)
            else if (side === 1) pushPalm(data, cx - cfg.blockSize / 2 + inset, cz + along, rng)
            else if (side === 2) pushPalm(data, cx + along, cz + cfg.blockSize / 2 - inset, rng)
            else pushPalm(data, cx + along, cz - cfg.blockSize / 2 + inset, rng)
          }
        }
      }
    }
  }

  // ─── Разметка дорог ──────────────────────────────────────────────────────────
  const segments: [number, number][] = []
  for (let m = 0; m < cfg.blocks; m++) {
    segments.push([linePos(m) + cfg.roadWidth / 2, linePos(m + 1) - cfg.roadWidth / 2])
  }
  const roadStart = linePos(0) - cfg.roadWidth / 2
  const roadEnd = linePos(cfg.blocks) + cfg.roadWidth / 2

  for (const x of roadLines) {
    // Двойная жёлтая по оси дороги (идущей вдоль Z).
    for (const [z0, z1] of segments) {
      const len = z1 - z0
      if (len <= 0) continue
      for (const off of [-0.17, 0.17]) {
        data.yellowMarks.push({
          position: [x + off, 0.015, (z0 + z1) / 2],
          size: [0.15, 0.03, len],
          color: '#d9b24a',
        })
      }
    }
    // Белые краевые линии.
    for (const [z0, z1] of segments) {
      const len = z1 - z0
      if (len <= 0) continue
      for (const off of [-(cfg.roadWidth / 2 - 0.45), cfg.roadWidth / 2 - 0.45]) {
        data.whiteMarks.push({
          position: [x + off, 0.015, (z0 + z1) / 2],
          size: [0.12, 0.03, len],
          color: '#ddd8cd',
        })
      }
    }
  }

  for (const z of roadLines) {
    for (const [x0, x1] of segments) {
      const len = x1 - x0
      if (len <= 0) continue
      for (const off of [-0.17, 0.17]) {
        data.yellowMarks.push({
          position: [(x0 + x1) / 2, 0.015, z + off],
          size: [len, 0.03, 0.15],
          color: '#d9b24a',
        })
      }
      for (const off of [-(cfg.roadWidth / 2 - 0.45), cfg.roadWidth / 2 - 0.45]) {
        data.whiteMarks.push({
          position: [(x0 + x1) / 2, 0.015, z + off],
          size: [len, 0.03, 0.12],
          color: '#ddd8cd',
        })
      }
    }
  }

  // ─── Фонари ─────────────────────────────────────────────────────────────────
  const lampStep = 40
  for (const x of roadLines) {
    for (let z = roadStart + lampStep / 2; z < roadEnd; z += lampStep) {
      for (const side of [-1, 1]) {
        const px = x + side * (cfg.roadWidth / 2 + 1.4)
        data.lampPoles.push({
          position: [px, 3.6, z],
          size: [0.2, 7.2, 0.2],
          color: '#494540',
        })
        data.lampHeads.push({
          position: [px - side * 0.5, 7.05, z],
          size: [0.52, 0.52, 0.52],
          color: '#ffcf96',
        })
      }
    }
  }
  for (const z of roadLines) {
    for (let x = roadStart + lampStep / 2; x < roadEnd; x += lampStep) {
      for (const side of [-1, 1]) {
        const pz = z + side * (cfg.roadWidth / 2 + 1.4)
        data.lampPoles.push({
          position: [x, 3.6, pz],
          size: [0.2, 7.2, 0.2],
          color: '#494540',
        })
        data.lampHeads.push({
          position: [x, 7.05, pz - side * 0.5],
          size: [0.52, 0.52, 0.52],
          color: '#ffcf96',
        })
      }
    }
  }

  // ─── Припаркованные машины ──────────────────────────────────────────────────
  // Статичные, с колёсами-цилиндрами; коллайдеры добавляются в CityGenerator.
  const carStep = cfg.parkedCarStep
  for (const x of roadLines) {
    if (Math.abs(x) > halfExtent - cfg.roadWidth) continue
    for (let z = roadStart + 10; z < roadEnd; z += carStep) {
      if (rng() > cfg.parkedCarChance) continue
      const side = rng() > 0.5 ? 1 : -1
      pushCar(data, x + side * (cfg.roadWidth / 2 - 1.6), z, side === 1 ? 0 : Math.PI, rng)
    }
  }
  for (const z of roadLines) {
    if (Math.abs(z) > halfExtent - cfg.roadWidth) continue
    for (let x = roadStart + 10; x < roadEnd; x += carStep) {
      if (rng() > cfg.parkedCarChance) continue
      const side = rng() > 0.5 ? 1 : -1
      pushCar(data, x, z + side * (cfg.roadWidth / 2 - 1.6), side === 1 ? Math.PI / 2 : -Math.PI / 2, rng)
    }
  }

  // ─── Дальний скайлайн за границей города ────────────────────────────────────
  const skylineCount = 150
  for (let s = 0; s < skylineCount; s++) {
    const angle = rng() * Math.PI * 2
    const radius = cfg.skylineRadius * (0.95 + rng() * 0.4)
    const h = 24 + rng() * 96
    const w = 14 + rng() * 26
    data.skyline.push({
      position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      size: [w, h, w * (0.7 + rng() * 0.6)],
      color: pick(rng, ['#9b9086', '#8d857c', '#a79a8d', '#847d76']),
    })
  }

  return data
}

function pushTree(data: CityData, x: number, z: number, rng: () => number): void {
  const h = 2.6 + rng() * 2.4
  const canopy = 1.9 + rng() * 1.5
  data.treeTrunks.push({
    position: [x, h / 2, z],
    size: [0.34, h, 0.34],
    color: '#5c4633',
  })
  data.treeCanopies.push({
    position: [x, h + canopy * 0.55, z],
    size: [canopy, canopy * 1.25, canopy],
    color: pick(rng, ['#4f6b3c', '#5a7a44', '#44603a', '#6b8a4e']),
  })
}

/** Финиковая пальма: конический ствол + крона из длинных поникающих листьев. */
function pushPalm(data: CityData, x: number, z: number, rng: () => number): void {
  const h = 7.2 + rng() * 3.4
  const lean = (rng() - 0.5) * 0.2
  const yaw = rng() * Math.PI * 2
  const crownY = h * Math.cos(lean)
  const crownX = x + Math.sin(yaw) * Math.sin(lean) * h
  const crownZ = z + Math.cos(yaw) * Math.sin(lean) * h

  data.palmTrunks.push({
    position: [x + (crownX - x) / 2, h / 2, z + (crownZ - z) / 2],
    size: [0.42, h, 0.42],
    color: pick(rng, ['#8a6a46', '#7d6040', '#96764f']),
    rotation: [0, yaw, lean],
  })

  const fronds = 6
  for (let f = 0; f < fronds; f++) {
    const azimuth = (f / fronds) * Math.PI * 2 + rng() * 0.3
    // Лист уходит вбок и заметно поникает — иначе крона слипается в диск.
    const tilt = 0.62 + rng() * 0.34
    const reach = 1.9 + rng() * 0.6
    data.palmFronds.push({
      position: [
        crownX + Math.sin(azimuth) * reach * 0.72,
        crownY + 0.35 - Math.sin(tilt) * reach * 0.72,
        crownZ + Math.cos(azimuth) * reach * 0.72,
      ],
      size: [4.6 + rng() * 0.8, 0.3, 0.95],
      color: pick(rng, ['#4f7a3c', '#5c8a45', '#436b34', '#67994e', '#7ba257']),
      rotation: [-tilt, azimuth, 0],
    })
  }
}

function pushCar(
  data: CityData,
  x: number,
  z: number,
  rotation: number,
  rng: () => number,
): void {
  const color = pick(rng, CAR_COLORS)
  const bodyLength = 4.2 + rng() * 0.8
  const bodyWidth = 1.85
  const bodyHeight = 0.85
  // Локальная ось +Z после поворота на Y.
  const dirX = Math.sin(rotation)
  const dirZ = Math.cos(rotation)
  // Смещение кабины к передней части кузова.
  const cabinOffset = 0.35

  data.carBodies.push({
    position: [x, bodyHeight / 2, z],
    size: [bodyWidth, bodyHeight, bodyLength],
    color,
    rotation,
  })
  data.carRoofs.push({
    position: [x + dirX * cabinOffset, bodyHeight + 0.42, z + dirZ * cabinOffset],
    size: [bodyWidth * 0.86, 0.72, bodyLength * 0.46],
    color: '#2b3036',
    rotation,
  })

  // Колёса: цилиндры, ось направлена поперёк кузова.
  const rightX = Math.cos(rotation)
  const rightZ = -Math.sin(rotation)
  for (const side of [-1, 1]) {
    for (const along of [-1, 1]) {
      data.carWheels.push({
        position: [
          x + rightX * side * (bodyWidth / 2 - 0.08) + dirX * along * (bodyLength / 2 - 1),
          0.34,
          z + rightZ * side * (bodyWidth / 2 - 0.08) + dirZ * along * (bodyLength / 2 - 1),
        ],
        size: [0.64, 0.3, 0.64],
        color: '#1c1f24',
        rotation: [0, rotation, Math.PI / 2],
      })
    }
  }
}

function addWindows(
  data: CityData,
  cx: number,
  cz: number,
  w: number,
  d: number,
  height: number,
  cfg: CityConfig,
  rng: () => number,
): void {
  const floors = Math.max(1, Math.floor((height - 4) / cfg.floorHeight))
  const sides: Array<{ nx: number; nz: number; span: number }> = [
    { nx: 0, nz: 1, span: w },
    { nx: 0, nz: -1, span: w },
    { nx: 1, nz: 0, span: d },
    { nx: -1, nz: 0, span: d },
  ]

  for (const side of sides) {
    const columns = Math.max(1, Math.floor(side.span / cfg.windowSpacing))
    const step = side.span / (columns + 1)
    for (let c = 0; c < columns; c++) {
      const along = -side.span / 2 + step * (c + 1)
      for (let f = 0; f < floors; f++) {
        if (rng() < 0.24) continue // «пустые» окна
        const y = cfg.curbHeight + 3.2 + f * cfg.floorHeight
        if (y > cfg.curbHeight + height - 1.4) continue
        const lit = rng() < 0.3
        const px = cx + side.nx * (side.span / 2 + 0.06) + (side.nx === 0 ? along : 0)
        const pz = cz + side.nz * (side.span / 2 + 0.06) + (side.nz === 0 ? along : 0)
        const def: BoxDef = {
          position: [px, y, pz],
          size: side.nx === 0 ? [1.35, 1.6, 0.12] : [0.12, 1.6, 1.35],
          color: lit ? pick(rng, LIT_GLASS) : pick(rng, DARK_GLASS),
        }
        if (lit) data.litWindows.push(def)
        else data.windows.push(def)
      }
    }
  }
}
