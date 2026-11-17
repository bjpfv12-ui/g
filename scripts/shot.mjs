/**
 * shot.mjs — снимок экрана с указанного адреса (по умолчанию — живой сайт).
 * Используется, чтобы приложить к ответу кадр уже задеплоенной версии.
 *   GPU=1 node scripts/shot.mjs [url] [out.png]
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.argv[2] ?? 'https://bjpfv12-ui.github.io/g/'
const OUT = process.argv[3] ?? 'C:\\3d game\\verify\\shot-live.png'
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
    '--window-size=1440,810',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 810 })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text())
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.addStyleTag({ content: '.hud__overlay{display:none !important}' })
await new Promise((r) => setTimeout(r, 4000))

if (process.env.CAR === '1') {
  // Садимся в машину и снимаем поворот — нужен dev-сервер с хуками.
  const parked = await page.evaluate(() => window.__carState?.parked ?? [])
  // Берём машину ближе к центру города, чтобы не уехать за карту.
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
  await page.evaluate((t) => {
    window.__playerState.body.setTranslation({ x: t.x + 1.2, y: 1.2, z: t.z }, true)
  }, target)
  await new Promise((r) => setTimeout(r, 800))
  await page.keyboard.press('KeyF')
  await new Promise((r) => setTimeout(r, 600))

  await page.keyboard.down('KeyW')
  await new Promise((r) => setTimeout(r, 1800))
  await page.keyboard.down('KeyA')
  await new Promise((r) => setTimeout(r, 900))

  const camInfo = await page.evaluate(() => {
    const p = window.__playerState
    const cam = window.__camera
    return {
      dist: cam ? cam.position.distanceTo(p.position) : -1,
      carYaw: p.carYaw,
      speed: p.carForwardSpeed,
    }
  })
  console.log('камера до кузова:', camInfo.dist.toFixed(2), 'м | курс', camInfo.carYaw.toFixed(2))

  // Свободная камера: смотрим на машину сбоку и сверху, чтобы оценить кузов.
  await page.evaluate(() => {
    const p = window.__playerState.position
    window.__freeCam = {
      pos: [p.x + 9, p.y + 5, p.z + 9],
      look: [p.x, p.y, p.z],
    }
  })
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: OUT })
  await page.evaluate(() => {
    window.__freeCam = undefined
  })
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
} else {
  // Доворачиваем персонажа клавишей D — видно, что камера встаёт за спину.
  await page.keyboard.down('KeyW')
  await new Promise((r) => setTimeout(r, 700))
  await page.keyboard.down('KeyD')
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: OUT })
  await page.keyboard.up('KeyD')
  await page.keyboard.up('KeyW')
}

const telemetry = await page.evaluate(() => {
  const el = document.querySelector('.hud__telemetry')
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : 'n/a'
})
console.log('кадр:', OUT)
console.log('телеметрия:', telemetry)
console.log('ошибки консоли:', logs.length ? logs.slice(0, 5).join(' | ') : 'нет')

await browser.close()
