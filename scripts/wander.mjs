/**
 * wander.mjs — длинная «блуждающая» сессия: газ + чередование A/D.
 * Ищем момент, когда руль умирает, и смотрим состояние прямо перед этим.
 *
 *   npm run dev
 *   GPU=1 node scripts/wander.mjs
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const USE_GPU = process.env.GPU === '1'
const DURATION = Number(process.env.SECONDS ?? 45)

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

// Просадка CPU — эмулируем слабую машину (низкий FPS).
const CPU = Number(process.env.CPU ?? 0)
if (CPU > 1) {
  const client = await page.createCDPSession()
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  console.log(`просадка CPU x${CPU}`)
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })

// Ждём, пока мир и физика прогрузятся (при просадке CPU это долго).
for (let i = 0; i < 60; i++) {
  const ready = await page.evaluate(
    () => (window.__carState?.parked?.length ?? 0) > 0 && !!window.__playerState?.body,
  )
  if (ready) break
  await new Promise((r) => setTimeout(r, 1000))
}
await new Promise((r) => setTimeout(r, 2000))

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

const read = () =>
  page.evaluate(() => {
    const st = window.__carState
    const p = window.__playerState
    const b = st.body
    const av = b.angvel()
    const lv = b.linvel()
    return {
      speed: st.speed,
      fwd: p.carForwardSpeed,
      target: st.steer.target,
      dir: st.steer.direction,
      yawRate: p.carYawRate,
      upY: p.carUpY,
      x: p.position.x,
      z: p.position.z,
      rawY: av.y,
      rawX: av.x,
      rawZ: av.z,
      lvx: lv.x,
      lvz: lv.z,
      sleeping: b.isSleeping(),
      driving: st.isDriving,
    }
  })

await page.keyboard.down('KeyW')
const rows = []
const start = Date.now()
let steerKey = 'KeyA'
await page.keyboard.down(steerKey)
let lastFlip = Date.now()

while (Date.now() - start < DURATION * 1000) {
  // Меняем направление руля каждые 2 с — как живой игрок.
  if (Date.now() - lastFlip > 2000) {
    await page.keyboard.up(steerKey)
    steerKey = steerKey === 'KeyA' ? 'KeyD' : 'KeyA'
    await page.keyboard.down(steerKey)
    lastFlip = Date.now()
  }
  const r = await read()
  r.t = (Date.now() - start) / 1000
  r.steer = steerKey
  rows.push(r)
  await new Promise((res) => setTimeout(res, 200))
}
await page.keyboard.up('KeyW')
await page.keyboard.up(steerKey)

const deg = (rad) => (rad * 180) / Math.PI
console.log('\n t,с | руль | скорость | цель °/с | факт °/с | rawY | up.y | X | Z')
for (const r of rows) {
  const dead = Math.abs(deg(r.yawRate)) < 12 && Math.abs(deg(r.target)) > 40
  console.log(
    `${r.t.toFixed(1).padStart(4)} | ${r.steer.slice(-1)}    | ${r.speed.toFixed(1).padStart(7)} | ` +
      `${deg(r.target).toFixed(1).padStart(8)} | ${deg(r.yawRate).toFixed(1).padStart(8)} | ` +
      `${r.rawY.toFixed(3).padStart(6)} | ${r.upY.toFixed(2)} | ${r.x.toFixed(1).padStart(6)} | ${r.z.toFixed(1).padStart(6)}` +
      (dead ? '   <-- РУЛЬ МЁРТВ' : ''),
  )
}

const dead = rows.filter(
  (r) => Math.abs(deg(r.yawRate)) < 12 && Math.abs(deg(r.target)) > 40,
)
console.log(`\nвсего сэмплов: ${rows.length}, «мёртвых»: ${dead.length}`)
if (dead.length) {
  const first = dead[0]
  const idx = rows.indexOf(first)
  console.log('первый мёртвый сэмпл:')
  for (const r of rows.slice(Math.max(0, idx - 6), idx + 4)) {
    console.log(
      `  t=${r.t.toFixed(1)} руль=${r.steer.slice(-1)} скорость=${r.speed.toFixed(2)} ` +
        `fwd=${r.fwd.toFixed(2)} цель=${deg(r.target).toFixed(1)} факт=${deg(r.yawRate).toFixed(1)} ` +
        `rawY=${r.rawY.toFixed(3)} X=${r.x.toFixed(1)} Z=${r.z.toFixed(1)}`,
    )
  }
}

await browser.close()
