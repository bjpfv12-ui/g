/**
 * curb-steer.mjs — проверяем аварийный доворот: машина стоит на тротуаре,
 * кузов частично в бордюре. Физика гасит момент — руль обязан всё равно
 * доворачивать машину (иначе руль «умирает»).
 *
 *   npm run dev
 *   GPU=1 node scripts/curb-steer.mjs
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

for (let i = 0; i < 60; i++) {
  const ready = await page.evaluate(
    () => (window.__carState?.parked?.length ?? 0) > 0 && !!window.__playerState?.body,
  )
  if (ready) break
  await new Promise((r) => setTimeout(r, 1000))
}
await new Promise((r) => setTimeout(r, 2000))

const parked = await page.evaluate(() => window.__carState.parked)
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
    return {
      speed: st.speed,
      target: st.steer.target,
      yawRate: p.carYawRate,
      unstuck: st.steer.unstuck,
      x: p.position.x,
      z: p.position.z,
      upY: p.carUpY,
    }
  })

async function hold(label, ms) {
  await page.keyboard.down('KeyA')
  const rows = []
  const start = Date.now()
  while (Date.now() - start < ms) {
    rows.push(await read())
    await new Promise((r) => setTimeout(r, 200))
  }
  await page.keyboard.up('KeyA')
  await new Promise((r) => setTimeout(r, 300))
  const tail = rows.slice(Math.floor(rows.length / 2))
  const avg = (f) => tail.reduce((s, r) => s + f(r), 0) / Math.max(1, tail.length)
  const yaw = avg((r) => Math.abs((r.yawRate * 180) / Math.PI))
  const tgt = avg((r) => Math.abs((r.target * 180) / Math.PI))
  const unstuck = rows[rows.length - 1].unstuck
  console.log(
    `${label.padEnd(34)} цель ${tgt.toFixed(0).padStart(4)}°/с | РУЛЬ ${yaw.toFixed(0).padStart(4)}°/с | ` +
      `аварийных доворотов: ${unstuck}`,
  )
  return { yaw, tgt, unstuck }
}

// Контроль: машина в обычном месте (у бордюра, как припаркованная).
await hold('контроль (у бордюра): A 2 c', 2000)

// Заезжаем кузовом на тротуар: часть кузова оказывается в бордюре.
const info = await page.evaluate(() => {
  const st = window.__carState
  const b = st.body
  const t = b.translation()
  const [cx, cz] = st.curbDir
  const offset = st.dims.width / 2 + 0.45
  b.setTranslation(
    { x: t.x + cx * offset, y: 0.15 + st.dims.height / 2, z: t.z + cz * offset },
    true,
  )
  b.setLinvel({ x: 0, y: 0, z: 0 }, true)
  b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  return { x: t.x + cx * offset, z: t.z + cz * offset, curbDir: st.curbDir }
})
await new Promise((r) => setTimeout(r, 1200))
console.log(`машина сдвинута на тротуар в точку ${info.x.toFixed(1)}, ${info.z.toFixed(1)}`)

const onCurb = await hold('на тротуаре: A 3 c', 3000)
const onCurb2 = await hold('на тротуаре: D 3 c', 3000)

const ok = onCurb.yaw > 20 && onCurb2.yaw > 20
console.log(
  `\n${ok ? '✓ руль работает даже на тротуаре' : '✗ руль на тротуаре умер'} ` +
    `(аварийных доворотов: ${onCurb2.unstuck})`,
)
await browser.close()
process.exit(ok ? 0 : 1)
