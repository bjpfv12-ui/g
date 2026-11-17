/**
 * diag-order.mjs — проверяем, как Rapier применяет applyTorqueImpulse:
 * сразу к angvel или копит до шага. От этого зависит порядок вызовов
 * setAngvel/applyTorqueImpulse в контроллере руля.
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

const out = await page.evaluate(() => {
  const b = window.__carState.body
  const I = b.principalInertia().y
  const res = { inertiaY: I, cases: {} }

  // 1. Импульс момента меняет angvel сразу?
  b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  b.applyTorqueImpulse({ x: 0, y: 5, z: 0 }, true)
  res.cases.afterTorqueOnly = b.angvel().y

  // 2. Если сначала torque, потом setAngvel — что останется?
  b.setAngvel({ x: 0, y: 1, z: 0 }, true)
  b.applyTorqueImpulse({ x: 0, y: 5, z: 0 }, true)
  const afterTorque = b.angvel().y
  b.setAngvel({ x: 0, y: 1, z: 0 }, true)
  res.cases.torqueThenSet = { afterTorque, afterSet: b.angvel().y }

  // 3. Если сначала setAngvel, потом torque.
  b.setAngvel({ x: 0, y: 1, z: 0 }, true)
  b.applyTorqueImpulse({ x: 0, y: 5, z: 0 }, true)
  res.cases.setThenTorque = b.angvel().y

  // 4. Переживает ли импульс шаг физики? Читаем после кадра.
  b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  b.applyTorqueImpulse({ x: 0, y: 5, z: 0 }, true)
  res.cases.beforeStep = b.angvel().y
  return res
})

await new Promise((r) => setTimeout(r, 200))
const afterStep = await page.evaluate(() => window.__carState.body.angvel().y)

console.log(JSON.stringify(out, null, 2))
console.log('angvel через 200 мс (после шага физики):', afterStep)
console.log(
  'ожидаемое изменение angvel от импульса 5 Н·м·s:',
  (5 / out.inertiaY).toFixed(4),
  'рад/с',
)

await browser.close()
