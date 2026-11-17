/**
 * car.mjs — замер управляемости машины: разгон, скорость поворота кузова
 * на разных скоростях, потеря скорости в повороте.
 *
 * Нужен dev-сервер (доступны хуки __playerState и __carState):
 *   npm run dev
 *   GPU=1 node scripts/car.mjs
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

const prompt = () =>
  page.evaluate(() => document.querySelector('.hud__prompt')?.textContent ?? '')

const carState = () =>
  page.evaluate(() => ({
    isDriving: window.__carState.isDriving,
    speed: window.__carState.speed,
    yaw: window.__playerState.carYaw,
    yawRate: window.__playerState.carYawRate,
    forwardSpeed: window.__playerState.carForwardSpeed,
  }))

/** Снимает телеметрию каждый кадр, пока идёт сбор. */
const sample = (ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const rows = []
        const start = performance.now()
        const tick = () => {
          const p = window.__playerState
          rows.push({
            t: performance.now() - start,
            x: p.position.x,
            z: p.position.z,
            yaw: p.carYaw,
            yawRate: p.carYawRate,
            speed: window.__carState.speed,
          })
          if (performance.now() - start < duration) requestAnimationFrame(tick)
          else resolve(rows)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )

// ─── 1. Садимся в машину ───────────────────────────────────────────────────
const parked = await page.evaluate(() => window.__carState.parked ?? [])
if (parked.length === 0) {
  console.log('нет данных о припаркованных машинах')
  await browser.close()
  process.exit(1)
}

let seated = false
for (const offset of [1.2, -1.2, 0, 2.2]) {
  await page.evaluate(
    (target, dx) => {
      window.__playerState.body.setTranslation(
        { x: target.x + dx, y: 1.2, z: target.z },
        true,
      )
    },
    parked[0],
    offset,
  )
  await new Promise((r) => setTimeout(r, 800))
  await page.keyboard.press('KeyF')
  await new Promise((r) => setTimeout(r, 600))
  seated = (await carState()).isDriving
  if (seated) break
}
if (!seated) {
  console.log('не удалось сесть в машину; промпт:', await prompt())
  await browser.close()
  process.exit(1)
}
console.log('сели в машину ✓')

/** Доворот на полном руле: жмём A и смотрим, что делает кузов. */
async function steerTest(label, throttleMs, steerMs) {
  if (throttleMs > 0) await page.keyboard.down('KeyW')
  await new Promise((r) => setTimeout(r, throttleMs))
  const before = await carState()
  await page.keyboard.down('KeyA')
  const rows = await sample(steerMs)
  await page.keyboard.up('KeyA')
  if (throttleMs > 0) await page.keyboard.up('KeyW')
  await new Promise((r) => setTimeout(r, 400))

  const first = rows[0]
  const last = rows[rows.length - 1]
  const mid = rows[Math.floor(rows.length / 2)]
  let delta = last.yaw - first.yaw
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2

  const travel = Math.hypot(last.x - first.x, last.z - first.z)
  const crashed = travel < 1 && last.speed < 3

  console.log(`--- ${label} ---`)
  console.log(`скорость до: ${before.speed.toFixed(1)} м/с`)
  console.log(
    `кузов: ${((delta * 180) / Math.PI).toFixed(1)}° за ${(steerMs / 1000).toFixed(1)} c, ` +
      `в середине ${((mid.yawRate * 180) / Math.PI).toFixed(1)}°/с`,
  )
  console.log(
    `скорость после: ${last.speed.toFixed(1)} м/с, пройдено ${travel.toFixed(1)} м`,
  )
  if (crashed) console.log('ВЫВОД: машина врезалась — замер недействителен')
  return { crashed }
}

await steerTest('руль на месте', 0, 1200)
await steerTest('руль на малой скорости', 700, 1200)
await steerTest('руль на ходу', 2200, 1200)

await browser.close()
