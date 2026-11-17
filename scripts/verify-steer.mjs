/**
 * verify-steer.mjs — приёмка руля после фикса поворота.
 *
 * Проверяет:
 *   1. На месте: A держит поворот стабильно, знак цели не скачет.
 *   2. На ходу: W + A доворачивает, скорость поворота держится.
 *   3. Задний ход: руль работает наоборот (знак цели меняется).
 *   4. Отпустили руль: кузов перестаёт вращаться (не крутится волчком).
 *
 *   npm run dev
 *   GPU=1 node scripts/verify-steer.mjs
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

/** Снимает трассу руля: возвращает сводку и сырые ряды. */
async function record(keys, ms) {
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
  await new Promise((r) => setTimeout(r, 400))
  return rows
}

const deg = (rad) => (rad * 180) / Math.PI
const results = []

/** Сводка по трассе: разворот, стабильность знака, средняя скорость. */
function summarize(label, rows, { expectSign = 1, minYawRate = 20 } = {}) {
  const signs = new Set(rows.map((r) => Math.sign(r.target)).filter((s) => s !== 0))
  const flips = rows.reduce((acc, r, i) => {
    if (i === 0) return acc
    const prev = Math.sign(rows[i - 1].target)
    const cur = Math.sign(r.target)
    return cur !== 0 && prev !== 0 && cur !== prev ? acc + 1 : acc
  }, 0)
  const tail = rows.slice(Math.floor(rows.length / 2))
  const avgYaw = tail.reduce((s, r) => s + r.angvel, 0) / Math.max(1, tail.length)
  const avgTarget = tail.reduce((s, r) => s + r.target, 0) / Math.max(1, tail.length)
  const ok =
    signs.size === 1 &&
    Math.sign([...signs][0]) === expectSign &&
    Math.abs(deg(avgYaw)) >= minYawRate &&
    flips === 0
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  console.log(
    `   знак цели: ${[...signs].join(',')} (ждали ${expectSign}) | смен знака: ${flips} | ` +
      `цель ${deg(avgTarget).toFixed(0)}°/с | факт ${deg(avgYaw).toFixed(0)}°/с`,
  )
  return ok
}

// 1. На месте
const still = await record(['KeyA'], 2500)
summarize('1. На месте: A держит поворот', still, { expectSign: 1, minYawRate: 40 })

// 2. На ходу
const moving = await record(['KeyW', 'KeyA'], 2500)
summarize('2. На ходу: W + A доворачивает', moving, { expectSign: 1, minYawRate: 40 })

// 3. Задний ход: сначала уезжаем назад, потом руль должен инвертироваться
await record(['KeyS'], 1500)
const reverse = await record(['KeyS', 'KeyA'], 2000)
summarize('3. Задний ход: руль работает наоборот', reverse, { expectSign: -1, minYawRate: 20 })

// 4. Руль отпущен — кузов не должен крутиться дальше
const released = await record([], 1500)
const tail = released.slice(Math.floor(released.length / 2))
const avgReleased = tail.reduce((s, r) => s + Math.abs(r.angvel), 0) / Math.max(1, tail.length)
const releasedOk = deg(avgReleased) < 5
results.push({ label: '4. Руль отпущен: вращение затухает', ok: releasedOk })
console.log(
  `${releasedOk ? '✓' : '✗'} 4. Руль отпущен: |angvel| ${deg(avgReleased).toFixed(1)}°/с ` +
    `(ждём < 5°/с)`,
)

// 5. Главный сценарий бага: руль держим 10 с — поворот обязан жить всё время.
// Раньше машина поворачивала ровно 2 секунды, потом руль мёрт.
const long = await record(['KeyW', 'KeyA'], 10000)
const seconds = long.length ? (long[long.length - 1].t - long[0].t) / 1000 : 0
// Проверяем по окнам: в каждой секунде поворот должен продолжаться.
const perSecond = []
for (let s = 0; s < Math.floor(seconds); s++) {
  const from = long[0].t + s * 1000
  const to = from + 1000
  const win = long.filter((r) => r.t >= from && r.t < to)
  const avg = win.reduce((acc, r) => acc + Math.abs(r.angvel), 0) / Math.max(1, win.length)
  perSecond.push(deg(avg))
}
const deadSeconds = perSecond.filter((v) => v < 20).length
const longOk = deadSeconds === 0 && perSecond.length >= 8
results.push({ label: '5. Удержание руля 10 с: поворот не умирает', ok: longOk })
console.log(
  `${longOk ? '✓' : '✗'} 5. Удержание руля 10 с: скорость поворота по секундам — ` +
    `${perSecond.map((v) => v.toFixed(0)).join(', ')}°/с | «мёртвых» секунд: ${deadSeconds}`,
)

// 7. Руль под тормозом: Space не должен отбирать поворот.
await record(['KeyW'], 2000)
const braking = await record(['KeyW', 'Space', 'KeyA'], 2500)
summarize('7. Под тормозом: руль работает', braking, { expectSign: 1, minYawRate: 40 })

// 8. Регрессия: кадр с dt = 0 (два кадра в одной миллисекунде) не должен
// ломать тело. Раньше деление на ноль давало NaN в угловой скорости, и руль
// умирал навсегда, а езда по прямой продолжалась.
await record(['KeyW', 'KeyA'], 1200)
await page.evaluate(() => {
  window.__carState.forceZeroDt = true
  requestAnimationFrame(() => {
    window.__carState.forceZeroDt = false
  })
})
await new Promise((r) => setTimeout(r, 300))
const afterZeroDt = await record(['KeyW', 'KeyA'], 2000)
summarize('8. После кадра с dt = 0 руль жив', afterZeroDt, { expectSign: 1, minYawRate: 40 })

const failed = results.filter((r) => !r.ok)

// 6. Ось Y не заблокирована: эффективная инерция по Y должна быть не нулевой.
// Rapier хранит симметричную матрицу 3x3 в 6 элементах: [xx, xy, xz, yy, yz, zz].
const inertia = await page.evaluate(() => {
  const b = window.__carState.body
  const el = Array.from(b.effectiveAngularInertia().elements)
  return { xx: el[0], yy: el[3], zz: el[5], principal: b.principalInertia().y }
})
const lockOk = inertia.yy > 0 && inertia.xx === 0 && inertia.zz === 0
results.push({ label: '6. Ось Y не заблокирована', ok: lockOk })
console.log(
  `${lockOk ? '✓' : '✗'} 6. Ось Y не заблокирована: инерция Y = ${inertia.yy.toFixed(3)} ` +
    `(X = ${inertia.xx}, Z = ${inertia.zz} — заблокированы, машина не заваливается)`,
)

console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
await browser.close()
process.exit(failed.length ? 1 : 0)
