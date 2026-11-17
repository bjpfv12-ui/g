/**
 * probe-steer.mjs — точечная проверка симптома из багрепорта:
 * машина поворачивает на A/D ровно 2 секунды после входа, потом руль мёртв.
 *
 * Сценарии:
 *   1. A на месте (без газа) — 6 с.
 *   2. W + A на ходу — 6 с.
 *
 * Печатает angvel по срезам: физика не должна сбрасывать вращение.
 *   npm run dev
 *   GPU=1 node scripts/probe-steer.mjs
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

// Лог из консоли страницы (в т.ч. добавленный в CarController).
page.on('console', (msg) => {
  const text = msg.text()
  if (text.startsWith('[car]')) console.log('   ', text)
})

/** Прямой доступ к телу машины — читаем angvel из самого Rapier. */
const rig = await page.evaluate(() => {
  const st = window.__carState
  return { parked: st.parked ?? [], body: st.body ?? null }
})

if (rig.parked.length === 0) {
  console.log('нет данных о припаркованных машинах')
  await browser.close()
  process.exit(1)
}

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
}, rig.parked)

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

/** Сырой angvel тела машины + телеметрия руля. */
const readRaw = () =>
  page.evaluate(() => {
    const p = window.__playerState
    const st = window.__carState
    return {
      speed: st.speed,
      yaw: p.carYaw,
      yawRate: p.carYawRate,
      upY: p.carUpY,
      target: st.steer.target,
      actual: st.steer.actual,
      authority: st.steer.authority,
      angvelRaw: st.angvel ?? null,
      x: p.position.x,
      z: p.position.z,
    }
  })

async function probe(label, keys, ms) {
  for (const k of keys) await page.keyboard.down(k)
  console.log(`\n=== ${label} ===`)
  console.log(' t,с | скорость | angvel.y °/с | кузов °/с | цель °/с | up.y')
  const start = Date.now()
  let prevYaw = null
  while (Date.now() - start < ms) {
    const r = await readRaw()
    const t = (Date.now() - start) / 1000
    let yawDelta = 0
    if (prevYaw !== null) {
      let d = r.yaw - prevYaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      yawDelta = (d * 180) / Math.PI
    }
    prevYaw = r.yaw
    const raw = r.angvelRaw ? (r.angvelRaw.y * 180) / Math.PI : NaN
    console.log(
      `${t.toFixed(1).padStart(4)} | ${r.speed.toFixed(1).padStart(7)} | ` +
        `${raw.toFixed(1).padStart(10)} | ${((r.yawRate * 180) / Math.PI).toFixed(1).padStart(8)} | ` +
        `${((r.target * 180) / Math.PI).toFixed(1).padStart(7)} | ${r.upY.toFixed(2)} | ` +
        `шаг кузова ${yawDelta.toFixed(1)}°`,
    )
    await new Promise((r2) => setTimeout(r2, 400))
  }
  for (const k of keys) await page.keyboard.up(k)
  await new Promise((r) => setTimeout(r, 600))
}

await probe('A на месте (6 c)', ['KeyA'], 6000)
await probe('W + A на ходу (6 c)', ['KeyW', 'KeyA'], 6000)

await browser.close()
