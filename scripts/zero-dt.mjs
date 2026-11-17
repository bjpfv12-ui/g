/**
 * zero-dt.mjs — проверяем гипотезу «один кадр с dt = 0 ломает руль навсегда».
 *
 * Сценарий: едем с рулём → подставляем нулевой dt в один кадр →
 * смотрим, что стало с угловой скоростью и рулём.
 *
 *   npm run dev
 *   GPU=1 node scripts/zero-dt.mjs
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
console.log('сели в машину ✓')

const read = () =>
  page.evaluate(() => {
    const st = window.__carState
    const p = window.__playerState
    const b = st.body
    const av = b.angvel()
    return {
      speed: st.speed,
      target: st.steer.target,
      actual: st.steer.actual,
      yawRate: p.carYawRate,
      rawX: av.x,
      rawY: av.y,
      rawZ: av.z,
      forceZeroDt: st.forceZeroDt,
    }
  })

const show = (label, r) =>
  console.log(
    `${label.padEnd(34)} скорость ${r.speed.toFixed(2).padStart(6)} | ` +
      `цель ${String(r.target).padStart(8)} | angvel.y ${String(r.rawY).padStart(8)} | ` +
      `X ${String(r.rawX).padStart(6)} Z ${String(r.rawZ).padStart(6)}`,
  )

// 1. Едем с рулём — всё живо.
await page.keyboard.down('KeyW')
await page.keyboard.down('KeyA')
await new Promise((r) => setTimeout(r, 1500))
show('до подстановки dt=0', await read())

// 2. Подставляем нулевой dt ровно в один кадр.
await page.evaluate(() => {
  window.__carState.forceZeroDt = true
  requestAnimationFrame(() => {
    window.__carState.forceZeroDt = false
  })
})
await new Promise((r) => setTimeout(r, 300))
show('сразу после кадра с dt=0', await read())

// 3. Ждём и смотрим, ожил ли руль.
await new Promise((r) => setTimeout(r, 1500))
const after = await read()
show('через 1.5 с после', after)

// 4. Руль всё ещё нажат — машина должна доворачивать.
const yawDeg = (after.yawRate * 180) / Math.PI
const alive = Number.isFinite(after.rawY) && Math.abs(yawDeg) > 20
console.log(
  `\n${alive ? '✓ руль выжил' : '✗ РУЛЬ МЁРТВ'} ` +
    `(angvel.y = ${after.rawY}, скорость поворота = ${yawDeg.toFixed(1)}°/с, ` +
    `цель = ${after.target})`,
)

await page.keyboard.up('KeyA')
await page.keyboard.up('KeyW')
await browser.close()
process.exit(alive ? 0 : 1)
