/**
 * drive-session.mjs — «человеческая» сессия езды: газ, поворот, тормоз,
 * задний ход. Ищем момент, когда руль перестаёт реагировать.
 *
 * Печатает телеметрию каждые 0.25 с: скорость, знак скорости, цель руля,
 * фактическую скорость вращения, что нажато, и состояние тела.
 *
 *   npm run dev
 *   GPU=1 node scripts/drive-session.mjs
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
console.log('сели в машину ✓\n')

const read = () =>
  page.evaluate(() => {
    const st = window.__carState
    const p = window.__playerState
    const b = st.body
    const av = b ? b.angvel() : { x: 0, y: 0, z: 0 }
    const lv = b ? b.linvel() : { x: 0, y: 0, z: 0 }
    return {
      speed: st.speed,
      fwd: p.carForwardSpeed,
      target: st.steer.target,
      actual: st.steer.actual,
      dir: st.steer.direction,
      auth: st.steer.authority,
      turnForce: st.steer.turnForce,
      yawRate: p.carYawRate,
      upY: p.carUpY,
      x: p.position.x,
      z: p.position.z,
      rawAngvelY: av.y,
      rawAngvelX: av.x,
      rawAngvelZ: av.z,
      linvelY: lv.y,
      sleeping: b ? b.isSleeping() : false,
      keys: Object.entries(window.__inputKeys ?? {}).filter(([, v]) => v).map(([k]) => k),
    }
  })

/** Фаза: держим клавиши и печатаем телеметрию. */
async function phase(label, keys, ms) {
  console.log(`\n=== ${label} ===`)
  for (const k of keys) await page.keyboard.down(k)
  const start = Date.now()
  const rows = []
  while (Date.now() - start < ms) {
    rows.push(await read())
    await new Promise((r) => setTimeout(r, 250))
  }
  for (const k of keys) await page.keyboard.up(k)
  await new Promise((r) => setTimeout(r, 200))

  console.log('  t,с | скорость | fwdSpeed | цель °/с | факт °/с | rawAngvelY | up.y | спящий')
  const t0 = Date.now() - ms
  rows.forEach((r, i) => {
    console.log(
      `${((i * 250) / 1000).toFixed(2).padStart(5)} | ${r.speed.toFixed(1).padStart(7)} | ` +
        `${r.fwd.toFixed(2).padStart(8)} | ${((r.target * 180) / Math.PI).toFixed(1).padStart(8)} | ` +
        `${((r.yawRate * 180) / Math.PI).toFixed(1).padStart(8)} | ` +
        `${r.rawAngvelY.toFixed(3).padStart(10)} | ${r.upY.toFixed(2)} | ${r.sleeping ? 'ДА' : 'нет'}`,
    )
  })
  const tail = rows.slice(Math.floor(rows.length / 2))
  const avgYaw = tail.reduce((s, r) => s + Math.abs(r.yawRate), 0) / Math.max(1, tail.length)
  const avgRaw = tail.reduce((s, r) => s + Math.abs(r.rawAngvelY), 0) / Math.max(1, tail.length)
  const avgTarget = tail.reduce((s, r) => s + Math.abs(r.target), 0) / Math.max(1, tail.length)
  console.log(
    `  ИТОГ фазы: цель ${((avgTarget * 180) / Math.PI).toFixed(1)}°/с | ` +
      `руль ${((avgYaw * 180) / Math.PI).toFixed(1)}°/с | rapier ${((avgRaw * 180) / Math.PI).toFixed(1)}°/с`,
  )
  return { avgYaw, avgRaw, avgTarget }
}

// Сценарий как в живой игре: разгон, поворот, тормоз с рулём, задний ход.
await phase('разгон W 3 c', ['KeyW'], 3000)
await phase('поворот W+A 3 c', ['KeyW', 'KeyA'], 3000)
await phase('тормоз с рулём W+Space+A 2 c', ['KeyW', 'Space', 'KeyA'], 2000)
await phase('после тормоза W+A 2 c', ['KeyW', 'KeyA'], 2000)
await phase('задний ход S 2 c', ['KeyS'], 2000)
await phase('задний ход с рулём S+A 2 c', ['KeyS', 'KeyA'], 2000)
await phase('снова вперёд W+A 3 c', ['KeyW', 'KeyA'], 3000)
await phase('тормоз W+Space+A 3 c', ['KeyW', 'Space', 'KeyA'], 3000)
await phase('после тормоза W+A 3 c', ['KeyW', 'KeyA'], 3000)

await browser.close()
