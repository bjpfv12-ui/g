/**
 * motion.mjs — замер хода персонажа: плавность скорости, реакция на поворот.
 *
 * Запускается по dev-серверу (в нём доступен хук __playerState):
 *   npm run dev
 *   node scripts/motion.mjs
 *
 * Печатает профиль скорости, число «прыжков» по вертикали, длительность
 * остановок и скорость доворота корпуса.
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 5000))

/** Снимает телеметрию каждый кадр, пока идёт сбор. */
const collect = (ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const samples = []
        const start = performance.now()
        const tick = () => {
          const p = window.__playerState
          if (p) {
            samples.push({
              t: performance.now() - start,
              x: p.position.x,
              y: p.position.y,
              z: p.position.z,
              speed: p.speed,
              facing: p.facing,
              grounded: p.grounded,
            })
          }
          if (performance.now() - start < duration) requestAnimationFrame(tick)
          else resolve(samples)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )

const stats = (values) => {
  if (values.length === 0) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return {
    mean: +mean.toFixed(3),
    std: +Math.sqrt(variance).toFixed(3),
    min: +Math.min(...values).toFixed(3),
    max: +Math.max(...values).toFixed(3),
  }
}

// ─── 1. Разгон и ровный ход ────────────────────────────────────────────────
await page.keyboard.down('KeyW')
const walk = await collect(4000)
await page.keyboard.up('KeyW')

// ─── 2. Поворот клавишей D ─────────────────────────────────────────────────
const beforeTurn = await page.evaluate(() => ({
  facing: window.__playerState.facing,
  yaw: window.__cameraStore.yaw,
}))
await page.keyboard.down('KeyD')
await new Promise((r) => setTimeout(r, 1500))
const duringTurn = await page.evaluate(() => ({
  facing: window.__playerState.facing,
  yaw: window.__cameraStore.yaw,
  speed: window.__playerState.speed,
}))
await page.keyboard.up('KeyD')

console.log('=== ХОД (4 c, W) ===')
const speeds = walk.map((s) => s.speed)
const steady = speeds.slice(Math.floor(speeds.length * 0.4))
console.log('скорость, разгон :', stats(speeds.slice(0, Math.floor(speeds.length * 0.4))))
console.log('скорость, ровный ход:', stats(steady))
const ys = walk.map((s) => s.y)
let hops = 0
for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i] - ys[i - 1]) > 0.04) hops++
console.log('вертикальных скачков:', hops)
console.log('высота Y: min', Math.min(...ys).toFixed(3), 'max', Math.max(...ys).toFixed(3))

// Остановки: сколько времени скорость была ниже 1 м/с.
let stalled = 0
for (const s of walk) if (s.speed < 1) stalled += s.t / 1000
console.log('времени со скоростью < 1 м/с:', stalled.toFixed(2), 'с')

const dist = Math.hypot(
  walk[walk.length - 1].x - walk[0].x,
  walk[walk.length - 1].z - walk[0].z,
)
console.log('пройдено, м:', dist.toFixed(2))

console.log('=== ПОВОРОТ (D, 1.5 c) ===')
console.log('курс корпуса: до', beforeTurn.facing.toFixed(3), '→ после', duringTurn.facing.toFixed(3))
console.log('yaw камеры  : до', beforeTurn.yaw.toFixed(3), '→ после', duringTurn.yaw.toFixed(3))
console.log('скорость на повороте:', duringTurn.speed.toFixed(2), 'м/с')

await browser.close()
