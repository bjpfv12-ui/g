/**
 * car.mjs — замер управляемости машины: разгон, скорость поворота кузова
 * на разных скоростях, время до поворота на 90°.
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
    throttle: window.__carState.throttle,
    yaw: window.__playerState.carYaw,
    yawRate: window.__playerState.carYawRate,
    forwardSpeed: window.__playerState.carForwardSpeed,
  }))

// ─── 1. Ищем припаркованную машину и садимся ───────────────────────────────
const parked = await page.evaluate(() => window.__carState.parked ?? [])
if (parked.length === 0) {
  console.log('нет данных о припаркованных машинах')
  await browser.close()
  process.exit(1)
}

// Ставим игрока вплотную к первой машине и садимся.
await page.evaluate((target) => {
  const body = window.__playerState.body
  body.setTranslation({ x: target.x + 1.2, y: 1.2, z: target.z }, true)
}, parked[0])
await new Promise((r) => setTimeout(r, 900))
await page.keyboard.press('KeyF')
await new Promise((r) => setTimeout(r, 700))

let seated = (await carState()).isDriving
if (!seated) {
  // Подходим ближе — иногда проём один и тот же, но с другой стороны.
  await page.evaluate((target) => {
    const body = window.__playerState.body
    body.setTranslation({ x: target.x - 1.2, y: 1.2, z: target.z }, true)
  }, parked[0])
  await new Promise((r) => setTimeout(r, 900))
  await page.keyboard.press('KeyF')
  await new Promise((r) => setTimeout(r, 700))
  seated = (await carState()).isDriving
}

if (!seated) {
  console.log('не удалось сесть в машину; промпт:', await prompt())
  await browser.close()
  process.exit(1)
}
console.log('сели в машину ✓')

// ─── 2. Разгон ─────────────────────────────────────────────────────────────
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 4000))
const cruising = await carState()
console.log(
  `разгон: скорость ${cruising.speed.toFixed(1)} м/с, курс ${cruising.yaw.toFixed(2)}`,
)

// ─── 3. Поворот на скорости ─────────────────────────────────────────────────
const before = await carState()
await page.keyboard.down('KeyA')
await new Promise((r) => setTimeout(r, 2000))
const after = await carState()
await page.keyboard.up('KeyA')
await page.keyboard.up('KeyW')

let delta = after.yaw - before.yaw
while (delta > Math.PI) delta -= Math.PI * 2
while (delta < -Math.PI) delta += Math.PI * 2

const turned = Math.abs(delta)
const seconds = 2
console.log('=== РУЛЬ НА ХОДУ ===')
console.log(`скорость: ${after.speed.toFixed(1)} м/с (${(after.speed * 3.6).toFixed(0)} км/ч)`)
console.log(`кузов повернулся на ${((turned * 180) / Math.PI).toFixed(1)}° за ${seconds} c`)
console.log(`скорость поворота кузова: ${((turned / seconds) * 180 / Math.PI).toFixed(1)}°/с`)
console.log(`время на поворот 90°: ${((Math.PI / 2) / Math.max(turned / seconds, 1e-6)).toFixed(1)} c`)
console.log(`скорость после поворота: ${after.speed.toFixed(1)} м/с`)

await browser.close()
