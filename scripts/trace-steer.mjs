/**
 * trace-steer.mjs — покадровая трасса руля из CarController (dev-хук).
 * Показывает, что именно происходит с угловой скоростью каждый кадр.
 *
 *   npm run dev
 *   GPU=1 node scripts/trace-steer.mjs
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
  ],
})
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 5000))

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
  if (await page.evaluate(() => window.__carState.isDriving)) break
}
if (!(await page.evaluate(() => window.__carState.isDriving))) {
  console.log('не сели в машину')
  await browser.close()
  process.exit(1)
}
console.log('сели в машину ✓')

async function trace(label, keys, ms) {
  await page.evaluate(() => {
    window.__carState.trace.length = 0
    window.__carState.traceOn = true
  })
  for (const k of keys) await page.keyboard.down(k)
  await new Promise((r) => setTimeout(r, ms))
  for (const k of keys) await page.keyboard.up(k)
  const rows = await page.evaluate(() => {
    window.__carState.traceOn = false
    return window.__carState.trace.slice()
  })

  console.log(`\n=== ${label} — ${rows.length} кадров ===`)
  const t0 = rows[0]?.t ?? 0
  const step = Math.max(1, Math.floor(rows.length / 40))
  console.log('  t,с | steer | fwdSpeed | цель °/с | angvel °/с | момент Н·м')
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i]
    console.log(
      `${((r.t - t0) / 1000).toFixed(2).padStart(5)} | ` +
        `${r.steer.toFixed(0).padStart(5)} | ` +
        `${r.forwardSpeed.toFixed(2).padStart(8)} | ` +
        `${((r.target * 180) / Math.PI).toFixed(1).padStart(8)} | ` +
        `${((r.angvel * 180) / Math.PI).toFixed(1).padStart(10)} | ` +
        `${r.torque.toFixed(1).padStart(9)}`,
    )
  }
  // Сколько раз цель меняла знак — признак дребезга направления.
  let flips = 0
  for (let i = 1; i < rows.length; i++) {
    if (Math.sign(rows[i].target) !== Math.sign(rows[i - 1].target) && rows[i].target !== 0) flips++
  }
  const maxAng = rows.reduce((m, r) => Math.max(m, Math.abs(r.angvel)), 0)
  console.log(
    `смена знака цели: ${flips} раз | макс |angvel|: ${((maxAng * 180) / Math.PI).toFixed(1)}°/с`,
  )
  await new Promise((r) => setTimeout(r, 700))
}

await trace('A на месте (3 c)', ['KeyA'], 3000)
await trace('W + A на ходу (3 c)', ['KeyW', 'KeyA'], 3000)

await browser.close()
