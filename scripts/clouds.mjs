/**
 * Проверка облаков: статистика инстансов + снимки со свободной камеры.
 * Игровую орбитальную камеру недостаточно — со свободной видно и сами плиты.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const OUT = 'C:\\3d game\\verify'

mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,810',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(6000)

// ─── Статистика облаков ─────────────────────────────────────────────────────
const stats = await page.evaluate(() => {
  const mesh = window.__clouds
  if (!mesh) return { error: 'нет пробника облаков' }
  const m = new mesh.matrixWorld.constructor()
  const p = new mesh.position.constructor()
  const s = new mesh.position.constructor()
  const q = new mesh.quaternion.constructor()
  const items = []
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m)
    m.decompose(p, q, s)
    items.push({ x: p.x, y: p.y, z: p.z, w: s.x, h: s.y, d: s.z })
  }
  const ys = items.map((i) => i.y)
  const mat = mesh.material
  return {
    count: mesh.count,
    visible: mesh.visible,
    material: {
      type: mat.type,
      color: '#' + mat.color.getHexString(),
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
      fog: mat.fog,
    },
    heightRange: [Math.min(...ys).toFixed(1), Math.max(...ys).toFixed(1)],
    sample: items.slice(0, 5).map((i) => ({
      y: i.y.toFixed(1),
      size: [i.w.toFixed(0), i.h.toFixed(1), i.d.toFixed(0)],
    })),
  }
})
console.log('ОБЛАКА:', JSON.stringify(stats, null, 2))

// ─── Ракурсы со свободной камерой ───────────────────────────────────────────
const shots = [
  { name: 'shot-clouds-air.png', pos: [60, 300, 430], look: [0, 130, 0] },
  { name: 'shot-clouds-sky.png', pos: [0, 3, 0], look: [0, 320, 300] },
  { name: 'shot-clouds-mid.png', pos: [-180, 90, 300], look: [0, 150, 0] },
]

// Убираем HUD-оверлей, чтобы он не закрывал кадр.
await page.evaluate(() => {
  document.querySelector('.hud__overlay')?.remove()
  document.querySelector('.hud__controls')?.remove()
})

for (const shot of shots) {
  const ok = await page.evaluate((s) => {
    const gl = window.__gl
    const scene = window.__scene
    if (!gl || !scene) return false
    globalThis.__freeCam = { pos: s.pos, look: s.look }
    return true
  }, shot)
  if (!ok) {
    console.log('не удалось поставить камеру', shot.name)
    continue
  }
  await wait(4000)
  await page.screenshot({ path: `${OUT}\\${shot.name}`, captureBeyondViewport: false })
  console.log('снимок:', `${OUT}\\${shot.name}`)
}

console.log('консоль:', logs.slice(0, 15).join('\n') || '(чисто)')
await browser.close()
