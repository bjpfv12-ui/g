/**
 * crash-steer.mjs — проверяем, блокирует ли контакт со стеной вращение кузова.
 *
 * Сценарий: разгон → впираемся в здание → пробуем повернуть (A).
 * Если после удара руль мёртв, а после откатывания назад оживает —
 * виноват контакт: кузов упирается в стену и физика гасит поворот.
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
      yawRate: p.carYawRate,
      upY: p.carUpY,
      x: p.position.x,
      z: p.position.z,
      rawY: av.y,
      lvx: lv.x,
      lvz: lv.z,
      linvel: lv,
    }
  })

const deg = (rad) => (rad * 180) / Math.PI

/** Держит клавиши и печатает среднюю скорость поворота за окно. */
async function hold(label, keys, ms) {
  for (const k of keys) await page.keyboard.down(k)
  const rows = []
  const start = Date.now()
  while (Date.now() - start < ms) {
    rows.push(await read())
    await new Promise((r) => setTimeout(r, 150))
  }
  for (const k of keys) await page.keyboard.up(k)
  await new Promise((r) => setTimeout(r, 300))
  const tail = rows.slice(Math.floor(rows.length / 2))
  const avg = (f) => tail.reduce((s, r) => s + f(r), 0) / Math.max(1, tail.length)
  const yaw = avg((r) => Math.abs(deg(r.yawRate)))
  const tgt = avg((r) => Math.abs(deg(r.target)))
  const spd = avg((r) => r.speed)
  console.log(
    `${label.padEnd(38)} скорость ${spd.toFixed(1).padStart(5)} м/с | ` +
      `цель ${tgt.toFixed(0).padStart(4)}°/с | РУЛЬ ${yaw.toFixed(0).padStart(4)}°/с ` +
      `${yaw < 15 && tgt > 40 ? '  <-- РУЛЬ МЁРТВ' : ''}`,
  )
  return { yaw, tgt, rows }
}

// 1. Разгон.
await hold('разгон W 5 c', ['KeyW'], 5000)
// 2. Впираемся в здание: руль в сторону и газ до удара.
await hold('впираемся в стену W+D 3 c', ['KeyW', 'KeyD'], 3000)
// 3. Пробуем повернуть на месте.
await hold('после удара: A 2 c', ['KeyA'], 2000)
// 4. Откатываемся назад.
await hold('откат S 2 c', ['KeyS'], 2000)
// 5. Снова пробуем повернуть.
await hold('после отката: A 2 c', ['KeyA'], 2000)
// 6. И ещё с газом.
await hold('после отката: W+A 2 c', ['KeyW', 'KeyA'], 2000)

const last = await read()
console.log(
  `\nитог: X=${last.x.toFixed(1)} Z=${last.z.toFixed(1)} скорость=${last.speed.toFixed(2)} ` +
    `linvel=(${last.lvx.toFixed(2)}, ${last.lvz.toFixed(2)})`,
)

await browser.close()
