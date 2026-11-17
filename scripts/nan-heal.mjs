/**
 * nan-heal.mjs — проверяем самоисцеление: если в тело всё же попал NaN,
 * руль должен восстановиться сам, а не остаться мёртвым.
 *
 *   npm run dev
 *   GPU=1 node scripts/nan-heal.mjs
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
    let rawY = 'ERR'
    try {
      rawY = b.angvel().y
    } catch (e) {
      rawY = 'ИСКЛЮЧЕНИЕ'
    }
    return {
      speed: st.speed,
      target: st.steer.target,
      yawRate: p.carYawRate,
      rawY,
    }
  })

await page.keyboard.down('KeyW')
await page.keyboard.down('KeyA')
await new Promise((r) => setTimeout(r, 1500))
const before = await read()
console.log(
  `до подмены: angvel.y=${before.rawY} скорость поворота=${((before.yawRate * 180) / Math.PI).toFixed(1)}°/с`,
)

// Ломаем тело: впихиваем NaN в угловую скорость.
const injected = await page.evaluate(() => {
  const b = window.__carState.body
  try {
    b.setAngvel({ x: NaN, y: NaN, z: NaN }, true)
    return 'впихнули NaN'
  } catch (e) {
    return 'Rapier отверг: ' + e.message
  }
})
console.log(injected)
await new Promise((r) => setTimeout(r, 1200))

// Пробуем починить тело снаружи — так же, как это сделает игра.
const repair = await page.evaluate(() => {
  const b = window.__carState.body
  const out = []
  try {
    b.angvel()
    out.push('angvel читается')
  } catch (e) {
    out.push('angvel: ' + e.message.slice(0, 60))
    try {
      b.setLinvel({ x: 0, y: 0, z: 0 }, true)
      b.setAngvel({ x: 0, y: 0, z: 0 }, true)
      out.push('сброс прошёл')
    } catch (e2) {
      out.push('сброс не удался: ' + e2.message.slice(0, 60))
    }
  }
  try {
    const v = b.angvel()
    out.push(`после сброса angvel.y=${v.y}`)
  } catch (e3) {
    out.push('после сброса всё ещё: ' + e3.message.slice(0, 60))
  }
  return out
})
repair.forEach((line) => console.log('  ' + line))

const after = await read()
const yawDeg = (after.yawRate * 180) / Math.PI
const alive = Number.isFinite(Number(after.rawY)) && Math.abs(yawDeg) > 20
console.log(
  `после: angvel.y=${after.rawY} цель=${after.target} скорость поворота=${yawDeg.toFixed(1)}°/с`,
)
console.log(alive ? '\n✓ руль восстановился сам' : '\n✗ руль не восстановился')

await page.keyboard.up('KeyA')
await page.keyboard.up('KeyW')
await browser.close()
process.exit(alive ? 0 : 1)
