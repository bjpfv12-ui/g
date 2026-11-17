/**
 * car-timeline.mjs — развёрнутая по времени проверка руля и камеры.
 *
 * Едет, потом доворачивает и печатает по срезам: скорость машины, скорость
 * поворота кузова и скорость поворота камеры. Видно, что именно ломается.
 *
 *   npm run dev
 *   GPU=1 node scripts/car-timeline.mjs
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const USE_GPU = process.env.GPU === '1'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(USE_GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--window-size=1280,720',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 5000))

const read = () =>
  page.evaluate(() => ({
    speed: window.__carState.speed,
    carYaw: window.__playerState.carYaw,
    carYawRate: window.__playerState.carYawRate,
    camYaw: window.__cameraStore.getState().yaw,
    steerTarget: window.__carState.steer.target,
    steerActual: window.__carState.steer.actual,
    upY: window.__playerState.carUpY,
    x: window.__playerState.position.x,
    z: window.__playerState.position.z,
  }))

// ─── Садимся в машину ──────────────────────────────────────────────────────
const parked = await page.evaluate(() => window.__carState.parked ?? [])
const target = await page.evaluate((list) => {
  let best = list[0]
  let bestD = Infinity
  for (const c of list) {
    const d = Math.hypot(c.x, c.z)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}, parked)
let seated = false
for (const offset of [1.2, -1.2, 0, 2.2]) {
  await page.evaluate(
    (t, dx) => {
      window.__playerState.body.setTranslation({ x: t.x + dx, y: 1.2, z: t.z }, true)
    },
    target,
    offset,
  )
  await new Promise((r) => setTimeout(r, 800))
  await page.keyboard.press('KeyF')
  await new Promise((r) => setTimeout(r, 600))
  seated = await page.evaluate(() => window.__carState.isDriving)
  if (seated) break
}
if (!seated) {
  console.log('не сели в машину')
  await browser.close()
  process.exit(1)
}
console.log('сели в машину ✓')

/** Кадры с метками времени — печатаем срезами по 0,5 c. */
async function timeline(label, ms, keys) {
  for (const k of keys) await page.keyboard.down(k)
  const rows = []
  const start = Date.now()
  while (Date.now() - start < ms) {
    rows.push({ t: (Date.now() - start) / 1000, ...(await read()) })
    await new Promise((r) => setTimeout(r, 500))
  }
  for (const k of keys) await page.keyboard.up(k)

  console.log(`\n=== ${label} ===`)
  console.log(' t,с | скорость | кузов °/с | цель °/с | камера °/с | up.y')
  let prev = null
  for (const r of rows) {
    let camRate = 0
    if (prev) {
      let d = r.camYaw - prev.camYaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      camRate = (d / (r.t - prev.t)) * (180 / Math.PI)
    }
    prev = r
    console.log(
      `${r.t.toFixed(1).padStart(4)} | ${r.speed.toFixed(1).padStart(7)} | ` +
        `${((r.carYawRate * 180) / Math.PI).toFixed(1).padStart(8)} | ` +
        `${((r.steerTarget * 180) / Math.PI).toFixed(1).padStart(7)} | ` +
        `${camRate.toFixed(1).padStart(10)} | ${r.upY.toFixed(2)}`,
    )
  }
}

await timeline('разгон 6 c (W)', 6000, ['KeyW'])
await timeline('доворот 6 c (W + A)', 6000, ['KeyW', 'KeyA'])

await browser.close()
